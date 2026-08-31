# Most Relevant Memory Entries

## Project Structure & Source Organization

1. **[mem_17877676]** - Pi runtime plugin: 5 source files + loader registerBuiltin
   - Context about source file organization and loader patterns

2. **[mem_17877151]** - Plugin-side opencode hook dependencies for runtime swap
   - Maps hook dependencies needed when changing runtime

3. **[mem_17877386]** - opencode-runtime has two responsibilities, split candidate
   - Identifies source layout and split candidates

4. **[mem_17878000]** - Two test locations with different tsconfig setups
   - Notes test directory structure differences

## Gateway Auth & Source Files

5. **[mem_17872925]** - Gateway auth logic duplicated across index.ts HTTP, index.ts WebSocket, auth-helpers.ts, and pairing.ts
   - Maps key gateway source files with auth duplication

6. **[mem_17872926]** - Log redaction duplicated in auth-helpers.ts and logger.ts, same regex for Bearer/token= stripping
   - Identifies logger source location

7. **[mem_17872927]** - Gateway reverse-proxies to opencode serve via http.request, gateway auth gate runs first
   - Describes gateway architecture flow

## CLI & Plugin System

8. **[mem_17876279]** - Gateway auth audit found 13 key files with 4x duplication across 3 separate auth channels
   - Gateway source file inventory

9. **[mem_17876279]** - Internal endpoints (A2A, artifacts, media, TTS, recall) are loopback-only enforced
   - Gateway endpoint structure

## Hooks & Tools Pattern

10. **[mem_17874582]** - Media Agent A2A endpoints enforce loopback-only access with 403 for non-local requests
    - Tool/handler pattern reference

11. **[mem_17874582]** - A2A SDK Part.fromJSON 自动归一化 flat wire format 到 content.$case
    - Tool implementation pattern

## Desktop & UI Structure

12. **[mem_17877151]** - No WindowControls component; platform-native decoration via Tauri decorum and Electron env variables
    - Desktop UI source structure

13. **[mem_17876699]** - UsageDock cookie 化通用化重构
    - Desktop component source location

## Key File Locations

14. **[mem_17872925]** - Auth helpers extracted for test but gateway inlines same logic
    - Source duplication pattern

15. **[mem_17877425]** - MAFW Desktop CSS import cascade and structure
    - CSS source organization

---

## Summary

The `src/` directory with `hooks/`, `tools/`, `types/`, `utils/` is the **plugin-side** source. The gateway source lives separately under `gateway/src/`. Key files to reference:
- `gateway/src/index.ts` - Main gateway monolith (4842 lines)
- `gateway/src/core/auth.ts` - Auth module
- `gateway/src/recall/` - Memory recall pipeline
- `gateway/src/runtime/` - Runtime capability system
- `src/hooks/` - Plugin hooks (opencode transforms)
- `src/tools/` - MCP tool implementations
