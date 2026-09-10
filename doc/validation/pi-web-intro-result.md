# 验证结论

## 方式

worktree `E:\Learning\Programming\cst-pilot-worktrees\pi-web-validate`（分支 `validate/pi-web`）。

| 步骤 | 状态 |
|---|---|
| worktree 隔离 home 启动 cst-pilot（pi.cmd） | ✅ skills/diagnostics/APPEND_SYSTEM 正常加载，模型 glm-5.3-flash 就绪 |
| worktree 内 `npm install @agegr/pi-web@0.9.0` | ✅ 57s 完成 |
| `start-pi-web.ps1`（PI_CODING_AGENT_DIR → worktree agent\home）启动服务 | ✅ Next.js Ready in 202ms，127.0.0.1:30141 |
| TUI 建会话 → 浏览器可见 | ✅ 侧边栏即时出现，标注 worktree 分支 validate/pi-web |
| 浏览器发消息 → agent 响应 | ✅ 工具调用、token/费用/上下文显示正常 |
| Windows 兼容 | ✅ node-pty 正常，服务与 UI 均无报错 |

## 结论

**@agegr/pi-web (0.9.0) 可引入，验证通过。**

## 已发现注意点

1. pi-web 的「新建会话」默认项目根是 git 主仓库根（E:\Learning\Programming\cst-pilot）而非当前 worktree；它按 worktree 分支分组展示会话（顶部切换器）。若要让新会话落 worktree cwd，需在侧边栏手动选项目目录。
2. pi-web 绑定上游 pi 的运行时（自带 @earendil-works/pi-coding-agent 0.85.1 依赖），本仓库 fork 的定制不会进入 pi-web 的运行时；共享的是 `PI_CODING_AGENT_DIR` 下的会话/配置/扩展目录。cst-pilot 的能力都在 agent home，故验证通过。
3. 回复中模型提到 "WSL 路径 /mnt/e/..."——pi-web 服务端在 Windows 上的路径语义需在正式引入前再确认一次（不影响本次只读验证）。
4. 未验证项（留给正式引入）：U 盘便携场景（离线安装包体积、无网启动）、与 pi.cmd STRICT PATH 白名单的叠加、node-pty 在受限账户下的表现、auth.json 经 web 暴露面（默认仅回环 127.0.0.1，未开远程）。

## 复现

```powershell
# 1. worktree 里启动 cst-pilot（建会话）
E:\Learning\Programming\cst-pilot-worktrees\pi-web-validate\pi.cmd
# 2. 另一终端启动 web 服务
powershell -NoProfile -ExecutionPolicy Bypass -File start-pi-web.ps1 --no-open
# 3. 浏览器打开 http://127.0.0.1:30141
```
