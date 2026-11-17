"""Baseline + learned-code evaluation for engram-P1.

Reads the frozen dataset exported by export-engram-dataset.ts.
No training, no writes outside stdout.
"""
import argparse
import json
import os

import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "fixtures", "engram-p1")
K = 16


def load():
    with open(os.path.join(ROOT, "meta.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    vectors = np.fromfile(os.path.join(ROOT, "vectors.f32"), dtype=np.float32)
    vectors = vectors.reshape(meta["turns"], meta["dims"])
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return meta, vectors / norms


def kwta(vectors, k=K):
    return np.argpartition(-np.abs(vectors), k, axis=1)[:, :k]


def load_learned(vectors, manifest_path, weights_path, k=K):
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    m, rank, dims = manifest["m"], manifest["rank"], manifest["dims"]
    raw = np.fromfile(weights_path, dtype=np.float32)
    u = raw[: m * rank].reshape(m, rank)
    v = raw[m * rank : m * rank + rank * dims].reshape(rank, dims)
    b = raw[m * rank + rank * dims :]
    a = (vectors @ v.T) @ u.T + b
    return np.argpartition(-np.abs(a), k, axis=1)[:, :k]


def jaccard_sets(a, b):
    inter = np.intersect1d(a, b).size
    union = np.union1d(a, b).size
    return 1.0 if union == 0 else inter / union


def pair_scores(codes, idx):
    return np.array([jaccard_sets(codes[i], codes[j]) for i, j in idx])


def dense_pair_scores(vectors, idx):
    return np.array([float(vectors[i] @ vectors[j]) for i, j in idx])


def auc(pos, neg):
    if len(pos) == 0 or len(neg) == 0:
        return None
    allv = np.concatenate([pos, neg])
    order = np.argsort(allv, kind="mergesort")
    ranks = np.empty(len(allv), dtype=float)
    ranks[order] = np.arange(1, len(allv) + 1)
    sorted_vals = allv[order]
    i = 0
    while i < len(sorted_vals):
        j = i
        while j + 1 < len(sorted_vals) and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        if j > i:
            avg = (i + j + 2) / 2.0
            ranks[order[i : j + 1]] = avg
        i = j + 1
    pos_ranks = ranks[: len(pos)]
    return float((pos_ranks.sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def matched_auc(pairs, labels, scores, dense):
    """AUC of code scores for same vs different episode, within dense bins."""
    bins = [0.0, 0.3, 0.5, 0.7, 0.8, 0.9, 1.01]
    total = 0.0
    weighted = 0.0
    for b in range(len(bins) - 1):
        idx = [k for k in range(len(pairs)) if bins[b] <= dense[k] < bins[b + 1]]
        pos = [scores[k] for k in idx if labels[k]]
        neg = [scores[k] for k in idx if not labels[k]]
        if len(pos) < 2 or len(neg) < 2:
            continue
        w = len(pos) * len(neg)
        weighted += auc(pos, neg) * w
        total += w
    return weighted / total if total else None


def evaluate(meta, vectors, code_map, split="test"):
    items = meta["items"]
    episodes = [it.get("episodeId") for it in items]
    sessions = [it["sessionId"] for it in items]
    in_split = [i for i, it in enumerate(items) if it["split"] == split]

    same_ep, hard_neg, random_pairs = [], [], []
    rng = np.random.default_rng(7)
    for i in in_split:
        for j in in_split:
            if i >= j:
                continue
            if episodes[i] and episodes[i] == episodes[j]:
                same_ep.append((i, j))
            elif episodes[i] and episodes[j] and episodes[i] != episodes[j]:
                if float(vectors[i] @ vectors[j]) >= 0.7:
                    hard_neg.append((i, j))
    for _ in range(3000):
        i, j = rng.choice(in_split, size=2, replace=False)
        if episodes[i] and episodes[j] and episodes[i] != episodes[j] and sessions[i] != sessions[j]:
            random_pairs.append((int(i), int(j)))

    pairs, labels, dense_vals = [], [], []
    for i in in_split:
        for j in in_split:
            if i >= j or not episodes[i] or not episodes[j]:
                continue
            pairs.append((i, j))
            labels.append(episodes[i] == episodes[j])
            dense_vals.append(float(vectors[i] @ vectors[j]))

    out = {
        "split": split,
        "turns": len(in_split),
        "sameEpisodePairs": len(same_ep),
        "hardNegatives": len(hard_neg),
        "randomPairs": len(random_pairs),
    }

    out["dense"] = {
        "sameVsRandomAuc": auc(dense_pair_scores(vectors, same_ep), dense_pair_scores(vectors, random_pairs)),
        "sameMean": float(dense_pair_scores(vectors, same_ep).mean()) if same_ep else None,
        "randomMean": float(dense_pair_scores(vectors, random_pairs).mean()) if random_pairs else None,
    }

    for name, codes in code_map.items():
        same_scores = pair_scores(codes, same_ep) if same_ep else np.array([])
        hard_scores = pair_scores(codes, hard_neg) if hard_neg else np.array([])
        rand_scores = pair_scores(codes, random_pairs) if random_pairs else np.array([])
        code_vals = [jaccard_sets(codes[i], codes[j]) for i, j in pairs]
        df = codes.flatten()
        counts = np.bincount(df, minlength=vectors.shape[1])
        out[name] = {
            "sameVsRandomAuc": auc(same_scores, rand_scores),
            "matchedAuc": matched_auc(pairs, labels, code_vals, dense_vals),
            "sameMean": float(same_scores.mean()) if len(same_scores) else None,
            "hardMean": float(hard_scores.mean()) if len(hard_scores) else None,
            "randomMean": float(rand_scores.mean()) if len(rand_scores) else None,
            "maxBitShare": float(counts.max() / len(codes)),
            "effectiveBits": int((counts > 0).sum()),
        }

    # top-1 same episode and R@10 within the split.
    for name, sim in [
        ("dense", lambda i: vectors[in_split] @ vectors[i]),
        *[
            (code_name, (lambda i, c=codes: np.array([jaccard_sets(c[i], c[j]) for j in in_split])))
            for code_name, codes in code_map.items()
        ],
    ]:
        hits1 = 0
        hits10 = 0
        total = 0
        for pos, i in enumerate(in_split):
            if not episodes[i]:
                continue
            total += 1
            scores = sim(i)
            order = [o for o in np.argsort(-scores) if in_split[o] != i][:10]
            if order and episodes[in_split[order[0]]] == episodes[i]:
                hits1 += 1
            if any(episodes[in_split[o]] == episodes[i] for o in order):
                hits10 += 1
        out[name]["top1SameEpisode"] = hits1 / total if total else None
        out[name]["recallAt10"] = hits10 / total if total else None

    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", default=os.path.join(ROOT, "weights.f32"))
    parser.add_argument("--manifest", default=os.path.join(ROOT, "manifest.json"))
    args = parser.parse_args()

    meta, vectors = load()
    code_map = {"kwta": kwta(vectors)}
    if os.path.exists(args.weights) and os.path.exists(args.manifest):
        code_map["learned"] = load_learned(vectors, args.manifest, args.weights)

    result = {
        "model": meta["model"],
        "dims": meta["dims"],
        "turns": meta["turns"],
        "splits": meta["splits"],
        "eval": [evaluate(meta, vectors, code_map, split) for split in ("test", "val", "train")],
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
