const fs = require("fs")
const p = "packages/desktop/src/renderer/mafw/components/ChatPane.tsx"
let s = fs.readFileSync(p, "utf8")

// 1. add onSetUserMsgId to useSendMessage deps
s = s.replace(
  "onCreateSession: () => props.onCreateSession(),",
  "onCreateSession: () => props.onCreateSession(),\n    onSetUserMsgId: (s2, id) => props.onSetUserMsgId(s2, id),"
)

// 2. forceAnchor TDZ fix
s = s.replace(
  "    forceAnchor,\n    imageToDataUrl,",
  "    forceAnchor: () => forceAnchor(),\n    imageToDataUrl,"
)

// 3. Show callback bug: s() is boolean (when is a boolean expr) — access the memo directly
s = s.replace(
  '<Show when={sessionTokenSummary().turns > 0}>\n                  {(s) => (\n                    <TooltipV2 value={`${fmtCtx(s().total)} tokens · ${s().turns} 回合${s().cost > 0 ? ` · $${s().cost.toFixed(4)}` : \'\'}`} openDelay={300}>',
  '<Show when={sessionTokenSummary().turns > 0}>\n                  {() => (\n                    <TooltipV2 value={`${fmtCtx(sessionTokenSummary().total)} tokens · ${sessionTokenSummary().turns} 回合${sessionTokenSummary().cost > 0 ? ` · $${sessionTokenSummary().cost.toFixed(4)}` : \'\'}`} openDelay={300}>'
)

fs.writeFileSync(p, s, "utf8")
console.log("patched:", s.includes("onSetUserMsgId: (s2, id)"), s.includes("forceAnchor: () => forceAnchor()"), !s.includes("s().total"))
