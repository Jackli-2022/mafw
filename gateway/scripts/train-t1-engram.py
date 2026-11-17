"""Train the engram-P1 low-rank learned k-WTA model.

Model: a = U(Vx)+b; z = softplus(a) * TopK(a,k); x_hat = normalize((zU)V)
Loss: reconstruction + NCE(same episode) + dense-ranking KD + hub penalty.

Run from gateway/:
  python scripts/train-t1-engram.py --epochs 30
"""
import argparse
import hashlib
import json
import os

import numpy as np
import torch
import torch.nn.functional as F

ROOT = os.path.join(os.path.dirname(__file__), "fixtures", "engram-p1")


def load():
    with open(os.path.join(ROOT, "meta.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    vectors = np.fromfile(os.path.join(ROOT, "vectors.f32"), dtype=np.float32)
    vectors = vectors.reshape(meta["turns"], meta["dims"])
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    vectors = vectors / norms
    return meta, vectors


class Engram(torch.nn.Module):
    def __init__(self, dims, m, rank, k):
        super().__init__()
        self.V = torch.nn.Parameter(torch.randn(rank, dims) * 0.02)
        self.U = torch.nn.Parameter(torch.randn(m, rank) * 0.02)
        self.b = torch.nn.Parameter(torch.zeros(m))
        self.k = k
        self.m = m

    def forward(self, x):
        a = (x @ self.V.T) @ self.U.T + self.b
        top = torch.topk(a, self.k, dim=1).indices
        mask = torch.zeros_like(a).scatter_(1, top, 1.0)
        z = F.softplus(a) * mask
        rec = (z @ self.U) @ self.V
        return z, F.normalize(rec, dim=1), a


def batch_loss(model, x, episodes, tau_nce=0.1, tau_t=0.1, tau_s=0.1, hub_weight=1.0):
    z, rec, _ = model(x)
    rec_loss = (1 - (rec * x).sum(dim=1)).mean()

    zn = F.normalize(z, dim=1)
    logits = zn @ zn.T / tau_nce
    eye = torch.eye(x.shape[0], dtype=torch.bool, device=x.device)
    same = episodes[:, None] == episodes[None, :]
    valid = episodes[:, None] != 0
    pos = same & ~eye & valid
    all_mask = ~eye & valid
    if pos.any():
        pos_log = torch.logsumexp(logits.masked_fill(~pos, -1e9), dim=1)
        all_log = torch.logsumexp(logits.masked_fill(~all_mask, -1e9), dim=1)
        has_pos = pos.any(dim=1)
        nce = -(pos_log - all_log)[has_pos].mean()
    else:
        nce = torch.zeros((), device=x.device)

    xn = F.normalize(x, dim=1)
    dense = (xn @ xn.T) / tau_t
    p = F.softmax(dense.masked_fill(~all_mask, -1e9), dim=1)
    q = F.log_softmax(logits.masked_fill(~all_mask, -1e9), dim=1)
    kd = (p * (torch.log(p + 1e-9) - q)).sum(dim=1).mean()

    freq = (z > 0).float().mean(dim=0)
    hub = F.relu(freq - 3 * model.k / model.m).pow(2).sum()

    return rec_loss + nce + 0.5 * kd + hub_weight * hub, {
        "rec": float(rec_loss), "nce": float(nce), "kd": float(kd), "hub": float(hub)
    }


def code_sets(z, k):
    idx = torch.topk(z, k, dim=1).indices.cpu().numpy()
    return idx


def matched_auc(codes, episodes, dense, split_idx):
    bins = [0.0, 0.3, 0.5, 0.7, 0.8, 0.9, 1.01]
    pos_of = {g: i for i, g in enumerate(split_idx)}
    pairs = []
    for a in range(len(split_idx)):
        for b in range(a + 1, len(split_idx)):
            i, j = split_idx[a], split_idx[b]
            if not episodes[i] or not episodes[j]:
                continue
            pairs.append((pos_of[i], pos_of[j], episodes[i] == episodes[j], float(dense[i, j])))
    score = np.array([len(set(codes[i]) & set(codes[j])) / len(set(codes[i]) | set(codes[j])) for i, j, _, _ in pairs])
    label = np.array([p[2] for p in pairs])
    d = np.array([p[3] for p in pairs])
    weighted, total = 0.0, 0.0
    for b in range(len(bins) - 1):
        m = (d >= bins[b]) & (d < bins[b + 1])
        pos, neg = score[m & label], score[m & ~label]
        if len(pos) < 2 or len(neg) < 2:
            continue
        order = np.argsort(np.concatenate([pos, neg]))
        ranks = np.empty(len(order), dtype=float)
        ranks[order] = np.arange(1, len(order) + 1)
        pos_ranks = ranks[: len(pos)]
        auc = (pos_ranks.sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))
        w = len(pos) * len(neg)
        weighted += auc * w
        total += w
    return weighted / total if total else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--m", type=int, default=4096)
    ap.add_argument("--rank", type=int, default=64)
    ap.add_argument("--k", type=int, default=16)
    ap.add_argument("--hub-weight", type=float, default=1.0)
    args = ap.parse_args()

    meta, vectors = load()
    items = meta["items"]
    episodes = np.array([it.get("episodeId") or "" for it in items])
    splits = np.array([it["split"] for it in items])
    train_idx = np.where(splits == "train")[0]
    val_idx = np.where(splits == "val")[0]
    test_idx = np.where(splits == "test")[0]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    ep_map = {e: i + 1 for i, e in enumerate(sorted(set(episodes))) if e}
    ep_int = np.array([ep_map.get(e, 0) for e in episodes], dtype=np.int64)
    x_all = torch.tensor(vectors, device=device)
    model = Engram(meta["dims"], args.m, args.rank, args.k).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    best_val = float("inf")
    best_state = None
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = np.random.default_rng(epoch).permutation(train_idx)
        totals = {"rec": 0.0, "nce": 0.0, "kd": 0.0, "hub": 0.0, "n": 0}
        for start in range(0, len(perm), args.batch):
            idx = perm[start : start + args.batch]
            if len(idx) < 8:
                continue
            x = x_all[idx]
            ep = torch.tensor(ep_int[idx], device=device)
            loss, parts = batch_loss(model, x, ep, hub_weight=args.hub_weight)
            opt.zero_grad()
            loss.backward()
            opt.step()
            totals["n"] += 1
            for key in ("rec", "nce", "kd", "hub"):
                totals[key] += parts[key]
        model.eval()
        with torch.no_grad():
            val_loss = 0.0
            n = 0
            for start in range(0, len(val_idx), args.batch):
                idx = val_idx[start : start + args.batch]
                if len(idx) < 8:
                    continue
                loss, _ = batch_loss(model, x_all[idx], torch.tensor(ep_int[idx], device=device), hub_weight=args.hub_weight)
                val_loss += float(loss)
                n += 1
            val_loss = val_loss / max(n, 1)
            z_val, _, _ = model(x_all[val_idx])
            codes = code_sets(z_val, args.k)
            dense = (x_all.cpu().numpy() @ x_all.cpu().numpy().T)
            auc = matched_auc(codes, episodes, dense, val_idx)
        mean = {k: totals[k] / max(totals["n"], 1) for k in ("rec", "nce", "kd", "hub")}
        print(json.dumps({"epoch": epoch, **mean, "valLoss": round(val_loss, 4), "valMatchedAuc": auc}))
        if val_loss < best_val:
            best_val = val_loss
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        z_test, _, _ = model(x_all[test_idx])
        codes = code_sets(z_test, args.k)
    dense = x_all.cpu().numpy() @ x_all.cpu().numpy().T
    test_auc = matched_auc(codes, episodes, dense, test_idx)
    with torch.no_grad():
        val_auc = matched_auc(
            code_sets(model(x_all[val_idx])[0], args.k), episodes, dense, val_idx
        )

    U = model.U.detach().cpu().numpy().astype(np.float32)
    V = model.V.detach().cpu().numpy().astype(np.float32)
    b = model.b.detach().cpu().numpy().astype(np.float32)
    out = os.path.join(ROOT, "weights.f32")
    with open(out, "wb") as fh:
        fh.write(U.tobytes())
        fh.write(V.tobytes())
        fh.write(b.tobytes())
    h = hashlib.sha256(open(out, "rb").read()).hexdigest()
    manifest = {
        "version": 1,
        "m": args.m,
        "rank": args.rank,
        "k": args.k,
        "dims": meta["dims"],
        "baseModel": meta["model"],
        "trainTurns": len(train_idx),
        "valTurns": len(val_idx),
        "testTurns": len(test_idx),
        "valMatchedAuc": val_auc,
        "testMatchedAuc": test_auc,
        "bestValLoss": best_val,
        "weightsHash": h,
        "epochs": args.epochs,
        "lr": args.lr,
        "batch": args.batch,
    }
    with open(os.path.join(ROOT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    print(json.dumps({"saved": out, **manifest}, indent=1))


if __name__ == "__main__":
    main()
