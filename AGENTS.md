# ExamForge Agent 工作规则

## 1. 任务入口

ExamForge 是个人维护的排考平台，包含调度算法、Web、API、数据库和运行工具。根级 `AGENTS.md` 是唯一仓库规则入口；领域术语、长期决策和工作票据分别由 `CONTEXT.md`、`docs/adr/` 和 GitHub Issues 承载。

开始任何修改前：

1. 运行 `git status --short --branch`，保留用户已有改动。
2. 读取根 `CONTEXT.md`，再读取与当前工作相关的 `docs/adr/`。
3. 读取当前 GitHub issue/spec/ticket 的完整正文和验收条件；没有票据时先判断是否需要 Wayfinder、grilling 或 spec。
4. 需要理解代码时，仓库存在 `.codegraph/` 就先使用 CodeGraph；新增文件、纯文本和索引未覆盖的内容再使用常规检索。

任务完成的最低标准是：目标事实已写入唯一权威位置，验收条件有对应证据，工作树没有由本次验证产生的应提交产物。

## 2. Matt skill 工作流

- 规格、决策票和 tracer-bullet ticket 统一发布到 GitHub Issues；具体命令、标签和 Wayfinder 操作见 `docs/agents/issue-tracker.md`。
- 大型且路径未清晰的工作先走 Wayfinder；路径清晰后用 `/to-spec`、`/to-tickets`，再按 ticket 使用 `/implement`。
- `/implement` 内部采用 TDD；交付前使用 `/code-review` 做 Standards 与 Spec 双轴复核。
- 领域术语只由 `CONTEXT.md` 规范；硬决策只有满足 ADR 三项条件时才写入 `docs/adr/`。消费规则见 `docs/agents/domain.md`。
- 新建或修改 agent-facing 文档时遵循渐进披露：入口文件写步骤和触发条件，长参考资料通过明确指针按需加载。

## 3. 文档事实源

- `CONTEXT.md`：ExamForge 规范术语、概念关系和领域边界；不写实现细节、计划、状态或聊天记录。
- `docs/adr/`：难以逆转、没有背景会令人意外且经过真实取舍的长期决策。
- GitHub Issues：spec、Wayfinder map、决策票、实现 ticket、验收和解决记录。
- `docs/background/`：外部输入与历史参考，保持原有职责；除非用户明确要求，不改写其内容。
- `docs/temp/`：用户维护草稿区，保持原有职责；不默认遍历、搜索、清理或迁移。
- `docs/archive/`：迁移期间的既有设计、计划和状态材料，仅作历史参考。新工作不在其中复制创建 spec/ticket；当前边界以 Wayfinder map、GitHub Issues 和 ADR 为准。

课程报告、课程演示和课程交付材料已退出当前产品范围，不为后续开发新增或维护此类内容。

## 4. 产品与模块边界

- `apps/scheduler/` 负责 Python 排考数据合同、预检、CP-SAT 求解、评分、冲突解释和报告整理。使用 `snake_case`；不实现 Web 页面、HTTP API、数据库访问或前端状态管理。
- `apps/api/` 负责业务 API、排考运行入口、数据聚合和外部边界。
- `apps/web/` 负责运营工作台、安排展示、冲突解释和资源分析。
- Web/API 不承载算法核心逻辑；算法通过明确的 scheduler 接口调用。
- shared 合同、API DTO、数据库 schema、OpenAPI 和前端展示口径必须同步演进。
- 新增模块或改变跨模块边界时，先更新相关 spec/ADR，再实现行为。

## 5. 验证

按改动范围运行最窄可证明命令：

| 改动范围 | 命令 |
| --- | --- |
| 文档或配置 | `git diff --check` |
| 文档治理入口或归档 | `npm run check:docs` |
| 调度器 | `npm run test:scheduler` |
| TypeScript 类型 | `npm run typecheck` |
| Web、API、共享或应用层 | `npm test` |
| 数据库迁移 | `npm run test:migrations` |
| 部署与运维 | `npm run test:deploy` |
| 端到端 | `npm run test:e2e` |

Node 依赖仓库锁定的版本；调度器测试使用仓库脚本固定 Python 3.12 和 `uv`。依赖或真实 PostgreSQL 缺失时，报告具体命令和阻塞，不得将未执行验证描述为通过。

## 6. Git 与产物

- 当前工作的 Git 交付动作由对应 GitHub issue 末尾的 `Delivery decision` 决定；先读取该段，再执行其中声明的 commit、push 或 PR 动作。
- issue 没有 `Delivery decision` 时，先补齐 issue 决策，再进入 Git 写入步骤；不根据个人惯例猜测交付动作。
- 保留用户已有改动；提交前检查 diff 范围和提交内容是否与 issue 一致。
- 不提交 `.pytest_cache/`、`__pycache__/`、`.venv/`、`node_modules/`、`dist/`、`build/`、`coverage/` 或 `.codegraph/`。
