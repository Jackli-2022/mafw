# Orcalore · Lore Lead Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the Lore platform icon pack, derive circular-safe Lead avatars plus tray/favicon assets, and make Lore the Lead's visual identity in ProjectResources and SessionStrip — without changing the Lead role name or switching production app icons before the Orcalore rename.

**Architecture:** Assets first: normalize the provided `Lore平台图标资产/` pack into ASCII paths, then a deterministic Pillow script derives avatar/tray/favicon outputs from the three masters. UI wiring is a pure role→avatar helper plus two small component changes; app icon/tray/favicon runtime stays untouched until the Orcalore rename.

**Tech Stack:** Python 3 + Pillow (asset derivation/tests), TypeScript + SolidJS (renderer), node:test + `@mafw/test-shim`, Vite PNG imports, tsgo, electron-vite.

**Spec:** `docs/superpowers/specs/2026-11-05-orcalore-lore-character-design.md`

## Global Constraints

- **Lore = Lead 的视觉身份 / 头像**；Lead 名字不变；Tech Lead / Builder / Reviewer 保留首字母，不使用 Lore。**SessionStrip Lead tab 不放大头像**（用户 2026-11-05 决定），保留 L 徽标。
- **No orca form**: cream/white pearl, two ink dot eyes, highlight, ink outline; no eye patch, dorsal fin, tail, or O-shaped whale body.
- **Avatars use the simplified base**: no thread/tag; circular-safe; 64 / 96 / 128 / 256 / 512.
- **Do not switch production app icon / tray / favicon**: this plan imports and derives assets only; the Orcalore rename plan consumes them.
- **PodDock member rows stay as-is** in v1: role label + name is the identity; no avatar row added.
- **v1 is visual-only**: no Lore dialogue strings.
- **Palette**: `#FCF8F1` cream, `#FFFFFF` white, `#1D1F25` ink, `#4FD388` mint accent.
- **TDD**: every behavior task starts with a failing test; Python tests use Pillow; desktop tests run with `--conditions=browser`.
- **Commit per task**, with the test command and result in the commit body or final report.

## Review Focus

These are the input/failure classes most likely to bite a user even though the spec only implies them. Each gets a test in the owning task.

1. **16px avatar legibility** — the pearl must still show two eyes and a highlight, not a blank dot.
2. **Circular crop clipping** — no tag/thread inside avatars; the pearl must not touch the circular edge.
3. **Role leakage** — Lore must appear only for `lead`; Tech Lead / Builder / Reviewer keep initials.
4. **Lead tab without Pod detail** — a Lead tab with `lead: true` but `podRoleOf` not resolved must still show Lore.
5. **Light/dark contrast** — the cream pearl needs its ink outline/border so it does not disappear on a light surface.

---

## Task 1: Import and normalize the Lore platform icon pack

**Files:**
- Create: `assets/brand/lore/README.md`
- Create: `assets/brand/lore/source/lore-pearl-1024.png`
- Create: `assets/brand/lore/source/lore-pearl-simplified-1024.png`
- Create: `assets/brand/lore/source/lore-monochrome-1024.png`
- Create: `assets/brand/lore/platform/windows/**` (from `Lore平台图标资产/Windows/`)
- Create: `assets/brand/lore/platform/macos/**` (from `Lore平台图标资产/macOS/`)
- Create: `assets/brand/lore/platform/linux/**` (from `Lore平台图标资产/Linux/`)
- Create: `assets/brand/lore/platform/android/**` (from `Lore平台图标资产/Android/`)
- Create: `assets/brand/lore/platform/previews/four-platform.png` (from `预览/Lore四平台图标预览.png`)
- Create: `assets/brand/lore/platform/previews/android-adaptive.png` (from `预览/Android自适应图标预览.png`)
- Create: `assets/brand/lore/platform/ASSETS.md` (copy of `Lore平台图标资产/资产清单.md`, UTF-8)
- Test: `packages/desktop/scripts/test_lore_assets_import.py`

**Interfaces:**
- Consumes: the untracked input pack at `Lore平台图标资产/` (not committed).
- Produces: ASCII asset paths under `assets/brand/lore/` used by Task 2 and the later Orcalore rename plan.

