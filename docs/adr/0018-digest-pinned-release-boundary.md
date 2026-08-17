---
status: implemented
date: 2026-08-17
---
# 发布产物由 digest 固定

## Context

源码、容器镜像、迁移和运行配置可能分别变化。只写版本字符串无法证明服务器执行的内容与验证对象相同。

## Decision

release manifest、镜像和部署记录使用 source ref/commit、artifact digest、migration/config fingerprint 互相钉住。Runner、TCR 和服务器之间只接受 manifest 声明的内容。

## Considered options

- 只按 `latest` 或可变 tag 部署：拒绝，无法重现和回滚。
- 手工记录服务器版本：拒绝，证据易漏且不可自动检查。

## Consequences

发布流程需要生成并保存 manifest，运维排障更依赖精确 digest。

## Implementation and evidence

第五版正式部署验证记录保留了 tag、源提交、artifact 和部署 digest；后续发布测试位于 `tests/deploy/`。

## Revisit when

更换供应链签名或制品仓库时，必须保留等价的不可变指纹合同。
