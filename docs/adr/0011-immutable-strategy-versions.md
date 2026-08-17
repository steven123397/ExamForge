---
status: implemented
date: 2026-08-17
---
# 排考策略以不可变版本保存

## Context

同一考试可能需要比较不同权重、硬约束和软目标。修改原策略会让历史运行失去解释能力。

## Decision

策略发布后不可原地修改；新调整生成新的 strategy version，并在 run/draft 中记录所用版本和规范化参数。

## Considered options

- 直接更新策略行：拒绝，历史结果无法重放。
- 每次运行只保存参数快照：拒绝，无法复用和审计正式策略版本。

## Consequences

版本数量增加，需要明确 active/default 指针和清理策略，但历史运行可重现。

## Implementation and evidence

现有策略版本与评分/诊断模型已按版本关联；相关 API 和 migration 测试提供落地证据。

## Revisit when

策略由外部不可变 registry 管理并能提供等价审计保证时重新评估。
