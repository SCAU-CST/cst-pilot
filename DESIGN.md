---
version: alpha
name: CST Pilot Web
description: 计维队便携诊断工具 cst-pilot 的 Web 操作界面设计系统
colors:
  light-text: "#1A2024"
  dark-text: "#E0EAEE"
  light-muted: "#5F676C"
  dark-muted: "#AAB3B7"
  light-border: "#D5DEE3"
  dark-border: "#2D3438"
  light-hover: "#E3ECF1"
  dark-hover: "#1D2428"
  light-selected: "#DBE4E9"
  dark-selected: "#242C2F"
  light-sidebar: "#F5F6F8"
  dark-sidebar: "#0B1215"
  light-composer: "#FFFFFF"
  dark-composer: "#0B1215"
  light-send: "#465A9F"
  dark-send: "#7785DE"
  light-send-icon: "#FFFFFF"
  dark-send-icon: "#001F42"
  light-footer: "#5F676C"
  dark-footer: "#060B0E"
  welcome: "#FFFFFF"
  accent-solid: "#1B85F2"
  success-solid: "#20A655"
  warning-solid: "#ED9F26"
  danger-solid: "#F4232E"
typography:
  welcome:
    fontFamily: "Source Han Sans CN"
    fontSize: "56px"
    fontWeight: 600
  product-name:
    fontFamily: "Inter"
    fontSize: "20px"
    fontWeight: 600
  navigation:
    fontFamily: "Source Han Sans CN"
    fontSize: "19px"
    fontWeight: 400
  conversation:
    fontFamily: "Source Han Sans CN"
    fontSize: "15px"
    fontWeight: 400
  input-placeholder:
    fontFamily: "Source Han Sans CN"
    fontSize: "20px"
    fontWeight: 400
  model-selector:
    fontFamily: "Inter"
    fontSize: "18px"
    fontWeight: 400
  footer:
    fontFamily: "Inter"
    fontSize: "15px"
    fontWeight: 400
omitted:
  - section: spacing
    reason: 间距比例未讨论
  - section: rounded
    reason: 圆角语言未讨论
  - section: components
    reason: 组件 token 未讨论
---

# CST Pilot Web 设计系统

本文是设计规范的唯一真源。颜色系统、首页排版与浅色聊天页例外按当前画布记录；未确定的章节继续留空，不推定为全站规则。

| 参考 | 范围 |
|---|---|
| [cst-pilot-colors.pen](web/design/cst-pilot-colors.pen) | 12 步用途、中性与四组彩色色阶 |
| [cst-pilot-web.pen](web/design/cst-pilot-web.pen) | 浅深两版首页及浅色聊天页的用色、背景与排版 |
| [Web 端设计决策](doc/design/web/design-decisions.md) | 组件库、令牌组织与浏览器兼容方向 |


