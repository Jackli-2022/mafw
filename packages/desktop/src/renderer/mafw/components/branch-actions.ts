// W0-2（2026-10-28）：fork/revert 会话分支动作的能力门。
// 仅当 runtime 显式声明 sessionBranchApi=false 时隐藏（如 minimal/external）；
// undefined（caps 未加载）与 true 都保持显示——pi 声明 true（revert 语义弱化、
// 无文件回滚，契约注释为准），不属于本门职责。
export function branchActionsVisible(caps: { sessionBranchApi?: boolean } | undefined): boolean {
  return caps?.sessionBranchApi !== false
}
