---
status: implemented
date: 2026-08-17
---
# 服务端会话与受众范围在 API 层确定

## Context

管理员、教师、考生和运维人员看到的资源范围不同。把权限判断散落到前端或调度器会造成越权和不可审计行为。

## Decision

服务端 session/auth middleware 解析身份和 audience scope，API 在读取、写入、发布、回滚前执行授权；scheduler 只信任已校验的领域请求，不持有 Web session 语义。

## Considered options

- 前端隐藏无权限按钮：拒绝，不能防止直接调用。
- 调度器自行解析用户身份：拒绝，耦合传输和权限体系。

## Consequences

API 需要覆盖权限矩阵测试；服务间调用必须传递最小、可审计的 actor context。

## Implementation and evidence

现有 API session、角色和审计模块已承担主要职责；发布/回滚相关权限与 #11/#12 一起验收。

## Revisit when

引入统一外部 identity provider 或服务间零信任策略时重新评估边界适配。
