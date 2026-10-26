// Capture 附件桥：BrowserDock（G2）把元素截图交给 ChatPane 的 attachments 管道。
// G1 在 ChatPane 内部直接 addPastedFile；G2 跨组件，用单例 sink 解耦。
type Sink = (file: File) => void

let sink: Sink | null = null

export function registerCaptureSink(fn: Sink): () => void {
  sink = fn
  return () => {
    if (sink === fn) sink = null
  }
}

export function pushCaptureFile(file: File): void {
  sink?.(file)
}
