# ExamForge 项目状态

## 1. 当前结论

- 第五版第五阶段已于 2026-07-14 完成并归档，当前唯一活动计划为 `docs/plan/第五版第六阶段计划.md`。
- Web 已从根路由组合原型拆分为登录、管理员、排考、运行、草稿、审计、教师本人和学生本人页面；筛选、分页、对比和选中对象进入 URL，可直接访问、刷新和前进后退。
- 教师与学生作用域由 PostgreSQL 关联和服务端会话决定。本人页面只调用 `/api/me/*`，不能通过路径、查询参数或请求体切换到其他教师或学生群体。
- 作业、SSE、策略快照、发布资格和审计继续复用第三、第四阶段的服务端合同；页面拆分没有复制任务状态机或把 PostgreSQL 事实迁入浏览器。
- 代码审查存留问题共 2 项：P2 的 CR-002 和 P3 的 CR-003；当前无待解决 P0/P1。详细问题只维护在 `docs/status/code_review_status.md`。
- 本阶段未提交或推送，未操作腾讯云或其他远程服务器。第六阶段涉及依赖安全、镜像发布和正式部署，必须单独执行并取得远程授权。

## 2. 已实现内容

### 2.1 本人作用域与角色路由

- 新增 `0014_user_audience_scopes.sql`，以 `user_teacher_scopes` 和 `user_student_group_scopes` 保存用户与教师/学生群体的关系；外键、教师唯一绑定、重复迁移和第四阶段数据升级均由迁移测试与检查器覆盖。
- 新增 `/api/me/audience`、`/api/me/published-schedule`、`GET /api/me/teacher-unavailable-slots` 和 `PATCH /api/me/teacher-unavailable-slots`。教师只能读取本人监考与维护本人不可用时间，学生只能读取所属群体的已发布安排。
- 旧按教师或学生群体 ID 的发布查询不再匿名开放；管理员/排考员保留受保护的运营预览，教师/学生越权访问稳定返回 403，缺失本人 scope 不回退到演示 ID。
- 全局 `AuthProvider`、角色路由守卫和两类应用壳已经落地。根路由按真实会话角色分流，匿名深链使用安全 `returnTo` 回跳，会话失效清理私有 Query cache；403、404、页面错误和加载状态均有独立页面表达。

### 2.2 页面化运营工作流

- 管理员概览与基础数据迁入 `/admin/overview` 和 `/admin/reference-data`；资源 tab、筛选和选中记录由 URL 保持，局部请求失败不会抹去其他成功数据。
- 作业中心与策略治理迁入 `/scheduling/jobs` 和 `/scheduling/policies`。作业筛选、分页和选中任务由服务端稳定处理，详情继续展示持久化 attempt、有序事件、SSE、诊断、取消与运行入口；策略修改仍采用不可变版本、CAS、启停和唯一默认治理。
- 运行、对比和审计迁入 `/scheduling/runs` 与 `/audit`，支持深链筛选、发布/回滚确认、策略与 scheduler 追溯、审计 payload 按需展开以及不存在实体的 404。
- 草稿唯一编辑入口为 `/scheduling/drafts/:id`。矩阵使用 dnd-kit 的 pointer/keyboard sensor，并保留等价检查器表单；拖拽前后核对草稿、考试和响应代次，锁定与终态同时禁止所有 mutation 入口。
- 教师 `/teacher/schedule` 展示下一场监考、按日期分组日程和本人不可用时段；学生 `/student/schedule` 只展示所属群体考试，不泄露教师工作量、内部冲突或策略诊断。

### 2.3 视觉与可访问性门禁

- 全局样式拆分为 token、布局和表单层，受众页面使用独立 CSS module；移除残余暖色硬编码和无意义装饰，补齐跳到主内容、焦点可见、语义列表、图标标签和 `prefers-reduced-motion`。
- Playwright 固定 1600 x 1000、1280 x 800、768 x 1024 和 375 x 812 四种视口，并保存登录、概览、作业、草稿桌面及教师、学生移动端共 6 张 Linux Chromium 基线。
- `@axe-core/playwright` 对登录和全部关键角色页面执行 WCAG 2.1 A/AA 自动扫描；另有 200% 文本、403、404、依赖失败、键盘拖拽、焦点和页面级横向溢出专项断言。
- 旧根路由组合组件及已迁移的发布、运行、审计和教师不可用面板已删除；现有页面按 feature、layout、route 和纯 URL model 分工，不再维护第二套聚合入口。

