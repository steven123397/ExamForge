# ExamForge Scheduler

Python 3.12 调度器负责输入预检、room-slot 求解、教师分配、评分、冲突解释和报告生成。

## 测试

在仓库根目录运行：

```bash
npm run test:scheduler
```

## 规模基准

标准基准固定使用 seed `20260711`，分别求解 50、100、150 场考试：

```bash
npm run benchmark:scheduler
```

也可以在 `apps/scheduler` 下自定义规模：

```bash
uv run --python 3.12 --extra dev python -m examforge_scheduler.benchmark \
  --sizes 50 100 150 \
  --seed 20260711 \
  --time-limit 30
```

命令为每个规模输出一行 JSON，包含考试数、求解状态、耗时、候选安排数、评分、冲突数、教师最大负载和负载极差。任一规模未得到完整可行解或存在硬冲突时，命令返回非零状态。

规模数据启用全部硬约束、教师负载均衡、考场利用率、学生连续考试和考试分布目标。`teacher_consecutive_invigilation` 在规模 profile 中显式设为 `0`，避免可选的连续监考全局最优证明占满时间预算；该目标由教师分配专项测试单独覆盖。
