# Web 端设计决策

## 真源

仓库根的 `DESIGN.md` 是唯一真源。令牌文件、色卡图与 HeroUI 的 CSS 变量都与它对齐，冲突时以它为准。本文件只记大方向，同步方式见[设计文档索引](../index.md)。

## 组件系统

| 项 | 结论 |
|---|---|
| 组件库 | HeroUI v3（`@heroui/react` + `@heroui/styles` 3.2.5），要求 React 19 与 Tailwind v4 |
| 现代版 | 直接用 HeroUI v3 |
| 兼容版 | 复用 v3 的 `heroui.min.css` 做 CSS 降级；组件用 React 18 自己实现，DOM 结构与类名跟 v3 一致 |
| 设计侧 | Pen 的 `pencil-heroui.pen` 复制为 `web/design/heroui.lib.pen`，固定版本 |

## 设计标准

### 色卡标准

规定颜色怎么存、怎么取名，让设计稿、代码与设计工具共用同一份色值。

| 项 | 结论 |
|---|---|
| 格式 | DTCG 2025.10，后缀 `.tokens.json` |
| 校验 | 官方 JSON Schema `https://www.designtokens.org/schemas/2025.10/format.json` |
| 位置 | `doc/design/web/asset/` |

### 令牌分层

规定变量的层次与引用方向，让换主题只改一层的值，不动组件代码。

只能下层引用上层：

| 层 | 内容 | 例子 |
|---|---|---|
| reference | 原始值 | `--gray-100` |
| system | 语义角色 | `--background`、`--accent` |
| component | 组件内部变量 | `--button-bg` |

### 字号标准

规定字号档位怎么命名，名字说用途不说数值，改字号不动名字。

角色取 Material 3 的五个，各分 large / medium / small：display、headline、title、body、label。具体数值在 `## 版式` 定。

### 动效标准

规定全站动效的时长与缓动，让节奏统一，降级时改一处即可。

两类令牌：`duration`（时长）与 `cubicBezier`（缓动曲线）。具体数值在 `## 动效` 定。

## 兼容版降级（目标 Chromium 86）

- `oklch()` 转 sRGB
- `color-mix()` 预计算
- `@layer` 展开
- `:is()`、`:where()` 改写

## 配色系统

## 渐变与底图

## Shader

## 版式

## 布局

## 圆角与阴影

## 动效

## 诊断卡片

## 会话与设置
