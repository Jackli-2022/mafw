import * as http from "node:http"
import * as fs from "node:fs"
import * as path from "node:path"
import { randomBytes } from "node:crypto"
import type { BrowserWindow } from "electron"
import { write as writeLog } from "./logging"

interface AutomationRequest {
  method: string
  url?: string
  body?: any
}

interface AutomationResponse {
  status: number
  body: any
}

export interface AutomationHandle {
  port: number
  secret: string
  stop: () => void
}

export function startAutomationServer(
  screenshotsDir: string,
  getWindow: () => BrowserWindow | null,
): AutomationHandle {
  const secret = randomBytes(32).toString("hex")
  const server = http.createServer()

  server.on("request", async (req, res) => {
    const sendJson = (status: number, body: any) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    }

    const auth = req.headers["authorization"] || ""
    if (auth !== `Bearer ${secret}`) {
      sendJson(401, { error: "Unauthorized" })
      return
    }

    const body = await readBody(req)
    const r: AutomationRequest = {
      method: req.method || "GET",
      url: req.url,
      body: body ? JSONParse(body) : undefined,
    }

    try {
      const result = await handleRequest(r, screenshotsDir, getWindow)
      sendJson(result.status, result.body)
    } catch (err: any) {
      writeLog("automation", "request failed", { url: r.url, error: err.message }, "error")
      sendJson(500, { error: err.message })
    }
  })

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address()
    if (addr && typeof addr === "object") {
      writeLog("automation", "server started", { port: addr.port }, "info")
    }
  })

  function stop() {
    server.close()
  }

  const port = () => {
    const addr = server.address()
    return addr && typeof addr === "object" ? addr.port : 0
  }

  return {
    get port() { return port() },
    secret,
    stop,
  }
}

async function handleRequest(
  req: AutomationRequest,
  screenshotsDir: string,
  getWindow: () => BrowserWindow | null,
): Promise<AutomationResponse> {
  const win = getWindow()
  if (!win || win.isDestroyed()) return { status: 503, body: { error: "No window available" } }

  const url = req.url || ""
  const parsed = new URL(url, "http://localhost")

  if (req.method === "GET" && parsed.pathname === "/screenshot") {
    const selector = parsed.searchParams.get("selector") || undefined
    return await takeScreenshot(win, screenshotsDir, selector)
  }

  if (req.method === "GET" && parsed.pathname === "/ui-state") {
    return await getUiState(win)
  }

  if (req.method === "POST" && parsed.pathname === "/navigate") {
    return await navigateTab(win, req.body?.tab)
  }

  if (req.method === "POST" && parsed.pathname === "/click") {
    return await clickElement(win, req.body?.selector)
  }

  if (req.method === "POST" && parsed.pathname === "/type") {
    return await typeText(win, req.body?.selector, req.body?.text)
  }

  if (req.method === "POST" && parsed.pathname === "/scroll") {
    return await scrollPage(win, req.body?.direction, req.body?.amount)
  }

  return { status: 404, body: { error: "Not found" } }
}