- [ ] **Step 1: Write the failing import test**

```python
# packages/desktop/scripts/test_lore_assets_import.py
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
LORE = ROOT / "assets" / "brand" / "lore"

def test_source_masters_exist():
    for name in ("lore-pearl-1024.png", "lore-pearl-simplified-1024.png", "lore-monochrome-1024.png"):
        im = Image.open(LORE / "source" / name)
        assert im.size == (1024, 1024)
        assert im.mode == "RGBA"

def test_platform_exports_exist():
    ico = Image.open(LORE / "platform" / "windows" / "icon.ico")
    assert {(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)} <= set(ico.info["sizes"])
    assert (LORE / "platform" / "macos" / "icon.icns").read_bytes()[:4] == b"icns"
    assert (LORE / "platform" / "android" / "mipmap-anydpi-v26" / "ic_launcher.xml").exists()
    assert (LORE / "platform" / "android" / "values" / "colors.xml").read_text(encoding="utf-8").find("#1D1F25") >= 0
    assert (LORE / "platform" / "previews" / "four-platform.png").exists()
    assert (LORE / "platform" / "previews" / "android-adaptive.png").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest packages/desktop/scripts/test_lore_assets_import.py -q`
Expected: FAIL with `FileNotFoundError` for `assets/brand/lore/source/lore-pearl-1024.png`.

- [ ] **Step 3: Import and normalize the pack**

Run this one-off copy from the repo root (PowerShell; adjust if using another shell). Do **not** commit `Lore平台图标资产/`.

```powershell
$src = "Lore平台图标资产"
$dst = "assets/brand/lore"
New-Item -ItemType Directory -Force "$dst/source","$dst/platform" | Out-Null
Copy-Item "$src/母版/Lore透明Base_1024.png" "$dst/source/lore-pearl-1024.png"
Copy-Item "$src/母版/Lore小尺寸简化Base_1024.png" "$dst/source/lore-pearl-simplified-1024.png"
Copy-Item "$src/母版/Lore单色轮廓_1024.png" "$dst/source/lore-monochrome-1024.png"
Copy-Item "$src/Windows" "$dst/platform/windows" -Recurse
Copy-Item "$src/macOS" "$dst/platform/macos" -Recurse
Copy-Item "$src/Linux" "$dst/platform/linux" -Recurse
Copy-Item "$src/Android" "$dst/platform/android" -Recurse
New-Item -ItemType Directory -Force "$dst/platform/previews" | Out-Null
Copy-Item "$src/预览/Lore四平台图标预览.png" "$dst/platform/previews/four-platform.png"
Copy-Item "$src/预览/Android自适应图标预览.png" "$dst/platform/previews/android-adaptive.png"
Copy-Item "$src/资产清单.md" "$dst/platform/ASSETS.md"
```

