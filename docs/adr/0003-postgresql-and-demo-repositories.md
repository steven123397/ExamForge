---
status: implemented
date: 2026-08-17
---
# PostgreSQL 是生产事实源，内存仓储只保留演示用途

## Context

早期平台需要在无数据库环境中快速演示，但正式排考、作业、发布和审计不能依赖进程内状态。两种运行形态必须明确，避免演示回退被误当成生产能力。

## Decision

生产和真实集成路径使用 PostgreSQL 保存业务事实、运行结果和审计；内存仓储只作为本地无数据库演示和快速单元测试适配器。API 在选择仓储时必须让运行形态可观察，不能在 PostgreSQL 失败时静默降级到内存仓储。

## Considered options

- 所有环境只用内存仓储：被拒绝，因为重启和多实例会丢失事实。
- PostgreSQL 连接失败时自动回退内存：被拒绝，因为会产生“成功但未持久化”的危险假象。

## Consequences

内存与 PostgreSQL 需要共享 service 合同和关键行为测试；真实数据库验证成为发布证据的一部分，演示脚本必须标明 storage 类型。

## Implementation and evidence

PostgreSQL schema、迁移、仓储和真实集成测试已落地；内存仓储仍用于单元和演示。第五版归档证据要求明确区分内存、真实 PostgreSQL 和部署环境。

## Revisit when

引入新的持久化实现或完全移除演示模式时，重新评估仓储适配器和降级策略。
