# @mafw/relay (M1)

Local relay core for MAFW mobile remote access. It routes by TLS SNI; the host
terminates TLS, so the relay only forwards ciphertext.

## Run locally

```bash
RELAY_DOMAIN=relay.localhost \
RELAY_LISTEN_HOST=127.0.0.1 \
RELAY_TLS_PORT=9443 \
RELAY_CONTROL_PORT=9444 \
RELAY_ADMIN_PORT=9080 \
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

M1 is in-memory only: room claims disappear on restart and SQLite persistence
lands with the deploy milestone. It is not ready for public traffic.
