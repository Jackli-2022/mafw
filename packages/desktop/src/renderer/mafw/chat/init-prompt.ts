export const INIT_AGENTS_PROMPT = `请初始化本仓库的 AGENTS.md：
1. 先读取已有的 AGENTS.md / CLAUDE.md、README、docs/ 和构建配置。
2. 如果 AGENTS.md 已存在，保留现有内容，只补充缺失的高价值章节；不要重写无关内容。
3. 如果不存在，创建 AGENTS.md，覆盖：项目用途、目录地图、构建/测试/类型检查命令、代码风格、硬不变量、常见陷阱。
4. 不要执行破坏性命令，不要提交 git。完成后用几句话总结改了什么。`
