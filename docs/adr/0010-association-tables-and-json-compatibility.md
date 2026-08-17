---
status: implemented
date: 2026-08-17
---
# 多对多关系使用关联表，扩展字段使用 JSONB

## Context

考试、课程、参与者、约束和策略之间存在多对多关系，同时部分策略参数需要向后兼容地扩展。

## Decision

可查询、需唯一性和外键保护的关系使用规范化 association tables；策略或诊断的扩展参数使用带版本校验的 JSONB。JSONB 不替代核心关系字段。

## Considered options

- 全部关系编码为 JSON：拒绝，无法可靠约束和查询。
- 所有扩展字段拆成迁移列：拒绝，策略演进成本过高。

## Consequences

数据库约束清晰，应用需要承担 JSONB schema 校验与迁移兼容。

## Implementation and evidence

现有 db migrations 和 shared DTO 已采用关联表与 JSON 扩展；PostgreSQL integration/migration tests 是证据入口。

## Revisit when

某类 JSON 字段成为高频查询主维度，或其 schema 稳定到值得正式列化时重新评估。
