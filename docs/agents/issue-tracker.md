# Issue tracker: GitHub

规格、工单与决策票统一记录在 GitHub Issues（`steven123397/ExamForge`）。所有操作使用 `gh` CLI。

## 约定

- 创建 issue：`gh issue create --title "..." --body "..."`。
- 读取 issue：`gh issue view <number> --comments`。
- 列出 issue：`gh issue list --state open --json number,title,body,labels,comments`，按需增加标签和状态过滤。
- 修改 issue：先读取当前正文，再用 `gh issue edit <number> --title "..." --body-file <file>` 保留既有事实。
- 评论：`gh issue comment <number> --body "..."`。评论用于通知和过程，不替代正文事实。
- 关闭：先更新正文中的验收复选框；如果本仓库提供 tracker 校验，先运行校验，再关闭 issue。

## 规格与工单

规格、Wayfinder map、决策票和 tracer-bullet tickets 均发布为 GitHub Issues，不在 `docs/plan/` 或 `.scratch/` 复制维护。

## Wayfinding operations

- Map 是带有 `wayfinder:map` 标签的单个 issue，正文保存 Destination、Notes、Decisions-so-far、Not yet specified 和 Out of scope。
- Child ticket 使用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task` 标签，并关联到 map。
- 阻塞关系优先使用 GitHub 原生 issue dependencies；如果仓库能力不可用，才在 ticket 正文声明 `Blocked by`。
- 认领 ticket 时先指派当前开发者；解决时先记录 resolution，再关闭 issue，并将简短上下文指针追加到 map。

## Pull requests as a request surface

否。外部 PR 不作为本仓库的请求分流入口。