Create `assets/brand/lore/README.md` with:
- provenance: generated by the user; original pack not committed;
- the three source masters and their meaning;
- `platform/` is a read-only export pack for the later Orcalore rename;
- generated assets live in `export/` (Task 2);
- no SVG / Vector Drawable source yet.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest packages/desktop/scripts/test_lore_assets_import.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/brand/lore packages/desktop/scripts/test_lore_assets_import.py
git commit -m "chore(brand): import Lore platform icon pack"
```

---

## Task 2: Derive Lead avatars, tray templates, and favicon

> **Rev 2026-11-05:** the user supplied `Lore平台图标资产/Avatar/` (15 sizes × circle/transparent) after this task started. Actual execution **copies that pack** instead of deriving avatars; tray/favicon derivation is unchanged. UI uses **32px circle** (ProjectResources) and **16px circle** (SessionStrip). The avatar tests below are superseded by `test_avatar_pack_sizes_and_variants` / `test_ui_avatar_copies` / `test_avatar_16px_circle_has_contrast` / `test_avatar_32px_has_eyes`.

**Files:**
- Create: `packages/desktop/scripts/build_lore_assets.py`
- Create: `packages/desktop/scripts/test_build_lore_assets.py`
- Create: `assets/brand/lore/export/avatar/lore-avatar-{64,96,128,256,512}.png`
- Create: `assets/brand/lore/export/tray/loreTemplate-{16,20,24,32}.png` and `@2x` variants
- Create: `assets/brand/lore/export/favicon/favicon-{16,32,48}.png` + `favicon.ico`
- Create: `packages/desktop/src/renderer/mafw/assets/lore/lead-avatar-{64,96,128,256,512}.png`

**Interfaces:**
- Consumes: `assets/brand/lore/source/lore-pearl-simplified-1024.png`, `source/lore-monochrome-1024.png`, `platform/windows/Lore_{16,32,48}.png`.
- Produces: avatar PNGs consumed by Task 4/5; tray/favicon assets for the later rename plan.

**Key algorithm (implementer choice only where stated):**
- `square_crop(im, pad_ratio)`: take the alpha bbox, side = `round(max(bbox_w, bbox_h) * (1 + 2 * pad_ratio))`, center on the bbox center, clamp to the image, crop square.
- Avatars: `pad_ratio = 0.08`; resize LANCZOS to 512/256/128/96/64; save RGBA; **always from the simplified base** (no thread/tag).
- Tray: build a monochrome silhouette from the simplified base alpha (white `#FFFFFF` with alpha); `pad_ratio = 0.04`; sizes 16/20/24/32 and 32/40/48/64 (`@2x`).
- Favicon: copy `platform/windows/Lore_16.png`, `Lore_32.png`, `Lore_48.png` to `export/favicon/favicon-{16,32,48}.png`; build `favicon.ico` with sizes `[(16,16),(32,32),(48,48)]`.
- Copy all avatar PNGs to `packages/desktop/src/renderer/mafw/assets/lore/lead-avatar-{size}.png` (only 64 is consumed in v1; the rest are for future surfaces).

- [ ] **Step 1: Write the failing derivation tests**

```python
# packages/desktop/scripts/test_build_lore_assets.py
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
EXPORT = ROOT / "assets" / "brand" / "lore" / "export"
RENDERER = ROOT / "packages" / "desktop" / "src" / "renderer" / "mafw" / "assets" / "lore"
AVATARS = (64, 96, 128, 256, 512)

def test_avatar_sizes_mode_and_safe_margin():
    for size in AVATARS:
        im = Image.open(EXPORT / "avatar" / f"lore-avatar-{size}.png")
        assert im.size == (size, size)
        assert im.mode == "RGBA"
        bbox = im.getchannel("A").getbbox()
        assert bbox is not None
        left, top, right, bottom = bbox
        margin = max(2, round(size * 0.03))
        assert left >= margin and top >= margin
        assert right <= size - margin and bottom <= size - margin
        # no tag/thread: the alpha bbox stays near-square
        assert abs((right - left) - (bottom - top)) <= size * 0.12

def test_avatar_has_eyes_and_outline():
    im = Image.open(EXPORT / "avatar" / "lore-avatar-64.png").convert("RGBA")
    w, h = im.size
    dark = 0
    for y in range(h // 4, h * 3 // 4):
        for x in range(w // 4, w * 3 // 4):
            r, g, b, a = im.getpixel((x, y))
            if a > 200 and r < 80 and g < 80 and b < 80:
                dark += 1
    assert dark >= 4, "64px avatar lost its eyes"

def test_avatar_16px_legibility():
    im = Image.open(EXPORT / "avatar" / "lore-avatar-64.png").convert("RGBA").resize((16, 16), Image.LANCZOS)
    dark = 0
    for y in range(4, 12):
        for x in range(4, 12):
            r, g, b, a = im.getpixel((x, y))
            if a > 160 and r < 90 and g < 90 and b < 90:
                dark += 1
    assert dark >= 2, "16px avatar lost its eyes"

def test_avatar_has_ink_outline():
    im = Image.open(EXPORT / "avatar" / "lore-avatar-64.png").convert("RGBA")
    alpha = im.getchannel("A")
    w, h = im.size
    dark = 0
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if alpha.getpixel((x, y)) < 200:
                continue
            edge = any(alpha.getpixel((x + dx, y + dy)) < 32 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if not edge:
                continue
            r, g, b, a = im.getpixel((x, y))
            if r < 90 and g < 90 and b < 90:
                dark += 1
    assert dark > 0, "avatar lost its ink outline"

def test_tray_sizes_and_monochrome():
    for base in (16, 20, 24, 32):
        for name, size in (
            (f"loreTemplate-{base}.png", base),
            (f"loreTemplate-{base}@2x.png", base * 2),
        ):
            im = Image.open(EXPORT / "tray" / name).convert("RGBA")
            assert im.size == (size, size)
            opaque = [p for p in im.getdata() if p[3] > 0]
            assert opaque
            assert len({p[:3] for p in opaque}) == 1, "tray template must be monochrome"

def test_favicon_png_and_ico():
    for size in (16, 32, 48):
        assert Image.open(EXPORT / "favicon" / f"favicon-{size}.png").size == (size, size)
    ico = Image.open(EXPORT / "favicon" / "favicon.ico")
    assert {(16, 16), (32, 32), (48, 48)} <= set(ico.info["sizes"])

def test_renderer_avatar_copies_exist():
    for size in AVATARS:
        assert (RENDERER / f"lead-avatar-{size}.png").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest packages/desktop/scripts/test_build_lore_assets.py -q`
