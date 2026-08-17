---
status: implemented
date: 2026-08-17
---
# 评分与冲突诊断是稳定输出合同

## Context

排考结果不仅需要可行性，还需要解释硬约束冲突、软目标权衡和改进方向。前端不能自行推断求解器内部状态。

## Decision

调度器返回版本化的 score、objective breakdown、conflict diagnostics 和可定位的 participant/course 标识。诊断是求解结果的一部分，API 和前端只消费 DTO，不复制评分逻辑。

## Considered options

- 只返回课表：拒绝，无法支持预检和人工调整。
- 前端根据课表猜测冲突：拒绝，口径会漂移且不可测试。

## Consequences

解释能力稳定，代价是需要维护 DTO 兼容和 deterministic fixtures。

## Implementation and evidence

调度器已有冲突说明和评分测试；历史规模验证位于 `docs/background/`，新验收由 GitHub ticket 记录。

## Revisit when

引入新的求解后端或诊断维度时，先扩展合同和兼容策略再改变语义。
