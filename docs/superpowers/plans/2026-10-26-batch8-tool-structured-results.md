# Batch 8 — MCP Structured Tool Results Wrap-up

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline).

**Goal:** Give every MCP tool an `outputSchema` and automatic `structuredContent` while preserving text content.

**Spec:** `docs/superpowers/specs/2026-10-26-batch8-tool-structured-results-design.md`

## Tasks
- [x] Add auto-promotion in `gateway/src/mcp/call-result.ts`; tests for object/array/scalar/non-JSON.
- [x] Add generic outputSchema in `createToolRegistry()`; test all tools + bespoke first 3.
- [x] Full gateway tests; version 4.36.0; deploy.

## Verification (v4.36.0)
- gateway **2629**; SDK 148; TUI 225 (224 pass/1 skip); session-ui 89; desktop 1457 (shared workspace includes parallel TerminalDock).
- `toCallToolResult` object/array/scalar promotion tests pass; every `createToolRegistry().definitions` entry has object outputSchema.
- Deployed locally; no push.
