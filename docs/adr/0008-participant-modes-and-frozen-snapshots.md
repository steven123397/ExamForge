---
status: partially-implemented
date: 2026-08-17
---
# 参与者模式通过冻结快照进入排考

## Context

报名状态会在求解期间变化，且个体冲突与小组冲突的语义不同。直接在求解器中读取活动报名无法重现一次运行。

## Decision

应用层先按 participant mode 规范化报名，生成不可变 frozen participant snapshot 和 requestDigest，再交给调度器。运行、job、draft 和发布检查引用同一版本快照；未知模式或非法组合在边界拒绝。

## Considered options

- 求解期间查询实时报名：拒绝，结果不可复现。
- 只保存参与者数量摘要：拒绝，无法重建输入或解释冲突。

## Consequences

运行记录需要保存完整可读的 frozen input，数据库和 API DTO 的体积增加，但 stale 检查有可靠基线。

## Implementation and evidence

v6 已完成部分 participant contract 和 individual conflict 能力；#8/#9/#10 继续完成 v3 snapshot、持久化输入和 draft 传播。

## Revisit when

报名系统提供不可变版本化事件流，并能满足同等审计和重放要求时重新评估快照存储形式。
