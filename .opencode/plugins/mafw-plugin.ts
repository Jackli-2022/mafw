/**
 * MAFW Plugin Registration — dev loop shim
 *
 * OpenCode 自动扫描 .opencode/plugins/ 目录加载本 shim，原生加载 TS 直连仓库源码。
 * v2.2.5 起插件 import 按文件相对路径解析（Bun ResolveMessage）：
 * `../../src/plugin`（从 .opencode/plugins/ 出发）= <repo>/src/plugin.ts。
 * 发布入口由 package.json 的 main + opencode.plugin 字段指定：dist/plugin.js（全局安装用）。
 */

export { default } from '../../src/plugin';
