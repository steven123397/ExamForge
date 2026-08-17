---
status: implemented
date: 2026-08-17
---
# 同步与异步运行共享规范输入

## Context

用户交互需要同步预检或快速求解，生产任务需要可重试、可恢复的异步执行。两条路径若各自组装输入，会产生不同 digest 和结果。

## Decision

同步创建、异步 job、worker retry/recovery 和 run-level reschedule 必须消费同一个 canonical frozen input/requestDigest。异步任务持久化 job 状态并由 worker 驱动；重复投递必须幂等。

## Considered options

- 同步和异步各自读取报名数据：拒绝，版本漂移会导致不可比较的运行。
- 只保留异步路径：拒绝，交互式预检失去低延迟反馈。

## Consequences

输入构建器和持久化边界更严格，但任何执行路径都可复现和审计。

## Implementation and evidence

现有 `ScheduleRunService` 和 `createScheduleJob` 是收敛重点；#9 的验收要求证明两条路径的 digest、快照和边集合一致，并覆盖 CAS 创建边界。

## Revisit when

同步路径被正式废弃，或出现独立求解产品且其输入合同明确分叉时重新评估。
