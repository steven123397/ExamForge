---
status: implemented
date: 2026-08-17
---
# 公开 DTO 不泄露内部或敏感事实

## Context

数据库模型包含内部状态、审计字段和可能识别个人的信息；前端和外部 API 只需要稳定的业务视图。

## Decision

API 使用显式 DTO mapper，按 audience 输出最小字段；数据库实体、内部错误、调度器原始对象和敏感标识不得直接序列化。新增字段须同时检查权限、兼容和审计影响。

## Considered options

- 直接返回 ORM/entity：拒绝，内部变更会成为公开合同。
- 每个前端页面自行过滤：拒绝，遗漏会导致隐私和安全问题。

## Consequences

会有 mapper 和 DTO 维护成本，但跨端合同和隐私边界可测试。

## Implementation and evidence

shared、API、web 包已有 DTO 与 mapper；契约构建和 API 测试是验证入口。

## Revisit when

公开 API 由独立 gateway 完全托管并能保证相同字段最小化时重新评估。
