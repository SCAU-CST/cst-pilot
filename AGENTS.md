# AGENTS.md — cst-pilot

电脑维修便携诊断工具链，基于 pi 的隔离实例。

先读 `doc\PRD.md` 和 `doc\Notice.md`，再按需读 `doc\design\tool\*_design.md`、`doc\design\web\*.md` 与 `doc\tool\*.md`；任务清单见 `doc\Todo.md`。

## 文档规范

`doc/` 下的文档按以下规则写。

1. 直白描述。不用比喻、拟人、夸张，例如不写「吃掉退路」「白花力气」。
2. 中文母语语序。一句话说一件事，从句拆成独立句。不写「我们」「大家」，不堆程度副词。
3. 结构化优先。
   - 对比、映射、清单用表格。
   - 步骤用有序列表，并列项用无序列表。
   - 每节先给结论，再给理由。
   - 单段不超过 3 句。

## 运行

```
pi.cmd
```

调试验证：

```bash
export WSLENV=PI_CODING_AGENT_DIR
export PI_CODING_AGENT_DIR='E:\Learning\Programming\cst-pilot\agent\home'
```
