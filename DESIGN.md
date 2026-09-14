---
version: alpha
name: CST Pilot Web
description: 计维队便携诊断工具 cst-pilot 的 Web 操作界面设计系统
omitted:
  - section: typography
    reason: 字体与字号阶梯未定
  - section: spacing
    reason: 间距比例未定
  - section: rounded
    reason: 圆角语言未定
  - section: components
    reason: 组件 token 未定，组件库已定为 HeroUI v3
colors:
  primary: "#1976d2"
  primary-deep: "#0d47a1"
  primary-sky: "#38bdf8"
  primary-frost: "#f8fbff"
  accent: "#7fd7c4"
  ink: "#101413"
---

# CST Pilot Web 设计系统

状态：骨架。标注「待定」的位置在讨论后替换为结论，替换后把对应 token 组补进 front matter。

格式依据 [DESIGN.md Format](https://github.com/google-labs-code/design.md)（alpha）。本文件放在仓库根目录，供 Pen 从工作目录读取。方向性决策记在 [设计决策](doc/design/web/design-decisions.md)，产品与技术方向见 [Web 决策](doc/design/web/decision.md)。

## Overview

面向计维队员的现场诊断界面。队员在机主电脑上打开浏览器，与后端 Agent 对话，查看诊断卡片的输出，按模型给出的建议手动执行修复。

观感方向待定。W3 要求现代观感：动效精美、UI 极简。

### 品牌标识

品牌来自 TUI 的 `branding` 扩展（`agent/home/extensions/branding/header.ts`），Web 端延续，不另立品牌。

| 项 | 值 | 来源 |
|---|---|---|
| 名称 | cst-pilot | 全项目 |
| 英文标语 | CST-pilot on your side | TUI 页眉 `ASK_LINE` |
| 中文标语 | 用心服务，真诚为您 | TUI 页眉 `TAGLINE` |
| 标志 | `assets/logo.png`，由 ANSI Shadow 艺术字「CST-PILOT」生成 | `assets/make-logo.cjs` |
| 主色带 | 严格蓝带，色相 199–218°，不偏紫不偏青 | TUI 页眉注记 |

待定：标志在 Web 中的用法（位置、尺寸、是否做矢量版）、标语是否出现在界面、是否需要 favicon 与深色底适配版本。

### 使用者与场景

| 项 | 内容 |
|---|---|
| 使用者 | 计维队员 |
| 设备 | 机主电脑，Windows 10/11 x64 |
| 浏览器 | 现代版按 Chromium 111 以上，兼容版按 Chromium 86 |
| 网络 | 页面资源随包提供，加载不依赖 CDN |
| 与 TUI 的关系 | 同一后端会话，两套界面反映同一执行结果 |

## Colors

配色方向待定。已确定的是品牌色带，语义色与亮暗两套方案未定。

- **Primary（#1976D2）：** 品牌湛蓝，取自 LOGO 渐变节点。
- **Primary Deep（#0D47A1）：** 深湛蓝，LOGO 渐变的暗端。
- **Primary Sky（#38BDF8）：** 天蓝，LOGO 渐变的亮端。
- **Primary Frost（#F8FBFF）：** 近白，LOGO 渐变的最亮节点。
- **Accent（#7FD7C4）：** 青绿强调色，TUI 用于提示文案，Web 是否沿用待定。
- **Ink（#101413）：** 近黑，TUI 终端背景色。

待定的 token 组：

| 组 | 用途 |
|---|---|
| `surface` / `on-surface` | 页面与卡片的背景、前景 |
| 状态色 | 成功、执行中、降级、失败 |
| 数据可视化色板 | 占用率、占比、趋势 |
| 亮暗两套 | 是否提供、如何切换 |
| 中性色阶 | 边框、分隔线、次要文字 |

约束：

- 颜色按语义命名，不按色值命名。
- 两档构建共用同一套语义色；兼容版可简化渐变与 `color-mix()` 效果。
- 正文与背景的对比度达到 WCAG AA（4.5:1）。

## Typography

待定。要确定：中文正文与等宽字体、字号阶梯（建议 9–15 级）、行高、字重用法、数值对齐方式。

约束：

- 诊断数据大量出现数值与路径，等宽字体是必需项。
- 字体文件随包提供，不依赖 CDN。
- 兼容版不能使用只在 Chromium 111 以上可用的字体特性（如部分可变字体特性）。

## Layout

待定。要确定：基准画布、栅格与列数、断点、容器最大宽度、间距比例。

已知约束：

- 现场只跑 Windows 桌面浏览器，不做移动端布局。
- Pencil 工程的画布当前为 800×600，原型定稿后与实现口径对齐。
- 不引入前端路由库，设置类内容通过展开、折叠或弹出呈现。

## Elevation & Depth

待定。要确定：是否使用阴影、层级如何表达（阴影 / 描边 / 色调分层）。

约束：兼容版对多层阴影与大范围模糊的渲染成本较高，倾向轻量方案。

## Shapes

待定。要确定：圆角语言与圆角阶梯。

## Components

组件库定为 HeroUI v3，选用理由与两档差异见 [设计决策](doc/design/web/design-decisions.md)。组件 token 未定，确定后补进 front matter。

候选组件清单：

- 诊断卡片：外壳、头部（工具名、参数、状态、耗时）、折叠与展开
- 数据呈现：表格、键值对、数值突出、占比条、时间线、树形目录
- 状态呈现：执行中、部分失败、权限不足、输出截断、空结果、整次失败
- 会话：消息气泡、流式文本、代码块、输入区、中断按钮
- 设置：会话列表、模型选择、凭据配置、扩展交互（选择与确认）

## Do's and Don'ts

- 待补充。讨论每定一条规范，就在这里记一条可执行的约束。
