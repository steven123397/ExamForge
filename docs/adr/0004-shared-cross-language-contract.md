---
status: implemented
date: 2026-08-17
---
# TypeScript 与 Python 通过版本化 shared 合同通信

## Context

API、Web、shared 包和 Python scheduler 共同消费排考输入、结果、诊断和评分。任一语言私自扩展字段都会造成解析漂移和不可复现的运行结果。

## Decision

跨语言输入、输出、错误和诊断合同先在 shared/协议层定义，再由 TypeScript 与 Python 各自实现和验证。字段、枚举、版本、digest 和兼容规则必须显式；未知或不支持的合同版本稳定拒绝，不通过隐式字段猜测兼容。

## Considered options

- 让 API 和 Python 各自维护结构：被拒绝，因为合同漂移只能在运行时暴露。
- 只用 JSON 文档约定而不做双端测试：被拒绝，因为无法证明序列化、错误和边界值一致。

## Consequences

共享合同修改需要同时更新 API、scheduler、测试和必要的 DTO；历史版本需要归一化或明确拒绝，并在 ADR/Issue 中说明迁移边界。

## Implementation and evidence

shared schemas、scheduler CLI/OpenAPI、跨语言合同测试和第六版 snapshot-v3 已形成当前基线；#8-#13 继续覆盖 enrollment 输入和 frozen request 的跨层一致性。

## Revisit when

引入独立 scheduler 服务、外部 API consumer 或新的合同注册机制时，重新评估版本协商和发布策略。
