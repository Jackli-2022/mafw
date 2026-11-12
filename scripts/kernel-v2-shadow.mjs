#!/usr/bin/env node
/**
 * Read-only v1/v2 shadow compare for kernel-v2 Phase 1.
 *
 * Usage:
 *   node scripts/kernel-v2-shadow.mjs --v1 http://127.0.0.1:3000 --v2 http://127.0.0.1:3100
 *
 * Exit codes: 0 = normalized payloads match; 1 = diff/error; 2 = bad args.
 */

const args = process.argv.slice(2)
function arg(name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const v1 = arg('--v1')
const v2 = arg('--v2')
if (!v1 || !v2) {
  console.error('usage: node scripts/kernel-v2-shadow.mjs --v1 <url> --v2 <url>')
  process.exit(2)
}

async function get(base, path) {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return await res.json()
}

function normalizeHealth(value) {
  return { status: value?.status ?? null }
}

function normalizeTts(value) {
  const voices = Array.isArray(value?.voices) ? value.voices : []
  const engines = Array.isArray(value?.engines) ? value.engines : []
  return {
    engine: value?.engine ?? null,
    sampleRate: value?.sampleRate ?? null,
    voiceIds: voices.map((voice) => voice?.id).filter(Boolean).sort(),
    engineNames: engines.map((engine) => engine?.name).filter(Boolean).sort(),
  }
}

function normalizeUsage(value) {
  const providers = Array.isArray(value?.providers) ? value.providers : []
  return {
    providers: providers
      .map((provider) => ({
        name: provider?.name ?? null,
        severity: provider?.severity ?? null,
        windows: (Array.isArray(provider?.windows) ? provider.windows : [])
          .map((window) => ({
            window: window?.window ?? null,
            unit: window?.unit ?? null,
            limit: window?.limit ?? null,
          }))
          .sort((a, b) => String(a.window).localeCompare(String(b.window))),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  }
}

const checks = [
  ['/health', normalizeHealth],
  ['/api/tts/voices', normalizeTts],
  ['/api/usage', normalizeUsage],
]

let failed = false
for (const [path, normalize] of checks) {
  try {
    const [left, right] = await Promise.all([get(v1, path), get(v2, path)])
    const a = JSON.stringify(normalize(left))
    const b = JSON.stringify(normalize(right))
    if (a !== b) {
      failed = true
      console.error(`DIFF ${path}`)
      console.error(`  v1: ${a}`)
      console.error(`  v2: ${b}`)
    } else {
      console.log(`OK   ${path}`)
    }
  } catch (error) {
    failed = true
    console.error(`ERROR ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

process.exit(failed ? 1 : 0)
