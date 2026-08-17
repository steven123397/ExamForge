---
status: implemented
date: 2026-08-17
---
# 排考算法核心与 Web/API 保持边界分离

## Context

ExamForge 同时包含 Python CP-SAT 调度器、TypeScript API、Web 和 PostgreSQL。把求解逻辑放入 Web/API 会让算法难以独立验证，也会让跨语言合同、部署和故障边界不清晰。

## Decision

Python scheduler 负责排考数据合同、预检、CP-SAT 求解、评分和冲突解释，不访问业务数据库、不实现 HTTP 业务路由和前端状态。Web/API 负责身份、业务用例、作业协调、数据持久化和展示；跨语言能力通过 shared 合同和 scheduler 接口调用。API 不复制求解器核心逻辑。

## Considered options

- 在 Node API 中重写或嵌入求解器：被拒绝，因为会产生两套算法语义。
- 让 scheduler 直接读写 PostgreSQL：被拒绝，因为算法核心会获得业务数据和事务边界，难以独立测试。

## Consequences

跨层行为需要同步维护 shared/API DTO 与 Python 合同；scheduler 可以单独测试和部署，但需要显式处理协议错误、不可行和基础设施不可用。

## Implementation and evidence

当前 `apps/scheduler/`、`apps/api/`、shared contracts 和 scheduler 测试遵守该边界。第六版参与者合同和任务 1/2 已在 `main` 合并；后续 enrollment 全链路由 #8/#9 继续收口。

## Revisit when

需要把 scheduler 变成独立多租户服务，或跨语言调用成本明显超过维护边界时重新评估接口形态，但不直接取消职责分离。
