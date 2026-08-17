# Domain docs

工程 skill 探索 ExamForge 时，先读取根目录 `CONTEXT.md`，再读取与当前工作相关的 `docs/adr/` 决策记录。

## 文件结构

```text
/
├── CONTEXT.md       ← ExamForge 规范术语与领域边界
└── docs/
    ├── adr/         ← 难以逆转且经过取舍的长期决策
    ├── agents/      ← 工程 skill 的仓库级配置
    ├── background/  ← 已确认的外部输入与历史参考
    └── temp/        ← 用户维护的草稿区，不属于 skill 事实源
```

如果领域术语发生冲突，先指出冲突，再统一使用 `CONTEXT.md` 的规范术语。需要新术语时，通过 domain modeling 收敛后立即更新 glossary。

`CONTEXT.md` 只保存术语定义和概念边界，不保存实现细节、阶段计划、当前状态或聊天记录。只有同时满足“难以逆转、没有背景会令人意外、存在真实取舍”时，才新增 ADR。ADR 以决策为中心，但可以附带 `status`、关联 Issue/提交、落地与验证证据、未落地部分和重新评估条件；这些字段描述决策生命周期，不替代 GitHub Issues 的项目状态。项目 ADR 约定见 `docs/adr/README.md`。

`docs/background/` 保持外部输入和历史参考的原有职责；`docs/temp/` 保持用户维护草稿区的原有职责。两者都不作为当前规格或工单的替代事实源。
