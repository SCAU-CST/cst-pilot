# Blue hour 背景

## 使用

`cst-pilot-web.pen` 的「A 主区」使用 `blue-hour.glsl` 动态填充。仅用于 Pen 设计稿，未实现网页。

| 文件 | 用途 |
|---|---|
| `blue-hour.glsl` | WebGL 1.0 着色器，`@time` 驱动动画 |
| `blue-hour-palette.png` | 256×1 色彩查找表，五色在 Oklab 空间插值后转为 sRGB |
| `Blue hour-3840x2160.svg` | 用户提供的静态原图 |
| `blue-hour-background.png` | 静态兼容图，取自 SVG |

在 Pen 的 Shader 参数中把 `Animation speed` 设为 `0` 可停止动画；`Timeline offset` 控制静止时的画面。默认速度 30，对应每秒推进 0.36 个算法时间单位。Pen 不自动读取系统的减少动效偏好，需手动停止。

## 来源

- 工具：[FeralUI Gradient Builder](https://feralui.dev/gradients)。作者 Sarthak Navalekar。
- 实现参考：站点公开分发的 [`JapaneseGradients-BRFKYYZf.js`](https://feralui.dev/assets/JapaneseGradients-BRFKYYZf.js)，2026-09-16 查阅。
- 对应类型：`PRISM2`。该类型原实现是 Canvas 2D，不是 GLSL；板条采样与绘制函数在此构建中分别命名为 `T8`、`H8`，SVG 导出为 `Md`。
- [用户确认的 Blue hour 预设](https://feralui.dev/gradients?g=2.JY9Lb8IwEIT_Chque0gCAbo3QoNaqVUrKk4VB5NsHmqwI9uhD5T_XjncZmc-aWZvqME3OG96B_7EPEmSVZqDMF9ky3y7CWq93qSPk5ftdst9HFS-zB_2W5wI_rcXMN4Pzx-vCQiVVZdgfLelgPAFBggWjOzlmM-e3o4HEAKRdYPMGjNYEM7KurCkMIP24Dgm1KoHRwTRV-nMVGLVpQ8Vg2uNnoY3agpcp7QHoWytFH4KI4Jr_wQcRxGhkbZuPHgVESpTDA6cRoTeuPaOh-vciS7Bq5RQqUK8Ay9SwsXcEchPr3QZvpGrWCfgSnVOxpFQW9Vq8GIkePDnafwH)：`PRISM2 / slant / expand`，grain=3。链接未保存播放速度，稿件默认采用 30。

## 参数与差异

| 项 | 当前值 |
|---|---|
| 颜色与位置 | `#22265E` 10%、`#3B4EA8` 30%、`#7785DE` 50%、`#BCC4F1` 70%、`#E4E9FA` 90% |
| 每半幅板条数 | 11；运动时边缘部分板条使可见总数变化，不是固定 24 条 |
| 形状 / 运动 | slant / expand，板条向两侧移动 |
| 方向 / 大小 | 0 / 100 |
| 高度 / 焦点 / 位置 | 60 / 50 / 50 |
| 混合 / 明暗变化 | 65 / 35 |
| 初始算法时间 | 20.75 |
| 竖向采样 | 96 个节点，节点间按 sRGB 混合 |
| 噪点 | 静态程序噪点，overlay 0.015；没有复用 SVG 的噪点位图 |

着色器独立实现已核对的数学流程，只覆盖当前预设，不包含网站的其他形状、旋转、反色、进场效果和导出功能。省略 Canvas 矩形间的一像素重叠，使用相邻连续板条边界。静态 SVG 是某个动画时刻的快照，不要求与默认时间逐像素一致。

## 授权范围

[网站条款](https://feralui.dev/terms)只明确已发布的包按各自 LICENSE 采用 MIT；未发布演示仅作为作品展示。未找到 Gradient Builder 的明确开源许可，因此不把该演示标为 MIT，也不把网站打包代码纳入仓库。本目录保留独立实现与来源说明，不代表获得原站演示代码的再分发许可。
