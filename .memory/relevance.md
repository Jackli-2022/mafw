# Memory Relevance: Config.tsx (Usage Config)

## Primary Relevance

| ID | Relevance | Reason |
|---|---|---|
| [id:mem_17876666] | ⭐⭐⭐ | "Desktop shell and dock component locations" — Config page is part of desktop shell layout |
| [id:mem_17876556] | ⭐⭐⭐ | "UsageDock component structure and location" + "UsageDock data flow pipeline" — directly related to usage config |
| [id:mem_17876739] | ⭐⭐⭐ | "UsageDock cookie delete mechanism" + "Three mafw_add_memory write paths" — usage config management |
| [id:mem_17877963] | ⭐⭐⭐ | "Config system: 3-layer priority, auto env vars, hot-reload" — Config page reads/writes this system |
| [id:mem_17873724] | ⭐⭐ | "Config: env > global yaml > data yaml > defaults; hot-reload with restart-required reporting" — config persistence mechanism |
| [id:mem_17878434] | ⭐⭐ | "插件切换器热切换实现完成" — Config page has plugin switcher (runtime/media/model-config) |
| [id:mem_17876699] | ⭐⭐ | "UsageDock cookie 化重构" — usage config refactoring context |

## Contextual Relevance

| ID | Relevance | Reason |
|---|---|---|
| [id:mem_17877963] | ⭐ | "Runtime plugin capability merging" — Config page has Runtime/Media/Model tabs |
| [id:mem_17874586] | ⭐ | "Dashboard port 3111 has zero auth, exposes config" — security context for config writes |
| [id:mem_17876699] | ⭐ | "PUT config writes to homedir .mafw not .config" — config write path |
