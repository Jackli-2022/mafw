# Desktop Icons

MAFW-branded desktop app icons ("茉芙 / Mafu", the waveform-diva mascot). Spec:
`docs/superpowers/specs/2026-09-10-desktop-icon-design.md`.

## Layout

```
icons/
  concepts/          AI-generated source candidates (CogView-4, kept for provenance)
  master/            processed 1024x1024 master (watermark removed, AI metadata embedded)
  prod/  dev/  beta/ channel outputs consumed by scripts/copy-icons.ts
```

Channels: `prod` standard / `dev` blueprint grid overlay / `beta` orange BETA corner badge.
`predev`/`prebuild` copy the selected channel to `resources/icons/` which
`electron-builder.config.ts` and the dev window icon read from — no config
changes needed when regenerating.

## Regenerating

Requires Python 3.10+ and Pillow (`pip install Pillow`):

```bash
# from repo root
python packages/desktop/scripts/build_icons.py
python -m pytest packages/desktop/scripts/test_build_icons.py -q
```

`build_icons.py` reads `icons/concepts/icon-concept-zhipu-2.png` and emits, per
channel: `icon.png` (512), `dock.png` (256), 32/64/128/256 PNGs, `icon.ico`
(16-256 frames) and `icon.icns` (macOS squircle-safe 88% inset, written
manually — no external icns tool needed).

To iterate on the artwork, generate new candidates into `icons/concepts/`,
update `SOURCE` in `build_icons.py` (and `WM_BOX` if the new image has a
watermark in a different spot), then re-run.

## AI-content compliance

The master image is AI-generated (CogView-4). The visible "AI生成" watermark is
removed in post-processing; per 方案 A of the spec, the PNGs embed an
`AI-Generated` tEXt metadata chunk (ico/icns formats cannot carry it), and the
attribution should be declared in the app's About page / distribution channel.
Do not strip the metadata chunk when re-encoding PNGs.
