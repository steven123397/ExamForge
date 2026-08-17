---
status: implemented
date: 2026-08-17
---
# 当前事实使用 GitHub Issues，长期取舍使用 ADR

## Context

ExamForge 过去把设计、计划、状态、审查和课程交付材料混在本地文档中，导致同一事实在多个位置漂移。Matt skill 需要一个可查询的活动 tracker，同时保留术语、长期决策和历史证据的不同职责。

## Decision

GitHub Issues 是当前 spec、ticket、依赖、验收、解决记录和活动状态的唯一事实源。根级 `CONTEXT.md` 只保存术语与领域边界；`docs/adr/` 保存长期决策及其生命周期；`docs/background/` 保存外部输入与历史证据；`docs/archive/` 保存迁移前的设计、计划、状态和审查正文，归档内容不作为当前权威。

## Considered options

- 继续以 `docs/archive/design/`、`docs/archive/plan/`、`docs/archive/status/` 作为活动体系：被拒绝，因为会与 GitHub Issues 双写。
- 使用本地 Markdown tracker：被拒绝，因为本项目已经使用 GitHub Issues，并需要原生依赖和协作可见性。

## Consequences

当前工作需要 GitHub Issue 上下文；归档文档可以保留历史细节，但不能被新工作当成 spec 或状态源。ADR 可以附带实现状态和证据，但不承载全局项目进度。

## Implementation and evidence

- 文档迁移由 Wayfinder #1 至 #7 记录。
- 根级 `AGENTS.md`、`docs/agents/issue-tracker.md` 和提交 `6c60007` 固化了活动事实源与交付规则。
- 20 个 ADR、`docs/archive/` 迁移和 `npm run check:docs` 门禁落地于提交 `67e4206`。

## Revisit when

更换 issue tracker、引入多仓库协作，或归档与活动事实再次发生双写时重新评估。
