---
status: partially-implemented
date: 2026-08-17
---
# 重叠边是由冻结输入派生的事实

## Context

个体参与者之间的重叠关系可从同一考试报名集合计算。把每次计算结果作为独立事实表会引入同步、删除和版本一致性问题。

## Decision

overlap edges 在 frozen input 上派生，不建立持久化 overlap-edge 主表。运行或 draft 可以缓存派生结果，但缓存必须带 input/requestDigest，不能成为事实源。

## Considered options

- 为所有报名维护 overlap-edge 表：拒绝，写放大和失效传播超过收益。
- 每个消费者各自计算：拒绝，容易出现算法和过滤口径漂移。

## Consequences

求解与 draft 必须共享边构建器；大规模场景需要用基准证据决定缓存策略。

## Implementation and evidence

当前 scheduler 已有 overlap 约束实现；#9 要求 T1 产出可持久化、可追溯的 frozen input，使 #10 能复用同一边集合。

## Revisit when

测量证明边构建成为主要性能成本，且缓存失效合同可被明确验证时重新评估。