Expected: FAIL with `FileNotFoundError` for `assets/brand/lore/export/avatar/lore-avatar-64.png`.

- [ ] **Step 3: Implement `build_lore_assets.py`**

Use the constants and algorithm above. Keep the script idempotent; create output directories with `mkdir(parents=True, exist_ok=True)`. Print one line per output group.

- [ ] **Step 4: Run the script and verify tests pass**

Run:
```bash
python packages/desktop/scripts/build_lore_assets.py
python -m pytest packages/desktop/scripts/test_build_lore_assets.py -q
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/brand/lore/export packages/desktop/src/renderer/mafw/assets/lore packages/desktop/scripts/build_lore_assets.py packages/desktop/scripts/test_build_lore_assets.py
git commit -m "feat(brand): derive Lore avatars, tray, and favicon"
```

---

## Task 3: Add the role→avatar helper

**Files:**
- Create: `packages/desktop/src/renderer/mafw/lead-avatar.ts`
- Create: `packages/desktop/src/renderer/mafw/lead-avatar.test.ts`

**Interfaces:**
- Consumes: `PodMemberRole` from `@mafw/sdk`.
- Produces:
  - `type MemberAvatar = { kind: "lore" } | { kind: "initial"; text: string }`
  - `memberAvatar(role: string, displayName: string): MemberAvatar`
  - `sessionPodRole(role: PodMemberRole | null | undefined, lead: boolean | undefined): PodMemberRole | null`

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/renderer/mafw/lead-avatar.test.ts
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { memberAvatar, sessionPodRole } from "./lead-avatar"

describe("memberAvatar", () => {
  test("lead uses Lore", () => {
    assert.deepEqual(memberAvatar("lead", "Lead"), { kind: "lore" })
  })
  test("other roles keep initials", () => {
    assert.deepEqual(memberAvatar("tech_lead", "Tech Lead"), { kind: "initial", text: "T" })
    assert.deepEqual(memberAvatar("builder", "Builder"), { kind: "initial", text: "B" })
    assert.deepEqual(memberAvatar("reviewer", "Reviewer"), { kind: "initial", text: "R" })
  })
  test("empty display name falls back to ?", () => {
    assert.deepEqual(memberAvatar("builder", "  "), { kind: "initial", text: "?" })
  })
})

