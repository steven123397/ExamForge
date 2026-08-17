---
status: partially-implemented
date: 2026-08-17
---
# Draft、Run 与发布指针分离

## Context

求解产物需要反复调整和预览，而正式发布必须具备可审计、可回滚的稳定边界。

## Decision

Run 是一次带 frozen input 的求解事实；Draft 是可编辑的候选安排；发布只移动受 CAS 保护的 published pointer，不修改历史 run/draft。草稿校验、suggestion、rebalance 和 reschedule 不得伪装成新的生产事实。

## Considered options

- 在发布记录上原地编辑：拒绝，破坏历史和回滚。
- 只保存最终课表：拒绝，缺少求解和调整上下文。

## Consequences

状态模型更明确，但 API 需要区分 draft publish 与 run publish 的 stale gate。

## Implementation and evidence

v5/v6 已有 draft/run/publishedRunId 模型；#10、#11、#12 分别补齐快照传播和两类发布闸门。

## Revisit when

业务不再支持草稿或历史发布时重新评估；在此之前不得合并状态。
