# ExamForge Agent 工作规则

## 1. 适用范围

本文件适用于整个 ExamForge 仓库。进入子目录工作时，还必须读取该子目录下更近的 `AGENTS.md`。

当前项目是软件工程课程设计项目，主题为“高校智能排考与考务资源调度系统”。仓库允许采用相对激进的总体方案，但每次实现必须保持阶段边界清晰、可验证、可写入课程报告。

## 2. 默认阅读顺序

开始修改前按顺序阅读：

1. 根目录 `AGENTS.md`
2. 目标子树的 `AGENTS.md`
3. `docs/index.md`
4. `docs/status/project_status.md`
5. 与任务相关的 `docs/design/` 或 `docs/plan/` 文档

如果这些文件之间冲突，以更具体目录的 `AGENTS.md` 和最新状态文档为准；长期设计事实应回写到 `docs/design/`，临时执行事实不要写入 `AGENTS.md`。

## 3. 文档治理

文档目录采用简化的单一事实源规则：

- `docs/background/`：课程要求、项目背景、需求分析、可行性分析等输入材料。
- `docs/design/`：长期有效的系统边界、架构、数据模型、算法和接口设计。
- `docs/plan/`：可执行计划、任务拆分、验证命令和交付边界。
- `docs/status/`：当前事实、最新进展、风险和下一步。

计划完成后，不新建专门归档目录。将完成时间、提交、完成内容、验证结果和后续影响追加到 `docs/plan/history_plan.md`，然后删除对应的活动计划文件。

新增、删除或重命名正式文档时，同步更新 `docs/index.md`。

## 4. 开发边界

当前第一版实现以 `apps/scheduler/` 的 Python 排考算法原型为核心。Web、API、数据库、队列和部署能力属于后续阶段，除非当前计划明确要求，不应提前创建。

实现时优先保持以下边界：

- 算法数据模型和测试数据生成器可以独立运行。
- 排考求解、预检、评分、冲突解释分别作为独立模块演进。
- Web/API 层不得承载算法核心逻辑。
- 课程报告需要的流程、测试结论和取舍原因应随开发同步沉淀。

## 5. Git 与验证

修改前先运行：

```bash
git status --short --branch
```

不要回滚用户已有改动。除非用户明确要求，不要自动提交或推送。

文档类修改至少运行：

```bash
git diff --check
```

调度器代码修改优先运行：

```bash
cd apps/scheduler
python -m pytest -q
```

如果本机 Python 或依赖不满足 `apps/scheduler/pyproject.toml`，需要报告具体阻塞，不要声称测试通过。

## 6. 不应提交的产物

不要提交缓存、虚拟环境、依赖目录和构建产物，包括：

- `.pytest_cache/`
- `__pycache__/`
- `.venv/`
- `node_modules/`
- `dist/`
- `build/`
- `coverage/`
