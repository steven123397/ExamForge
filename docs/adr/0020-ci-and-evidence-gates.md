---
status: implemented
date: 2026-08-17
---
# CI 与证据门禁按风险分层

## Context

文档、算法、API、数据库和部署变更的验证成本不同；全量命令不能替代针对共享合同的窄证据，反之亦然。

## Decision

每个 GitHub ticket 声明可证明的最窄验证，跨层合同变更必须覆盖 memory、Postgres 和 API DTO；合并前由 `/code-review` 进行 Standards/Spec 双轴审查。部署与恢复使用独立脚本和不可变证据。

## Considered options

- 所有变更都运行全量套件：拒绝，反馈慢且不能说明关键边界。
- 只依赖人工 code review：拒绝，无法替代可重复命令。

## Consequences

验收记录更结构化，维护者需要为新边界补对应 fixture 或检查脚本。

## Implementation and evidence

根 `package.json` 已提供 CI、数据库、部署和 scheduler 命令；文档迁移门禁由 `scripts/check-doc-governance.mjs` 提供，GitHub #7 记录最终结果。

## Revisit when

CI 能提供更快且等价的增量证明，或代码审查流程发生改变时重新评估门禁组合。
