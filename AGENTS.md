# ExamForge Agent 工作规则

## 1. 适用范围

本文件适用于整个 ExamForge 仓库。进入子目录工作时，还必须读取该子目录下更近的 `AGENTS.md`。

本仓库承载 ExamForge 排考平台的产品、算法、Web、API、数据层和课程材料。`AGENTS.md` 只记录长期协作规则，不记录当前阶段、最新进展或临时计划。

当前开发进度、已实现内容、验证结果和下一步以 `docs/status/project_status.md` 为准；代码审查发现、存留问题、风险和技术债以 `docs/status/code_review_status.md` 为准；长期架构和模块边界以 `docs/design/` 为准。

## 2. 默认阅读顺序

开始修改前按顺序阅读：

1. 根目录 `AGENTS.md`
2. 目标子树的 `AGENTS.md`
3. `docs/index.md`
4. `docs/status/project_status.md`
5. 与任务相关的 `docs/design/` 或 `docs/plan/` 文档

如果这些文件之间冲突，以更具体目录的 `AGENTS.md`、最新状态文档和用户当前指令为准；长期设计事实应回写到 `docs/design/`，临时执行事实不要写入 `AGENTS.md`。

## 3. 文档治理

文档目录采用简化的单一事实源规则：

- `docs/background/`：课程要求、项目背景、需求分析、可行性分析等输入材料。
- `docs/design/`：长期有效的系统边界、架构、数据模型、算法和接口设计。
- `docs/plan/`：可执行计划、任务拆分、验证命令和交付边界。
- `docs/status/project_status.md`：当前开发事实、最新进展、已实现内容、验证结果和下一步。
- `docs/status/code_review_status.md`：代码审查结果、存留问题、风险、技术债和修复状态。问题解决后不要删除记录，应将状态从 `待解决` 更新为 `已解决`，并补充提交和验证证据。
- `docs/status/` 其他文件：按主题记录当前事实，但不得与上述两个状态文档重复维护同一事实。

计划完成后，不新建专门归档目录。将完成时间、提交、完成内容、验证结果和后续影响追加到 `docs/plan/history_plan.md`，然后删除对应的活动计划文件。

新增、删除或重命名正式文档时，同步更新 `docs/index.md`。

## 4. 开发边界

开发边界由当前设计文档和活动计划决定。不要把某一阶段的实现状态写死在本文件中。

实现时不要做的很保守，要偏向商业、企业级，不要被课程设计这个框架束缚住。

实现时优先保持以下长期边界：

- 算法、Web、API、数据层和文档各自保持清晰职责。
- 排考求解、预检、评分、冲突解释和报告整理应保持可独立测试。
- Web/API 层不得承载算法核心逻辑；算法能力通过明确接口暴露。
- 数据库 schema、API DTO 和前端展示口径需要同步演进。
- 课程报告需要的流程、测试结论和取舍原因应随开发同步沉淀，但不能替代真实实现。

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

Web、API 或数据层修改应按对应 package 的脚本运行最窄可证明验证；具体命令以各 package 的 `package.json`、README 或活动计划为准。

## 6. 不应提交的产物

不要提交缓存、虚拟环境、依赖目录和构建产物，包括：

- `.pytest_cache/`
- `__pycache__/`
- `.venv/`
- `node_modules/`
- `dist/`
- `build/`
- `coverage/`
- `.codegraph/`
