// 项目首页 › 项目文件：复用内容工作台的文件树，但固定在项目主目录 scope。
// headerAction 只负责把用户送到完整内容工作台；普通点击仍走项目 scope 打开。
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { FilesDock } from "./FilesDock"

export function ProjectFilesCard(props: {
  root: string | null
  scopeKey: string | null
  sessionID?: string | null
  onOpenFile: (rel: string) => void
  onBrowse: () => void
}) {
  return (
    <div class="mafw-project-files-card">
      <FilesDock
        contentRoot={props.root}
        scopeKey={props.scopeKey}
        sessionID={props.sessionID ?? null}
        title="项目文件"
        onOpenFile={props.onOpenFile}
        headerAction={
          <TooltipV2 value="在内容工作台打开" openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-project-files-browse"
              aria-label="在内容工作台打开项目文件"
              onClick={props.onBrowse}
            >
              <Icon name="layout-right-full" size="small" />
            </ButtonV2>
          </TooltipV2>
        }
      />
    </div>
  )
}
