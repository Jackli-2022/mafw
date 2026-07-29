import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
export const modelsData: string = await (async () => {
  if (process.env.MODELS_DEV_API_JSON) {
    try { return await Bun.file(process.env.MODELS_DEV_API_JSON).text() }
    catch (e) { console.warn(`[generate] Failed to read MODELS_DEV_API_JSON, using empty fallback: ${e}`); return '{}' }
  }
  try {
    const res = await fetch(`${modelsUrl}/api.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    console.log("Loaded models.dev snapshot")
    return text
  } catch (e) {
    console.warn(`[generate] Failed to fetch models.dev snapshot, using empty fallback: ${e}`)
    return '{}'
  }
})()
