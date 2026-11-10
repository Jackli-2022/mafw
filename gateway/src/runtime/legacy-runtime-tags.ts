/**
 * One-release legacy tag centralization (Phase 4 W4).
 *
 * Rows written before runtime tagging existed can only have come from the
 * builtin opencode driver. The guard allowlist names this file instead of
 * scattering the literal through migrations.
 *
 * @deprecated remove with the Phase 4.1 legacy-plugin shim.
 */
export const LEGACY_RUNTIME_TAG = 'opencode';
