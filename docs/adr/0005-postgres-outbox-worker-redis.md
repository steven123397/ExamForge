---
status: implemented
date: 2026-08-17
---
# PostgreSQL 保存作业事实，outbox/worker 执行，Redis 只负责协调

## Context

排考作业、运行结果、事件和审计需要在 API、Publisher、Worker、Redis 重启后保持可追溯。短期消息协调与业务事实的耐久性不同，不能让队列或缓存成为唯一来源。

## Decision

PostgreSQL 是业务数据、作业状态、事件、运行结果、发布指针和审计的事实源。业务事务同时写入 outbox，Publisher/Worker 负责投递和执行；Redis/BullMQ 只承担唤醒、分发、延迟重试和短期协调，丢失或重启后可由 PostgreSQL 事实补偿恢复。重复投递不能产生重复运行或业务事件。

## Considered options

- 让 Redis 保存作业状态和事件历史：被拒绝，因为重启或数据丢失会破坏审计和恢复。
- API 进程内计时器直接执行异步作业：被拒绝，因为无法可靠处理重启、重试和跨实例竞争。

## Consequences

数据库事务、outbox、Worker 状态机和恢复合同需要一起演进；系统增加了 Publisher/Worker 组件，但获得了可重放、可审计和跨实例一致的运行事实。

## Implementation and evidence

第五版可靠作业、outbox、Worker、SSE 补发和真实 PostgreSQL/Redis 证据已落地；部署和故障恢复材料保留在 `docs/background/`，历史正文迁移到 `docs/archive/`。

## Revisit when

替换消息基础设施或引入事件平台时，必须先保留 PostgreSQL 事实源和重放能力。
