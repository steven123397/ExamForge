# ADR 约定

ExamForge 的 ADR 记录难以逆转、没有背景会令人意外、且经过真实取舍的长期决策。

ADR 以决策为中心，但允许记录决策生命周期：状态、实现提交、关联 GitHub Issue、验证证据、未落地部分和重新评估条件。这里的状态只描述该决策的生命周期，不替代 GitHub Issues 的当前工作状态。

## 推荐结构

```markdown
---
status: accepted | implemented | partially-implemented | superseded by ADR-NNNN | retired
date: YYYY-MM-DD
---
# 决策标题

## Context

## Decision

## Considered options

## Consequences

## Implementation and evidence

## Revisit when
```

只保留能帮助未来维护者理解决策的章节。实现证据引用提交、Issue、测试或部署记录，不复制完整日志和当前任务清单。
