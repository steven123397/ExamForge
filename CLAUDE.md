# ExamForge — Claude Code 指令

仓库通用协作规则见下方导入的 `AGENTS.md`，它是唯一规范源。本文件只补充 Claude Code 专属的操作约定，不重复其内容。

@AGENTS.md

## 1. 子目录规则

根 `AGENTS.md` 之外，仓库还有更近的规则文件。进入以下子树工作前先读对应文件：

- `docs/AGENTS.md` — 文档目录职责、计划生命周期、中文写作规范
- `apps/AGENTS.md` — 应用层通用约束
- `apps/scheduler/AGENTS.md` — 排考求解器专属约束

冲突时以更具体目录的规则和用户当前指令为准。

## 2. 代码检索优先用 CodeGraph

本仓库已建立 `.codegraph/` 索引。定位或理解代码时先调用 `codegraph_explore`，不要默认从 grep/find/逐文件 Read 开始。它一次返回相关符号的逐行源码、调用路径和影响面，改代码前用它确认改动波及范围。索引不覆盖的场景（新增文件、纯文本文档、配置）再退回常规检索。

## 3. 验证命令速查

改动后运行最窄可证明的验证，命令统一走根 `package.json` 脚本：

| 改动范围 | 命令 |
| --- | --- |
| 文档 | `git diff --check` |
| 排考求解器（Python） | `npm run test:scheduler` |
| TypeScript 类型 | `npm run typecheck` |
| Web / API / 数据层 | `npm test` |
| 数据库迁移 | `npm run test:migrations` |
| 部署与运维配置 | `npm run test:deploy` |
| 端到端 | `npm run test:e2e` |

Python 侧依赖 `uv` 与 Python 3.12；Node 侧要求 `node ^22.22.2 || ^24.15.0 || >=26.0.0` 且 `npm@12.0.1`。环境不满足时报告具体阻塞，不得声称测试通过。

## 4. 交互约定

- 默认使用中文回复；中文正文用全角标点，命令、路径、代码标识用反引号。
- 不自动 `git commit` 或 `git push`，除非用户明确要求；不回滚用户已有改动。
- 完成一段工作后，按 `AGENTS.md` 第 3 节同步 `docs/status/project_status.md`、`docs/plan/history_plan.md` 和 `docs/index.md`，不要新建归档目录。
- `docs/temp/` 在正式文档体系之外，不默认遍历或搜索，只在用户明确指定时读写。
