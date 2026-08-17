---
status: partially-implemented
date: 2026-08-17
---
# 重排从明确的冻结基线开始

## Context

重排可能发生在报名变化、草稿调整或已发布课表之后。不同入口若隐式读取当前数据，会无法解释改动范围。

## Decision

run-level reschedule 以 T1 生成的 frozen input/requestDigest 为基线；draft validation/suggestion/rebalance/reschedule 以 T2 传播的 draft snapshot 为基线。所有输出记录来源版本，不与实时报名混用。

## Considered options

- 重排时重新读取当前报名：拒绝，结果不可重现。
- 只把当前 published pointer 作为基线：拒绝，丢失未发布草稿和输入版本。

## Consequences

重排 API 需要显式 source target 和版本错误；实现与发布 CAS 相互依赖。

## Implementation and evidence

v6 的 run-level 与 draft-level 路径尚在 #9/#10/#11/#12 中收敛；该 ADR 作为边界合同而非当前完成声明。

## Revisit when

所有重排都由外部工作流编排且其 source artifact 不再由 ExamForge 管理时重新评估。
