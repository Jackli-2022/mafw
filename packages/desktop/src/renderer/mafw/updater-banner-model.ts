import type { UpdaterState } from "../../types/updater"

export function updaterBannerModel(state: UpdaterState): {
  visible: boolean
  title: string | null
  detail: string | null
  action: "install" | null
} {
  if (state.status !== "ready") {
    return { visible: false, title: null, detail: null, action: null }
  }
  return {
    visible: true,
    title: "更新已下载",
    detail: `MAFW ${state.version} 将在重启后安装`,
    action: "install",
  }
}
