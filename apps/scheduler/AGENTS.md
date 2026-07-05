# scheduler 调度器规则

## 1. 适用范围

本文件适用于 `apps/scheduler/`。该目录承载第一版 Python 排考算法原型，目标是验证数据合同、约束建模、求解、评分和冲突解释。

## 2. 模块边界

当前模块职责：

- `examforge_scheduler/models.py`：输入输出数据合同和轻量校验。
- `examforge_scheduler/generator.py`：可复现测试数据生成器。
- `examforge_scheduler/precheck.py`：求解前确定性预检。
- `examforge_scheduler/solver.py`：OR-Tools CP-SAT 求解。
- `examforge_scheduler/scoring.py`：软约束评分。
- `examforge_scheduler/conflicts.py`：冲突解释。
- `examforge_scheduler/report.py`：运行统计和课程报告素材整理。

不存在的模块只有在对应计划启动时再创建。不要在本目录实现 Web 页面、HTTP API、数据库访问或前端状态管理。

## 3. 数据合同

Python 代码统一使用 `snake_case`。后续 Web/API 层如需 `camelCase`，由接口层转换，不在调度器内部处理。

数据模型应优先保持不可变和可测试。新增字段时同步更新：

- 对应 dataclass
- 测试数据生成器
- 相关测试
- 设计或状态文档中受影响的接口说明

## 4. 验证命令

在 `apps/scheduler/` 下运行：

```bash
python -m pytest -q
```

项目配置要求 Python 版本满足 `pyproject.toml`。如果本机默认 `python` 不存在，或只有不满足要求的 `python3`，需要明确报告环境阻塞。

文档或配置变更仍需在仓库根目录运行：

```bash
git diff --check
```
