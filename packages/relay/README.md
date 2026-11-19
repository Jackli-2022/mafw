# @mafw/relay (M4 core)

Relay core for MAFW mobile remote access. It routes by TLS SNI; the host
terminates TLS, so the relay only forwards ciphertext.

## Run locally

```bash
RELAY_DOMAIN=relay.localhost \
RELAY_LISTEN_HOST=127.0.0.1 \
RELAY_TLS_PORT=9443 \
RELAY_CONTROL_PORT=9444 \
RELAY_ADMIN_PORT=9080 \
RELAY_DB=/tmp/mafw-relay.db \
node --experimental-strip-types src/index.ts
```

Health: `curl http://127.0.0.1:9080/health` → `{"status":"ok"}`.

Env:

| Variable | Default | Meaning |
|---|---|---|
| `RELAY_DOMAIN` | required | SNI suffix, e.g. `relay.example.com` |
| `RELAY_LISTEN_HOST` | `0.0.0.0` | bind host (use `127.0.0.1` for dev) |
| `RELAY_TLS_PORT` | `443` | raw TLS / SNI router |
| `RELAY_CONTROL_PORT` | `8444` | host control WSS |
| `RELAY_ADMIN_PORT` | `8080` | health (bind on `RELAY_LISTEN_HOST`) |
| `RELAY_DB` | empty | SQLite file for durable room claims; empty = in-memory |

Room claims survive restarts when `RELAY_DB` points at a writable file.

## Docker

```bash
cp .env.example .env              # set RELAY_DOMAIN
# put the control-channel cert at ./certs/{fullchain.pem,privkey.pem}
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

Ports:

- `443` — raw TLS/SNI router (never terminate here).
- `8444` — host control WSS; expose only through Caddy/your TLS terminator.
- `8080` — health; the compose file binds it to `127.0.0.1` only.

The bundled `Caddyfile` terminates TLS on `8443` for the control channel and
proxies to `relay:8444`. The gateway config uses
`wss://<RELAY_DOMAIN>:8443/host`. `auto_https off` is intentional: the relay
needs raw 443, so the control cert must be supplied (DNS-01/ACME elsewhere).

## Limits

- M4 local pieces only: no public deployment until the domain is ready.
- `Quota` is wired into room creation, router stream admission/release and
  both byte directions. Per-room 2Mbps is enforced; the global 4Mbps cap is
  not wired yet. There is no `/metrics` endpoint.
- Admin `/health` is metadata-only.
