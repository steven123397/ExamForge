---
status: partially-implemented
date: 2026-08-17
---
# 发布与回滚使用版本 CAS

## Context

两个操作员可能基于不同快照同时发布或回滚。仅检查请求到达时间会让旧结果覆盖新结果。

## Decision

发布和显式 rollback target 都携带 participant snapshot/requestDigest/version 预期值，在同一事务中执行 compare-and-set；stale 请求返回 409，既有 published pointer 保持不变。回滚目标必须是明确的历史 run。

## Considered options

- 最后写入者获胜：拒绝，会静默覆盖。
- 先读后写但不在事务内比较：拒绝，存在竞态窗口。

## Consequences

客户端需要处理 409 并重新加载；数据库事务边界和 rollback target 合同必须清晰。

## Implementation and evidence

#11 要求 run publish/rollback gate，#12 要求 draft publish gate；验收覆盖 memory、Postgres、API DTO 和 pointer 不变性。

## Revisit when

改用带线性化版本的外部发布服务并能提供相同语义时重新评估。
