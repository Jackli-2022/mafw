# Session Memories

## Code & Architecture

- Desktop CSS uses single mafw.css with theme tokens and v2 data-attribute styling; all components use ButtonV2/TextInputV2/SwitchV2 from @opencode-ai/ui/v2/*
- MAFW Desktop CSS import cascade and monolithic structure - CSS source and compiled output can diverge; Desktop styles must exist in source mafw.css, not only in compiled out/ directory, or they disappear after rebuild
- Desktop CSS build pipeline only concatenates @import content, no postcss/tailwind transformation
- SolidJS Show non-keyed null pitfall - must snapshot before clear; throws on null signal children
- Desktop out/ is gitignored build artifact containing compiled CSS
- Desktop uses electron-vite with Tailwind CSS v4 for CSS build pipeline

## HMR & Dev Server

- Desktop dev mode serves source not built bundle
- vite 管道是活的（mafw.css 热更到达），但 touch 不触发 Config.tsx HMR — 需要真实内容修改验证

## Build & Deploy

- Gateway 全局包部署需手动停前台进程避免 EBUSY on Windows
- npm run build → npm pack → npm install -g opencode-plugin-mafw-*.tgz
- Desktop needs `cd opencode-dev/packages/desktop && npm install` before build (workspace resolution for @mafw/sdk)
- Windows deploy: build + robocopy + restart + verify frontend

## Gateway Architecture

- Gateway HTTP route regex must use (?:\?|$) instead of $ to match URLs with query strings
- Gateway binds 0.0.0.0:3000 with 3-channel token auth; loopback bypass; A2A/Python extra loopback guard
- Gateway config: env > global yaml > data yaml > defaults; hot-reload with restart-required reporting
- Data root at ~/.mafw
- Gateway SSE events broadcast to subscribed clients for real-time updates
- Gateway and desktop deployment workflow steps

## Agent System

- Runtime contract seam implemented and reviewed, ready to merge
- Pi runtime plugin: in-process SDK embedding, Tier 2 capabilities
- Manager agent config: edit deny, task deny, bash allow, 35 mafw_* MCP tools whitelisted
- Worker model default changed to alibaba-cn/qwen3.7-max

## Memory System

- BM25 is default retriever with 0.949 R10 but L2 QA gap
- Memory system 三层存储：harmonic index + OKF files + SQLite
- mafw_add_memory handler has zero conflict awareness
- Three-layer recursion prevention and 15min frequency gating for step injection
- Worker pool: 64 cap, 24h TTL, 8h compaction, exclusive concurrency per session

## Security

- Gateway auth uses single static token with three channels
- Auth logic duplicated between tests and gateway
- PairingService has rate limiting and hashed nonces
- API token in URL query string is credential leakage risk

## Mobile

- Flutter mobile uses WS + FCM + Tailscale for gateway comms
- Three-tier mobile connectivity: Tailscale WAN + mDNS LAN + manual fallback
- Android security hardening Task 1 completed: gateway auth, loopback, log redaction, SecureStorage

## LongMemEval

- L2 accuracy progression from 0.75 to 0.896
- Multi-session L2 accuracy stuck at 0.375 due to per-session reflection blindness
- Enumerate-then-aggregate with DeepSeek v4-flash improved overall to 0.854