async function takeScreenshot(
  win: BrowserWindow,
  screenshotsDir: string,
  selector?: string,
): Promise<AutomationResponse> {
  const rect = selector
    ? await win.webContents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      })()`)
    : null

  if (selector && !rect) return { status: 404, body: { error: `Element not found: ${selector}` } }

  const img = rect
    ? await win.webContents.capturePage(rect)
    : await win.webContents.capturePage()

  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true })
  const filename = `screenshot-${Date.now()}.png`
  const filePath = path.join(screenshotsDir, filename)
  fs.writeFileSync(filePath, img.toPNG())
  const size = img.getSize()

  return {
    status: 200,
    body: { filePath, width: size.width, height: size.height },
  }
}

async function getUiState(win: BrowserWindow): Promise<AutomationResponse> {
  const state = await win.webContents.executeJavaScript(`(() => {
    const activeTab = document.querySelector('.mafw-tab.active');
    const elements = [...document.querySelectorAll('button, h2, h3, h4, span, a, input, textarea, select, [role=button], [role=tab], [role=option]')]
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      })
      .slice(0, 200)
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 80),
          id: el.id || undefined,
          className: (el.className || '').split(' ').filter(Boolean).slice(0, 3).join(' '),
          boundingBox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          type: el.getAttribute ? el.getAttribute('type') || undefined : undefined,
        };
      });
    return {
      tab: activeTab ? activeTab.textContent.trim().toLowerCase() : 'unknown',
      elements,
      dimensions: { width: window.innerWidth, height: window.innerHeight },
      scrollPosition: { x: Math.round(window.scrollX || 0), y: Math.round(window.scrollY || 0) },
    };
  })()`)
  return { status: 200, body: state }
}

async function navigateTab(win: BrowserWindow, tab?: string): Promise<AutomationResponse> {
  if (!tab) return { status: 400, body: { error: "tab is required" } }

  const validTabs = ["chat", "goals", "memory", "approvals", "triage", "automation"]
  if (!validTabs.includes(tab)) return { status: 400, body: { error: `Invalid tab: ${tab}. Valid: ${validTabs.join(", ")}` } }

  await win.webContents.executeJavaScript(`(() => {
    const buttons = document.querySelectorAll('.mafw-tab');
    for (const btn of buttons) {
      if ((btn.textContent || '').trim().toLowerCase() === ${JSON.stringify(tab)}) {
        btn.click();
        return true;
      }
    }
    // Try matching by data attribute or aria-label
    const alt = document.querySelector(\`[data-tab="${tab}"], [aria-label="${tab}"]\`);
    if (alt) { alt.click(); return true; }
    return false;
  })()`)

  return { status: 200, body: { ok: true, currentTab: tab } }
}

async function clickElement(win: BrowserWindow, selector?: string): Promise<AutomationResponse> {
  if (!selector) return { status: 400, body: { error: "selector is required" } }

  const result = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { error: "Element not found: " + ${JSON.stringify(selector)} };
    const r = el.getBoundingClientRect();
    const tag = el.tagName;
    const text = (el.textContent || '').trim().slice(0, 60);
    el.click();
    return { clicked: true, element: { tag, text, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  })()`)

  if (result.error) return { status: 404, body: result }
  return { status: 200, body: result }
}

async function typeText(win: BrowserWindow, selector?: string, text?: string): Promise<AutomationResponse> {
  if (!selector || text === undefined) return { status: 400, body: { error: "selector and text are required" } }

  const result = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { error: "Element not found: " + ${JSON.stringify(selector)} };
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable)
      return { error: "Element is not an input/textarea/contentEditable" };
    el.focus();
    if (el.isContentEditable) {
      el.textContent = ${JSON.stringify(text)};
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(el, ${JSON.stringify(text)});
      } else {
        el.value = ${JSON.stringify(text)};
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { typed: true, value: ${JSON.stringify(text)} };
  })()`)

  if (result.error) return { status: 400, body: result }
  return { status: 200, body: result }
}

async function scrollPage(win: BrowserWindow, direction?: string, amount?: number): Promise<AutomationResponse> {
  if (!direction || !["up", "down", "left", "right"].includes(direction)) {
    return { status: 400, body: { error: "direction must be up/down/left/right" } }
  }

  const delta = amount || 200
  const deltaMap: Record<string, { x: number; y: number }> = {
    up: { x: 0, y: -delta },
    down: { x: 0, y: delta },
    left: { x: -delta, y: 0 },
    right: { x: delta, y: 0 },
  }
  const d = deltaMap[direction]

  win.webContents.sendInputEvent({
    type: "mouseWheel",
    x: 0,
    y: 0,
    deltaX: d.x,
    deltaY: d.y,
    canScroll: true,
  } as any)

  return { status: 200, body: { ok: true } }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ""
    req.on("data", (chunk: string) => (body += chunk))
    req.on("end", () => resolve(body))
  })
}

function JSONParse(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
