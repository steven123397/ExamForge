---
status: implemented
date: 2026-08-17
---
# 调度器通过受控传输边界部署

## Context

求解器需要被 API、后台任务和本地验证重复调用，而算法实现不应被 Web/API 运行时绑定。

## Decision

调度器以独立 Python 包和 HTTP/CLI 传输边界提供能力。请求/响应使用共享版本化合同；业务层通过适配器调用，不能把数据库访问、身份授权或前端协议塞进求解器。

## Considered options

- 将 CP-SAT 代码移入 TypeScript API：拒绝，破坏算法独立测试和 Python 生态。
- 每个调用方直接导入内部求解模块：拒绝，形成多个未版本化入口。

## Consequences

传输层可独立部署和压测，代价是需要维护 HTTP/CLI 适配和合同生成。

## Implementation and evidence

`apps/scheduler` 提供 HTTP、CLI 和 OpenAPI 入口；调度器基准与部署记录位于 `docs/background/` 的历史证据。#8 将继续验证跨层入口一致性。

## Revisit when

调度器与应用必须同进程部署、或传输开销成为可测量瓶颈时重新评估。
