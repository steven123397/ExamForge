---
status: implemented
date: 2026-08-17
---
# 恢复验证使用可丢弃目标

## Context

备份存在不等于可恢复；直接在生产库试验会带来不可接受的破坏风险。恢复还必须证明迁移、配置和数据版本相容。

## Decision

备份恢复演练优先在 disposable PostgreSQL target 执行，使用 manifest 固定 schema/data/config 版本，记录原始命令、结果和限制。生产恢复只在演练证据满足门槛后进行。

## Considered options

- 直接在生产库验证：拒绝，风险不可逆。
- 只检查备份文件可下载：拒绝，不能证明可启动和可读。

## Consequences

需要维护临时数据库和清理流程，但恢复证据可重复、可审计。

## Implementation and evidence

部署与恢复脚本、PostgreSQL migration tests 和第五版部署记录提供现有证据；临时容器不作为仓库产物提交。

## Revisit when

采用托管 PITR 且供应商能提供等价隔离演练和证据时重新评估目标形式。
