# Lore 四平台图标资产清单

Lore 是记忆珍珠与 Pod Lead 角色。基础识别点为：**奶油白微椭珠体、两只墨点眼、小高光、细墨线与 handoff 信笺**。本包不含帽子、围巾、耳机等配件。

## 平台资产

### Windows

- `Windows/icon.ico`：多尺寸应用图标，内嵌 16、24、32、48、64、128、256。
- `Windows/Lore_16.png` 至 `Lore_1024.png`：通用 PNG 尺寸矩阵。
- `Windows/icon.png`：1024×1024 主图标。
- 采用墨色圆角底板；16／24px 使用省略细线与信笺的简化 Base。

### macOS

- `macOS/icon.icns`：多分辨率应用与 Dock 图标。
- `macOS/icon_1024.png`：带安全边距的 1024×1024 主图。
- 另附 16、32、128、256、512 PNG。
- 相较 Windows／Linux 缩小角色占比，避免 squircle 遮罩和 Dock 显示时贴边。
- ICNS 已生成并回读；正式签名打包前，仍应在 macOS 构建链路中做最终验收。

### Linux

- `Linux/hicolor/<尺寸>x<尺寸>/apps/lore.png`：标准 hicolor 目录结构。
- 包含 16、22、24、32、48、64、128、256、512。
- `Linux/lore.png`：512×512 通用主图。

### Android

每个密度目录均包含：

- `ic_launcher.png`：普通 launcher 图标。
- `ic_launcher_round.png`：圆形 launcher 图标。
- `ic_launcher_foreground.png`：自适应图标透明前景。
- `ic_launcher_monochrome.png`：Android 13+ 单色主题前景。

| 密度 | Launcher PNG | Foreground / Monochrome |
|---|---:|---:|
| mdpi | 48×48 | 108×108 |
| hdpi | 72×72 | 162×162 |
| xhdpi | 96×96 | 216×216 |
| xxhdpi | 144×144 | 324×324 |
| xxxhdpi | 192×192 | 432×432 |

其他资源：

- `mipmap-anydpi-v26/`：普通与圆形自适应图标 XML。
- `mipmap-anydpi-v33/`：增加 `monochrome` 引用的 XML。
- `values/colors.xml`：背景色 `#1D1F25`。
- `play-store/ic_launcher-playstore.png`：512×512 Play Store 图标。
- 自适应前景的珍珠主体保留在中心安全区，信笺属于可裁切的非关键识别信息。

## 母版与预览

- `母版/Lore生成母版.png`：AI 生成的原始透明 Base。
- `母版/Lore透明Base_1024.png`：清理并规范化后的透明角色。
- `母版/Lore小尺寸简化Base_1024.png`：省略细线与信笺的小尺寸版本。
- `母版/Lore单色轮廓_1024.png`：单色主题及模板用途。
- `预览/Lore四平台图标预览.png`：四平台与 Android 资源形态总览。
- `预览/Android自适应图标预览.png`：自适应前景与背景合成效果。

## 验证与边界

- 16、24、32、48、64、128px 已做放大目检；16／24px 保留珠体、高光与眼睛，不强行保留细线。
- Windows ICO 与 macOS ICNS 均进行文件回读。
- Android 各密度尺寸、XML 语法和资源引用均进行校验；未执行完整 Android Gradle 打包。
- 当前为 PNG／ICO／ICNS／XML 资产，不含 SVG 或 Android Vector Drawable 源文件。
- 不包含 iOS、Windows Store、社交媒体横幅或配件变体。