### 2.4 真实依赖与故障证据

- 独立 Compose 项目从空 PostgreSQL/Redis 卷完成迁移、seed、四角色登录、本人 scope、作业提交、SSE、策略选择、运行跳转、草稿调整和发布查询。
- API 重启与 SSE 重连最终为 1 个 attempt、5 个事件和 1 个运行；Redis 停止恢复和 Publisher 重启也各保持 1 个 attempt、5 个事件和 1 个运行。
- Worker 崩溃由第 2 个 attempt 以 `worker_delivery_reclaimed` 回收，scheduler 暂停由第 2 个 attempt 在首个 `scheduler_unavailable` 后恢复；两种场景均为 8 个有序事件和 1 个运行。
- 重复投递同一 outbox 只增加 outbox 投递次数，不增加作业 attempt、业务事件或运行。全部证据使用独立端口、卷和测试数据库，完成后已删除该项目的容器、网络和卷，用户已有 Compose 栈未被修改。

## 3. 最新验证事实

- 快速与静态门禁：`npm run test:ci` 为 `7 passed`；`npm run check:ci`、`npm run typecheck`、`npm run check:scheduler-openapi`、`npm run build`、`docker compose config --quiet` 和 `git diff --check` 通过。
- 应用测试：shared `21 passed`，scheduling application `11 passed`，API `91 passed`，Web `21 passed`；隔离 PostgreSQL/Redis Worker `14 passed`；scheduler `97 passed`，保留 1 条 Starlette/httpx 2 上游弃用警告。
- 数据库门禁：15 个迁移从空库首次全部应用，第二次应用数为 0；迁移测试 `9 passed`，迁移检查无缺失表、约束、回填或策略不一致，正式迁移入口返回 `applied: []`；PostgreSQL 集成测试 `21 passed`。
- 浏览器门禁：最终完整 Playwright 为 `32 passed, 3 skipped`，共 35 项；3 项只在主 Chromium 运行的状态专项在其他视觉视口按配置跳过。四角色路由、本人作用域、草稿 pointer/keyboard 操作、运营页面、Axe 扫描、截图和溢出检查均通过。
- 本轮重新运行 `npm audit --audit-level=moderate` 仍有 2 个来自 `next@15.5.20 -> postcss@8.4.31` 的 moderate 公告。强制 override 会违反 Next 的精确依赖，自动修复会错误降级，故未伪造零告警结论；继续按 CR-002 阻断正式发布前的依赖门禁处理。

## 4. 当前边界

- 尚未建立版本化镜像发布、生产 Compose、正式 secrets、可信来源/Cookie 策略、nginx/HTTPS、异机备份、日志监控、线上 smoke 或回滚演练。
- 腾讯云 4 核 4 GB 服务器上的 150 场基准、完整业务闭环、资源峰值和真实网络 E2E 尚未执行；本地 Compose 结果不能冒充远程验证。
- CR-002 必须在正式发布前解决或由明确的风险接受决定处置；CR-003 在本地 Docker 代理变化或转移到独立服务器时重新评估。
- 第五版仍不包含多租户、SSO、多策略批量实验、Pareto 推荐、联合全局优化或 Kubernetes 高可用。
- 运行中取消仍是协作式尽力语义，不承诺强制终止已进入 OR-Tools 的线程，也不保留被强杀求解的中间最优解。

## 5. 下一步

1. 按 `docs/plan/第五版第六阶段计划.md` 先完成 CR-002 依赖安全门禁和生产发布物，不直接在服务器现场构建源码镜像。
2. 取得目标主机、域名、镜像仓库、凭据方式和维护窗口的明确授权后，再执行只读预检、私有部署、备份恢复、HTTPS、资源约束、线上 smoke 和镜像回滚。
3. 腾讯云验证通过后有限开放，完成第五版全量代码审查、交付文档和计划归档；未取得远程证据前不得宣称第五版整体完成。