describe("sessionPodRole", () => {
  test("lead flag wins when Pod detail is not loaded", () => {
    assert.equal(sessionPodRole(null, true), "lead")
  })
  test("explicit role wins", () => {
    assert.equal(sessionPodRole("builder", false), "builder")
  })
  test("no role and no lead flag is null", () => {
    assert.equal(sessionPodRole(null, false), null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

From `packages/desktop`:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-avatar.test.ts
```
Expected: FAIL with `Cannot find module './lead-avatar'`.

- [ ] **Step 3: Implement `lead-avatar.ts`**

```ts
import type { PodMemberRole } from "@mafw/sdk"

export type MemberAvatar = { kind: "lore" } | { kind: "initial"; text: string }

export function memberAvatar(role: string, displayName: string): MemberAvatar {
  if (role === "lead") return { kind: "lore" }
  return { kind: "initial", text: displayName.trim().charAt(0) || "?" }
}

export function sessionPodRole(
  role: PodMemberRole | null | undefined,
  lead: boolean | undefined,
): PodMemberRole | null {
  return role ?? (lead ? "lead" : null)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command; expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/lead-avatar.ts packages/desktop/src/renderer/mafw/lead-avatar.test.ts
git commit -m "feat(desktop): add Lore Lead avatar role helper"
```

---

## Task 4: Render the Lore avatar in ProjectResources

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectResources.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/src/renderer/mafw/lead-avatar-css.test.ts`

**Interfaces:**
- Consumes: `memberAvatar` (Task 3), `leadAvatar64` from `../assets/lore/lead-avatar-64.png` (Task 2).
- Produces: Lead row renders a circular Lore avatar; other roles keep initials.

- [ ] **Step 1: Write the failing CSS contract test**

```ts
// packages/desktop/src/renderer/mafw/lead-avatar-css.test.ts
import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

const css = readFileSync(new URL("./mafw.css", import.meta.url), "utf8")

test("ProjectResources Lore avatar fills its circular slot", () => {
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*width:\s*100%/s)
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*height:\s*100%/s)
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*border-radius:\s*50%/s)
  assert.match(css, /\.mafw-resource-avatar\s*\{[^}]*overflow:\s*hidden/s)
})
```

- [ ] **Step 2: Run test to verify it fails**

From `packages/desktop`:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-avatar-css.test.ts
```
Expected: FAIL on the first `assert.match`.

- [ ] **Step 3: Add the CSS rules**

CSS in `mafw.css` after the `.mafw-resource-avatar.is-reviewer` rule:

```css
.mafw-resource-avatar { overflow: hidden; }
.mafw-resource-avatar img {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 50%;
  object-fit: cover;
}
```

- [ ] **Step 4: Wire ProjectResources**

In `ProjectResources.tsx`:
- Import `leadAvatar32` from `../assets/lore/lead-avatar-32.png`.
- Import `memberAvatar` from `../lead-avatar`.
- Inside the `<For each={rows()}>` row block, add:
  ```ts
  const avatar = () => memberAvatar(row.role, row.displayName)
  const avatarText = () => {
    const a = avatar()
    return a.kind === "initial" ? a.text : ""
  }
  const isLore = () => avatar().kind === "lore"
  ```
- Replace the avatar span body:
  ```tsx
  <span class={`mafw-resource-avatar is-${row.role}`} aria-hidden="true">
    <Show when={isLore()} fallback={avatarText()}>
      <img src={leadAvatar32} alt="" />
    </Show>
  </span>
  ```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-avatar-css.test.ts src/renderer/mafw/lead-avatar.test.ts
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ProjectResources.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/lead-avatar-css.test.ts
git commit -m "feat(desktop): render Lore as the Lead avatar"
```

---

## Task 5: Replace the Lead tab badge with the Lore avatar

> **Rev 2026-11-05:** after seeing the 16px tab, the user rejected the Lore avatar in the Lead session tab. This task is **reverted**: SessionStrip keeps the L role badge; no avatar on the tab. The brand-slot change from the follow-up request (Orcalore wordmark + Lore 20px icon) remains.

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/SessionStrip.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/src/renderer/mafw/lead-avatar-css.test.ts`

**Interfaces:**
- Consumes: `sessionPodRole` (Task 3), `leadAvatar64` (Task 2).
- Produces: Lead tab shows a 16px circular Lore avatar; Tech Lead / Builder / Reviewer keep the existing L/T/B/R-style badge (non-Lead roles keep their current badge).

- [ ] **Step 1: Extend the failing CSS test**

Append to `lead-avatar-css.test.ts`:

```ts
test("SessionStrip Lore avatar is a 16px circle", () => {
  assert.match(css, /\.mafw-session-lead-avatar\s*\{[^}]*width:\s*16px/s)
  assert.match(css, /\.mafw-session-lead-avatar\s*\{[^}]*height:\s*16px/s)
  assert.match(css, /\.mafw-session-lead-avatar\s*\{[^}]*border-radius:\s*50%/s)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run the same CSS test command; expected: FAIL on `.mafw-session-lead-avatar`.

- [ ] **Step 3: Add the 16px avatar CSS**

CSS:

```css
.mafw-session-lead-avatar {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-left: 4px;
  border-radius: 50%;
  display: block;
  object-fit: cover;
}
```

- [ ] **Step 4: Wire SessionStrip**

In `SessionStrip.tsx`:
- Import `leadAvatar16` from `../assets/lore/lead-avatar-16.png`.
- Import `sessionPodRole` from `../lead-avatar`.
- Inside the `<For each={props.sessions()}>` block, add:
  ```ts
  const podRole = () => sessionPodRole(props.podRoleOf?.(s.id), s.lead)
  ```
- Replace the existing `<Show when={props.podRoleOf?.(s.id)}>` block with:
  ```tsx
  <Show when={podRole()}>
    {(role) => (
      <Show
        when={role() === "lead"}
        fallback={
          <TooltipV2 value={`Pod · ${role()}`} openDelay={300}>
            <span class="mafw-session-pod-badge" aria-label={`Pod ${role()}`}>{podRoleBadge(role())}</span>
          </TooltipV2>
        }
      >
        <TooltipV2 value="Pod · Lead" openDelay={300}>
          <img class="mafw-session-lead-avatar" src={leadAvatar16} alt="Pod Lead" />
        </TooltipV2>
      </Show>
    )}
  </Show>
  ```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-avatar-css.test.ts src/renderer/mafw/lead-avatar.test.ts
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/SessionStrip.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/lead-avatar-css.test.ts
git commit -m "feat(desktop): show Lore in the Lead session tab"
```

---

## Task 6: Full verification and asset documentation

**Files:**
- Modify: `assets/brand/lore/README.md` (add the generation commands and file map)
- No runtime code.

- [ ] **Step 1: Update `assets/brand/lore/README.md`**

Add:
- `python packages/desktop/scripts/build_lore_assets.py` regenerates `export/` and the renderer avatar copies.
- `python -m pytest packages/desktop/scripts/test_lore_assets_import.py packages/desktop/scripts/test_build_lore_assets.py -q` verifies sizes, safe margins, monochrome tray, favicon frames.
- The `platform/` pack is for the later Orcalore rename; it is not wired to production icons in this plan.
- Avatars deliberately omit the thread/tag; the tag lives in app icon / hero / character sheet.

- [ ] **Step 2: Run the asset tests**

```bash
python -m pytest packages/desktop/scripts/test_lore_assets_import.py packages/desktop/scripts/test_build_lore_assets.py -q
```
Expected: PASS.

- [ ] **Step 3: Run the desktop test suite**

From `packages/desktop`:
```bash
npm test
```
Expected: PASS; record the new total and suite count. Baseline at v5.0.0 is 2853/2853; this plan adds ~8 tests, so expect a higher total.

- [ ] **Step 4: Typecheck and build**

From `packages/desktop`:
```bash
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
Expected: both rc=0.

- [ ] **Step 5: Manual smoke (if a Pod project is available)**

Run `npm run dev`, open a Pod project, and verify:
- ProjectResources Lead row shows the pearl avatar; Tech Lead / Builder / Reviewer still show initials.
- The Lead session tab shows the 16px pearl avatar; B/T/R badges are unchanged.
- At chat widths 520 / 640 / 760, the tab strip does not overflow and the avatar is not clipped.
- Light and dark themes both show the pearl outline/border.

- [ ] **Step 6: Commit**

```bash
git add assets/brand/lore/README.md
git commit -m "docs(brand): document Lore asset derivation"
```

---

## Out of Scope (this plan)

- Switching production app icon / tray / favicon: the Orcalore rename plan consumes `assets/brand/lore/platform/` and `export/tray` / `export/favicon`.
- PodDock member-row avatars: role label + name remains the identity in v1.
- Character sheet, expressions, accessories, doodles, desktop pet: v2.
- Lore dialogue / voice strings: v1 is visual-only.
- SVG / Vector Drawable source: the pack is raster; a vector redraw is a later asset task.
