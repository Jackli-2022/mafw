// 内容分屏：显式对照的只读第二文档。主文档保留自己的编辑/预览状态，
// 文件树在分屏态下把点击送到这里；关闭分屏不影响主文档。
import { Show, createEffect, createSignal } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { fileKindFor } from "../file-kind"
import { fileProtocol } from "../file-protocol-client"
import { splitRelPath } from "../recent-content"

export function SplitDocumentPane(props: {
  root: string | null
  rel: string | null
  onClose: () => void
}) {
  const [content, setContent] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [version, setVersion] = createSignal(0)

  createEffect(() => {
    const root = props.root
    const rel = props.rel
    setContent(null)
    setError(null)
    if (!root || !rel) return
    if (fileKindFor(rel) === "image") {
      void fileProtocol.ensureRootToken(root).then((token) => {
        if (!token) {
          if (root === props.root && rel === props.rel) setError("图片协议注册失败")
          return
        }
        if (root === props.root && rel === props.rel) setVersion(Date.now())
      })
      return
    }
    void window.api.fs.readFile(root, rel).then((res) => {
      if (root !== props.root || rel !== props.rel) return
      if (res.ok) {
        setContent(res.content)
        return
      }
      setError(res.reason === "not-found" ? "文件不存在（可能已被移动/删除）" : "无法读取该文件")
    }).catch(() => {
      if (root === props.root && rel === props.rel) setError("无法读取该文件")
    })
  })

  const name = () => (props.rel ? splitRelPath(props.rel).name : "对照")
  const isImage = () => !!props.rel && fileKindFor(props.rel) === "image"
  const imageUrl = () => {
    const root = props.root
    return root && props.rel ? (fileProtocol.urlFor(root, props.rel, version()) ?? "") : ""
  }

  return (
    <section class="mafw-rw-split" aria-label="分屏对照">
      <div class="mafw-rw-split-head">
        <span class="mafw-rw-split-title">{name()}</span>
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-rw-split-close"
          aria-label="关闭分屏"
          onClick={props.onClose}
        >
          <Icon name="close" size="small" />
        </ButtonV2>
      </div>
      <Show
        when={props.rel}
        fallback={<div class="mafw-rw-split-empty">从文件树选择第二个文件进行对照</div>}
      >
        <Show when={isImage()}>
          <div class="mafw-rw-split-image">
            <img src={imageUrl()} alt={name()} />
          </div>
        </Show>
        <Show when={!isImage() && content() !== null}>
          <pre class="mafw-rw-split-body">{content()}</pre>
        </Show>
        <Show when={error()}>
          <div class="mafw-rw-split-empty">{error()}</div>
        </Show>
      </Show>
    </section>
  )
}
