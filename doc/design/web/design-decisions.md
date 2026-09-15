# Web 端设计决策

## 真源

仓库根的 `DESIGN.md` 是唯一真源。令牌文件、色卡图与 HeroUI 的 CSS 变量都与它对齐，冲突时以它为准。本文件只记大方向，同步方式见[设计文档索引](../README.md)。

## 组件系统

| 项 | 结论 |
|---|---|
| 组件库 | HeroUI v3（`@heroui/react` + `@heroui/styles` 3.2.5），要求 React 19 与 Tailwind v4 |
| 现代版 | 直接用 HeroUI v3 |
| 兼容版 | 复用 v3 的 `heroui.min.css` 做 CSS 降级；组件用 React 18 自己实现，DOM 结构与类名跟 v3 一致 |

## 设计标准

规定「怎么写」，不含具体值。具体值在各设计章节。

### 令牌格式

规定令牌怎么存进文件。只管文件长什么样，不管取什么颜色。

用 DTCG 2025.10，后缀 `.tokens.json`。

| 项 | 结论 |
|---|---|
| 校验 | 官方 JSON Schema `https://www.designtokens.org/schemas/2025.10/format.json` |
| 位置 | `doc/design/web/asset/` |

### 令牌分层

规定变量的层次与引用方向，让换主题只改一层的值，不动组件代码。

只能下层引用上层：

| 层 | 内容 | 例子 |
|---|---|---|
| reference | 原始值 | `--neutral-9` |
| system | 语义角色 | `--background`、`--accent` |
| component | 组件内部变量 | `--button-bg` |

### 字号标准

规定字号档位怎么命名，名字说用途不说数值，改字号不动名字。

角色取 Material 3 的五个，各分 large / medium / small：display、headline、title、body、label。具体数值在 `## 版式` 定。

### 动效标准

规定全站动效的时长与缓动，让节奏统一，降级时改一处即可。

两类令牌：`duration`（时长）与 `cubicBezier`（缓动曲线）。具体数值在 `## 动效` 定。

### 兼容版降级（目标 Chromium 86）

现代版直接用新语法，兼容版在构建时改写成旧内核能认的形式。

| 改写 | 做法 |
|---|---|
| `oklch()` | 转 sRGB |
| `color-mix()` | 预计算成固定值 |
| `@layer` | 展开 |
| `:is()` `:where()` | 改写 |


## 配色系统

由三个外部来源拼成，各管一层，互不替代。不是三选一，是同一件事的不同层。

| 层 | 管什么 | 来源 |
|---|---|---|
| 角色 | 界面哪块用什么 | HeroUI v3（`@heroui/styles` 3.2.5） |
| 组织 | 一个色相多少档、每档干什么 | [Radix Colors](https://www.radix-ui.com/colors)（MIT） |
| 色值 | 具体是什么颜色 | 自己生成 |
| 格式 | 怎么存进文件 | DTCG 2025.10，见[令牌格式](#令牌格式) |

取色顺序：先按界面位置找到 HeroUI 的角色名，再看它属于第几步用途，最后取该步的色值。

HeroUI 的命名规则：无后缀是背景色，`-foreground` 是压在上面的文字色。

### 12 步用途

色阶定为 12 步。每步绑定一种界面用途，取色依据是用途，不是明暗编号。

| 步 | 用途 | 界面落点 |
|---|---|---|
| 1 | 页面背景 | 主界面底色、画布区域 |
| 2 | 次级背景 | 卡片、隔行、侧栏 |
| 3 | 交互元素底色 | 按钮与输入框默认态 |
| 4 | 悬停底色 | 指针移到元素上 |
| 5 | 按下与选中底色 | 点击态、选中项 |
| 6 | 弱边框 | 静态分隔线 |
| 7 | 元素边框 | 输入框、卡片边框 |
| 8 | 强边框与焦点环 | 悬停边框、键盘焦点 |
| 9 | 实心色块 | 主按钮、徽标 |
| 10 | 实心色块悬停 | 主按钮悬停态 |
| 11 | 低对比文字 | 次要说明、占位符 |
| 12 | 高对比文字 | 正文、标题 |

第 9 步色度最高。浅色底上的第 9 步配白字，深色底上配深色字，都要过 WCAG AA 4.5:1。

明暗两套分开调，不用反转或混色派生。

划分画布见 [web/design/cst-pilot-colors.pen](../../web/design/cst-pilot-colors.pen)，导出的图见 [asset/cst-pilot-color-steps.png](asset/cst-pilot-color-steps.png)。

### 与令牌分层的对应

三层令牌在本配色系统里分别装什么：

| 令牌层 | 内容 | 例子 |
|---|---|---|
| reference | 色阶的一档 | `--accent-9` |
| system | HeroUI 的语义角色 | `--accent` |
| component | 组件内部变量 | `--button-bg` |

### 采用的方案

中性色偏蓝，色相 230°，色度 0.012。彩色四系：主色蓝 254°、成功绿 151°、警告琥珀 72°、危险红 26°。峰值色度系数 0.94。

色阶由 oklch 曲线算出，不是手挑的固定值。生成器见 [asset/make-color-scale.mjs](asset/make-color-scale.mjs)。

| 项 | 规则 |
|---|---|
| 明度 | 12 步各有基准明度，浅深两套独立 |
| 色度 | 每步一个相对系数，第 9 步拉满 |
| 黄色系 | 第 9/10 步按色相提亮，越接近 100° 抬得越多 |
| 超出色域 | 保明度与色相，压低色度 |

令牌见 [asset/cst-pilot-colors.tokens.json](asset/cst-pilot-colors.tokens.json)，色卡图见 [asset/cst-pilot-color-scale.png](asset/cst-pilot-color-scale.png)。

备选方案（中性纯灰、中性偏青）已归档到 [web/design/achieved/](../../web/design/achieved/)。

## 渐变与底图

## Shader

## 版式

## 布局

## 圆角与阴影

## 动效

## 诊断卡片

## 会话与设置
