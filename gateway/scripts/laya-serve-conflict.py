#!/usr/bin/env python3
"""Thin stdlib HTTP sidecar for Modusnsus/laya-nli-memory-conflict.

GET  /health      -> {"ok": true, "model": "..."}
POST /v1/predict  -> {"answers": {"conflict": {"noul": p}}}  (passthrough of laya predict)

Env: LAYA_PORT (default 13129), LAYA_DEVICE (default cpu),
     HF_ENDPOINT (gateway sets https://hf-mirror.com — huggingface.co is
     unreachable from this network; must be set BEFORE huggingface_hub import).

Run `python laya-serve-conflict.py --selftest` for an end-to-end checkpoint check.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = "Modusnsus/laya-nli-memory-conflict"
QUESTION = {
    "type": "noul",
    "instructions": "新信息(new)与已有记忆(known)是否冲突？冲突=矛盾需更新旧记忆，兼容=一致或无关",
    "labels": {"false": "兼容", "true": "冲突"},
}
agent = None


def load_agent():
    global agent
    import laya  # deferred: HF_ENDPOINT must be in env before hub import

    agent = laya.load(MODEL_ID, device=os.environ.get("LAYA_DEVICE", "cpu"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": agent is not None, "model": MODEL_ID})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/predict":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length).decode("utf-8"))
            result = agent.predict(req["state"], req["questions"])
            self._send(200, result)
        except Exception as e:  # noqa: BLE001 — sidecar must never crash on bad input
            self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        print(f"[laya-serve] {fmt % args}", flush=True)


def selftest():
    load_agent()
    r1 = agent.predict({"known": "用户对花生过敏", "new": "用户想试试花生酱饼干"}, {"conflict": QUESTION})
    p1 = float(r1["answers"]["conflict"]["noul"])
    r2 = agent.predict({"known": "用户对花生过敏", "new": "用户今天吃了米饭"}, {"conflict": QUESTION})
    p2 = float(r2["answers"]["conflict"]["noul"])
    print(f"peanut conflict p={p1:.3f} (expect >0.5)")
    print(f"rice compatible p={p2:.3f} (expect <0.5)")
    ok = p1 > 0.5 and p2 < 0.5
    print("SELFTEST", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    load_agent()
    port = int(os.environ.get("LAYA_PORT", "13129"))
    print(f"[laya-serve] listening on 127.0.0.1:{port} model={MODEL_ID} device={os.environ.get('LAYA_DEVICE', 'cpu')}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
