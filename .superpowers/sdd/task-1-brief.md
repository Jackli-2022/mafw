### Task 1: PopoverShell 扩展 below-center 锚定

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/pickers/PopoverShell.tsx`

**Interfaces:**
- Consumes: 现有 PopoverShell（`anchor: "tr" | "bl"`，fixed 定位、视口翻转、外部点击/Esc 关闭、Portal 到 body、自带主题变量）
- Produces: `anchor: "tr" | "bl" | "below-center"` —— below-center = 触发器下方 2px、水平居中；下方空间不足翻到上方

- [ ] **Step 1: 扩展 anchor 类型与 compute() 定位分支**

在 `PopoverShell.tsx` 中：

```tsx
export function PopoverShell(props: {
  open: boolean
  trigger: HTMLElement | null
  anchor: "tr" | "bl" | "below-center"
  onClose: () => void
  children: JSX.Element
  class?: string
}) {
```

`compute()` 内 `let top`/`let left` 逻辑改为（在既有 spaceAbove/spaceBelow 计算后）：

```tsx
    const rect = t.getBoundingClientRect()
    const W = 288
    const GAP = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const h = Math.min(selfRef()?.offsetHeight || 320, 380)
    const spaceAbove = rect.top - GAP
    const spaceBelow = vh - rect.bottom - GAP
    let top: number
    let left: number
    if (props.anchor === "below-center") {
      // Below the trigger, centered; flip above when not enough room below.
      if (spaceBelow >= h) {
        top = rect.bottom + 2
      } else {
        top = Math.max(8, rect.top - GAP - h)
      }
      left = rect.left + rect.width / 2 - W / 2
    } else {
      // Three-state placement: fully above → fully below → clamp on the larger side.
      if (spaceAbove >= h) {
        top = rect.top - GAP - h
      } else if (spaceBelow >= h) {
        top = rect.bottom + GAP
      } else if (spaceAbove >= spaceBelow) {
        top = Math.max(8, rect.top - GAP - h)
      } else {
        top = Math.min(vh - 8 - h, rect.bottom + GAP)
      }
      left = props.anchor === "tr" ? rect.right - W : rect.left
    }
    if (left < 8) left = 8
    if (left + W > vw - 8) left = vw - 8 - W
    setPos({ top, left })
```

- [ ] **Step 2: 构建验证**

Run: `cd opencode-dev/packages/desktop && npm run build`
Expected: `✓ built in ...`（无 error）

- [ ] **Step 3: 提交**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw/components/pickers/PopoverShell.tsx
git commit -m "feat(desktop): PopoverShell below-center anchor"
```

---