格式依据 [DESIGN.md Format](https://github.com/google-labs-code/design.md)（alpha）。本文件放在仓库根目录，供 Pen 从工作目录读取。

## Overview

### 品牌标识

### 使用者与场景

## Colors

### 组织方式

颜色分为通用 12 步色阶和首页专用配色。前者用于界面状态，后者用于背景、品牌与首页控件；两者不互相替代。

| 项 | 约定 |
|---|---|
| 语义角色 | 沿用 HeroUI v3；无后缀为背景，`-foreground` 为其上的文字或图标 |
| 色阶用途 | 参考 Radix Colors 的 12 步组织方式，不直接使用其色值 |
| 中性色 | 偏蓝；OKLCH 色相 230°，目标色度 0.012 |
| 彩色色相 | 主色蓝 254°、成功绿 151°、警告琥珀 72°、危险红 26° |
| 生成 | 浅深两套独立明度曲线；彩色峰值色度系数 0.94；超出 sRGB 色域时保留明度与色相、压低色度 |
| 文件格式 | DTCG 2025.10；`reference` 原始值 → `system` 语义角色 → `component` 组件值 |

正文与 front matter 的十六进制值对应画布使用的 sRGB。完整五组、浅深两套共 120 个色值及 OKLCH 数值见 [颜色令牌](doc/design/web/asset/cst-pilot-colors.tokens.json)，生成规则见 [生成器](doc/design/web/asset/make-color-scale.mjs)。front matter 的颜色键描述首页落点及彩色实心档，不代表已完成 HeroUI 变量映射。

### 12 步用途与中性色

先按用途选步数，再按主题取色。深色主题不通过反转浅色颜色生成。

| 步 | 用途 | 浅色中性 | 深色中性 |
|---|---|---|---|
| 1 | 页面背景、画布底色 | `#FAFDFF` | `#060B0E` |
| 2 | 次级背景、卡片、隔行 | `#F2FAFF` | `#0B1215` |
| 3 | 按钮与输入框默认底色 | `#E8F1F6` | `#131A1D` |
| 4 | 悬停底色 | `#E3ECF1` | `#1D2428` |
| 5 | 按下与选中底色 | `#DBE4E9` | `#242C2F` |
| 6 | 弱边框、静态分隔线 | `#D5DEE3` | `#2D3438` |
| 7 | 输入框与卡片边框 | `#CDD6DB` | `#3C4448` |
| 8 | 强边框、键盘焦点环 | `#C5CED2` | `#4F575B` |
| 9 | 实心色块、主按钮、徽标 | `#7F888C` | `#7F888C` |
| 10 | 实心色块悬停 | `#757D82` | `#8B9498` |
| 11 | 次要说明、占位符 | `#5F676C` | `#AAB3B7` |
| 12 | 正文、标题、主要图标 | `#1A2024` | `#E0EAEE` |

### 彩色语义

四组彩色沿用相同的 12 步用途。首页未展示成功、警告、危险状态，发送按钮也不使用通用主色第 9 步；不能把色卡中的色块当成已完成的组件状态设计。

| 色系 | 第 9 步实心色（浅深相同） | 第 11 步文字：浅色 / 深色 | 第 12 步文字：浅色 / 深色 |
|---|---|---|---|
| 主色 `accent` | `#1B85F2` | `#0665BE` / `#77B4FF` | `#001F42` / `#D9EAFF` |
| 成功 `success` | `#20A655` | `#007B3A` / `#67CA83` | `#00270E` / `#BAFAC8` |
| 警告 `warning` | `#ED9F26` | `#8C5A00` / `#E4A247` | `#2E1A00` / `#FFE3C1` |
| 危险 `danger` | `#F4232E` | `#BF091B` / `#FF8A80` | `#430003` / `#FFDFDC` |

### 首页实际用色

浅深两版保持相同的语义位置。下表列出网页画布的实际取值；侧栏、输入框、发送按钮和页脚按明确的例外规则使用，不强行替换为通用色阶同位值。

| 元素 | 浅色 | 深色 | 依据 |
|---|---|---|---|
| 主要文字与图标 | `#1A2024` | `#E0EAEE` | 中性 12 |
| 次要文字、占位符、次要图标 | `#5F676C` | `#AAB3B7` | 中性 11 |
| 侧栏分隔线 | `#D5DEE3` | `#2D3438` | 中性 6 |
| 悬停底色 | `#E3ECF1` | `#1D2428` | 中性 4；当前「新对话」使用此档 |
| 选中底色 | `#DBE4E9` | `#242C2F` | 中性 5；当前设备图标容器使用此档 |
| 侧栏底色 | `#F5F6F8` | `#0B1215` | 浅色独立灰白；深色中性 2 |
| 消息输入框 | `#FFFFFF` | `#0B1215` | 浅色纯白；深色中性 2，不使用中性 3 |
| 发送按钮 | `#465A9F` | `#7785DE` | Blue hour 家族，不使用通用主色 9 |
| 发送箭头 | `#FFFFFF` | `#001F42` | 浅色白色；深色取浅色主色阶 12 |
| 页脚 `@cst-pilot-web` | `#5F676C` | `#060B0E` | 浅色中性 11；深色中性 1，作为底部亮色带上的文字色 |
| 欢迎标语 | `#FFFFFF` | `#FFFFFF` | 两版均白色 |

品牌 C 的两条弧线使用白色透明度渐变描边：0% 处 `#FFFFFF00`、55% 处 `#FFFFFF1F`、100% 处 `#FFFFFFFF`，画布渐变旋转为 0°。它不是整条不透明白线。

### 首页动态背景

Blue hour 背景独立于通用色阶。浅深两版共用 `blue-hour.glsl` 的板条动画，使用不同色表和形状参数；不能将浅色背景原样复用于深色主题。

| 参数 | 浅色 | 深色 |
|---|---|---|
| 五道色标 | `#22265E / #3B4EA8 / #7785DE / #BCC4F1 / #E4E9FA` | `#080C3F / #273782 / #6E7BCC / #BCC4F1 / #E4E9FA` |
| 色标位置 | 10% / 30% / 50% / 70% / 90% | 25.2% / 61.9% / 81.2% / 92% / 97.5% |
| 高度 / 焦点 / 位置 / 混合 | 60 / 50 / 50 / 65 | 70 / 63 / 64 / 81 |
| 色表 | `blue-hour-palette.png` | `blue-hour-dark-palette.png` |

共用参数：`PRISM2 / slant / expand`，方向 0、大小 100、每半幅板条数 11、明暗变化 35、速度 30、初始时间 20.75、静态噪点强度 0.015。颜色在 Oklab 中插值后写入 sRGB 色表；运动时边缘板条数量变化，不是固定 24 条。

背景目前仅用于 Pen，不能据此认定网页动画或兼容版已经实现。文件、来源、算法差异和停止动画方式见 [背景说明](web/design/asset/blue-hour.md)。

### 浅色聊天页例外

聊天页使用无色偏的灰白中性色，不沿用首页偏蓝的中性色。以下覆盖仅作用于「聊天工作台 · 浅色」，不修改两张主页和通用色阶。

| 元素 | 实际值 |
|---|---|
| 主区背景 | 纯白 `#FFFFFF`，无背景图片、图案、渐变、纹理或 Shader |
| 标题栏 / 侧栏 | `#FFFFFFF2` / `#F6F6F6` |
| 输入框 / 表格正文底色 | `#FFFFFF` |
| 用户气泡 / 表头 / 行内代码底色 | `#F0F0F0` |
| 选中会话 / 设备图标容器 | `#EAEAEA` / `#E5E5E5` |
| 正文 / 次要文字与图标 | `#202020` / `#646464` |
| 分隔线 / 输入框边框 | `#E0E0E0` / `#D5D5D5` |
| 检索与工具图标 / 成功状态 | `#0665BE` / `#007B3A`，继续使用彩色语义 |
| 停止按钮 / 图标 | `#465A9F` / `#FFFFFF`，保留品牌操作色 |

### 对比度边界

正文和控件文字以 WCAG AA 4.5:1 为目标。第 9 步不是「可以直接配白字」的保证；当前主色、成功、警告、危险第 9 步与白色的对比度分别约为 3.69、3.16、2.19、4.10，均未达到普通文字要求。

后续制作语义按钮时需单独确定前景色或调整背景。动态背景上的文字需检查多个动画时刻；当前画布未完成全量对比度验收，本次记录不改变已有配色。

## Typography

### 字体分工

网页正文与控件使用思源黑体和 Inter；聊天页行内工具名使用 JetBrains Mono。色卡里的 Noto Sans SC 仅用于设计说明。

| 字体 | 画布中的用途 |
|---|---|
| `Source Han Sans CN`（思源黑体） | 欢迎语、中文导航、会话标题、分组文字、输入提示，以及当前账户信息 |
| `Inter` | 产品名 `CST Pilot`、模型名称、页脚 `@cst-pilot-web` |
| `Noto Sans SC` | 仅用于 `cst-pilot-colors.pen` 的标题、注释和色值说明 |

字体按界面角色指定，不按每个字符自动切换。例如账户名 `Tim2354` 在当前画布中仍使用思源黑体。网页字体文件、加载策略和缺字回退字体尚未确定。

### 首页排版参数

下表为 1920×1080 首页画布中的实际值，浅深两版一致。单位为画布 px；`normal` 字重按 400 记录。

| 元素 | 字体 | 字号 | 字重 |
|---|---|---|---|
| 欢迎标语「我该如何协助您？」 | Source Han Sans CN | 56 | 600 |
| 产品名 `CST Pilot` | Inter | 20 | 600 |
| 导航「新对话」「仪表盘」 | Source Han Sans CN | 19 | 400 |
| 输入框占位文字 | Source Han Sans CN | 20 | 400 |
| 模型选择文字 | Inter | 18 | 400 |
| 会话列表标题 | Source Han Sans CN | 15 | 400 |
| 分组「今天」 | Source Han Sans CN | 16 | 400 |
| 分组「昨天」 | Source Han Sans CN | 15 | 400 |
| 当前账户名 | Source Han Sans CN | 14 | 400 |
| 账户下方说明 | Source Han Sans CN | 10 | 400 |
| 页脚 `@cst-pilot-web` | Inter | 15 | 400 |

### 使用边界

- 首页文本未显式设置行高和字距，使用字体默认值；不从截图估算为固定令牌。
- 56px/600 只用于首页欢迎语，不直接推广为对话正文或普通页面标题。
- 15px/16px 的分组字号差异按画布保留，尚未统一；10px 账户说明是当前稿件值，不作为全站最小字号规范。
- 全站角色名称采用 `display / headline / title / body / label`，各分 `large / medium / small`；完整数值和首页元素的角色映射尚未确定。
- front matter 的排版键按已出现的元素命名，不代表上述全站角色映射已定稿。
- 画布变量里的 `font-title=Inter`、`text-title=32`、`text-description=16` 没有绑定当前首页文本，不作为实际字号依据。

## Layout

### 浅色聊天页

下列尺寸只描述 1920×1080 聊天画布，不代表全站间距令牌或响应式断点。

| 区域 | 尺寸与位置 |
|---|---|
| 侧栏 / 主区 | 宽 264px / 1656px |
| 对话列 | 宽 1120px，距主区左右各 268px，约占主区 67.6% |
| 诊断表格 | 宽 816px，与正文左边缘对齐；三列宽 172 / 292 / 352px，不随对话列铺满 |
| 输入框 | 宽 1144px、高 126px；主区内 x=256、y=914 |
| 输入框操作栏 | 左右内边距 16px，底部内边距 12px；模型、思考强度与停止按钮同排居中对齐 |
| 检索状态 | 标题行高 28px，18px 图标与文字垂直居中；关键词另起一行，左缩进 28px |

聊天页不显示「本机 · 只读诊断」标签、独立 SMART 权限提示或回答操作栏中的「仅检查」说明。真实诊断结果仍保留在正文表格中。

## Elevation & Depth

## Shapes

## Components

## Do's and Don'ts
