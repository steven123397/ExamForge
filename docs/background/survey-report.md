# 腾讯云服务器部署环境勘察报告

> **2026-07-14 现状更新：** 经用户授权，数据盘和 COS 已迁到多项目共享挂载点 `/srv/data/hot`、`/srv/data/cos`，旧 `/srv/data/devbrain-lab` 层级已移除；OpenViking 与 COS 挂载服务已恢复健康。本文后续推荐路径按新挂载点更新，`## 11. 执行过的命令` 仍保留勘察当日的历史路径与证据。

> **2026-07-15 任务 6 复核：** 再次执行脱敏只读检查。Ubuntu、4 核 3.6 GiB、Docker、Compose、nginx、共享挂载和候选端口均满足进入正式预检的主机前提；根域名与 `www` 已解析。正式镜像与 GitHub release artifact 已生成，`ubuntu` 用户使用既有只读 TCR 登录对四个精确 digest 执行 `docker manifest inspect` 均成功；未拉取镜像层，服务器仍无 ExamForge 镜像、容器、正式清单副本或专属目录。维护窗口仍为备案通过后的第一个可用晚上 22:00–00:30（北京时间）；ExamForge 证书尚不存在且备案仍在审核，因此当前结论为 `no-go`，未执行任何部署或 nginx 写入。

> 工作目录：/srv（root 拥有，无写权限），本报告写入 /home/ubuntu/survey-report.md
> 勘察时间：2026-07-12 16:00 CST
> 模式：只读勘察，未做任何修改、安装、启停、docker 变更操作
> sudo 说明：通过交互式 sudo 跑了一批只读命令（见 sudo-readonly-commands.md）。

## 文档使用边界

本文档是服务器环境勘察输入，不是 ExamForge 部署设计或实施计划。文中的系统版本、资源、端口、挂载点、运行服务和命令结果属于勘察时点的观测事实；对根因的判断属于待核实推断；部署目录、资源配额、中间件参数和实施顺序属于候选建议。

项目侧使用本报告时，应以 ExamForge 实际代码、正式设计文档和私有试部署证据为准。报告中的“建议”或“必须”不自动形成项目约束。2026-07-12 项目侧复核已修正 Redis 淘汰策略、scheduler 资源、内部端口和 swap 表述，并将无法从主机侧确认的备案原因保留为推断。

## 1. 执行摘要
1. 服务器为 Ubuntu 22.04.5 LTS（4 vCPU / 3.6 Gi / 40 G 系统盘 + 20 G 数据盘），空闲度高，反代与两个网站运行稳定，**适合**同机部署 ExamForge，但需做资源限制。
2. 内存是首要约束：无 swap，勘察时已用约 1.4 GiB，留约 1.7–1.9 GiB；该数值包含 Codex/opencode 等交互式勘察进程，不能直接视为生产稳态。建议在私有试部署前配置 2–4 GB swap 作为峰值保护，并通过真实负载确定容器内存上限。
3. 反向代理为 nginx（非 Caddy），托管两个站点 + Certbot 自动续期，**建议复用 nginx 新增子域名**，暂不迁移 Caddy。
4. 两个站点都仅本地端口（8101、4173），关键端口 3000/3001/5432/6379 当前全空，与 ExamForge 无冲突。
5. 20 G ext4 数据盘（现挂载于 `/srv/data/hot`，勘察时 19 G 可用）可作为 ExamForge PostgreSQL、Redis 和上传数据的候选持久化位置，最终目录和配额由项目部署设计决定。
6. Docker 29.4.0 + Compose v5.1.2 已就绪，存储驱动 overlayfs，Docker Root 占 144 M，磁盘空间充足。
7. 系统无 PG/MySQL/Redis/Caddy/Apache 服务在跑，无 systemd/cron 配置文件级业务自动备份；现有 /srv/backups 目录均为空，**部署后需建立 ExamForge 的备份与日志策略**。
8. UFW 已启用，仅放行 22/80/443；腾讯云安全组无法从主机内确认。
9. Let's Encrypt 证书：`campus2hand.site` 将于 2026-07-13 到期，续期 dry-run 已确认失败，HTTP-01 请求返回 DNSPod `webblock.html`，没有到达本机 nginx；ICP备案状态是高概率原因，但必须在腾讯云控制台确认。`my-visual-cpu.site` 证书将于 2026-09-29 到期，dry-run 成功。ExamForge 正式域名签发证书前也需要验证公网解析、备案状态和 HTTP-01 可达性。
10. 见到大量扫描器流量（Infrawatch / zgrab / wp-admin / FlowIQLabsBot 等）打 80/443，属公网暴露站点常见噪声，不影响 ExamForge，但说明有必要在 nginx 侧统一限速与默认 server 拒绝未知 Host。

## 2. 系统与资源
| 项 | 值 |
|---|---|
| 当前用户 / UID | ubuntu / uid=1000，属 docker、sudo 组（sudo 需密码） |
| 主机名 | VM-0-2-ubuntu |
| 系统 | Ubuntu 22.04.5 LTS (jammy)，KVM 虚拟机 |
| 内核 | 5.15.0-174-generic |
| 架构 | x86_64 |
| 启动时间 | 2026-04-19 23:09:48（已运行 83 天） |
| CPU | Intel Xeon Platinum 8255C @ 2.50GHz，4 vCPU（1 Socket × 4 Core × 1 Thread） |
| 时区 / NTP | Asia/Shanghai (+0800)，ntpd 同步，RTC 为 UTC |
| 总内存 | 3.6 Gi (3719 MiB) |
| 已用 / 可用 | 1454 / 1971 MiB（buff/cache 2059 MiB） |
| Swap | **未配置（0 B）** |
| Load average | 0.01 / 0.13 / 0.12 |
| 公网 IP | 81.70.x.x（脱敏） |
| Codex | codex-cli 0.144.1，路径 /home/ubuntu/.nvm/.../v20.20.2/bin/codex |

内存占用 Top（含本勘察会话）：opencode 706 MiB、openviking-serv 188 MiB、systemd-journal 110 MiB、codex 105 MiB、mycpu node 96 MiB、dockerd 44 MiB、hermes-gateway 46 MiB、nginx master+4 worker 合计约 41 MiB。

判定：勘察时约 1.4 GiB 已用，其中 Codex/opencode 合计约 811 MiB，属于可能退出的交互式负载。正式容量基线必须在关闭非必要交互进程后重新测量；现有数据只能证明需要私有试部署和资源限制，不能提前证明某一组配额必然可行。

## 3. 磁盘与挂载
| 设备 | FS | 挂载点 | 容量 | 已用 | 可用 | 建议用途 |
|---|---|---|---|---|---|---|
| /dev/vda2 | ext4 | / | 40 G | 18 G | 20 G | 系统盘；Docker Root、应用代码、journald |
| /dev/vdb | ext4 | /srv/data/hot | 20 G | 15 M | 19 G | **ExamForge 持久化数据主目录** |
| cosfs | fuse.cosfs | /srv/data/cos | 256 T（COS） | 0 | — | 对象存储，**不宜放 PG/Redis** |

文件系统详情：
- vda2：Block size 4096，Block count 10485243，Free blocks 7172608，Mount count 83，Last checked 2022-04-24，挂载选项 `rw,relatime`。
- vdb：Block size 4096，Block count 5242880，Free blocks 5112743，Mount count 2，Last checked 2026-04-15，挂载选项 `rw,relatime`。
- Inode：root 15%，vdb 1%，无压力。

一级目录占用（系统盘）：
- /var/lib/docker 144 M
- /var/log 390 M，其中 journald 344 M（已确认）
- /srv/apps/* 均很小；/srv/apps/my_visual_CPU/logs 7.5 M
- /home/ubuntu/.hermes：state.db 86 MiB + 目录若干
- /usr/local/qcloud 7 M（腾讯云 agent）

## 4. 现有网站
### 站点 A：my-visual-cpu
- 仓库：github.com/steven123397/my_visual_CPU，分支 main，HEAD 3bb3bbd，无未提交改动。
- 部署目录：/srv/apps/my_visual_CPU/repo。
- 运行方式：systemd `mycpu-frontend.service`（user ubuntu，Restart on-failure）。
  - ExecStart：`bash -lc 'source nvm; nvm use 20; node frontend/server/debug_server.mjs --port=4173'`。
- 端口：127.0.0.1:4173（仅本机）。
- 反向代理：nginx server `my-visual-cpu.site`，upstream 127.0.0.1:4173，listen 80 与 443 ssl，证书 /etc/letsencrypt/live/my-visual-cpu.site/fullchain.pem。
- 数据：runtime-assets 在 /srv/apps/my_visual_CPU/runtime-assets；日志 /srv/apps/my_visual_CPU/logs（7.5 M，含 audit.log、nginx-access.log、nginx-error.log）。
- 数据库：无。
- 资源：内存约 96 MiB，CPU 接近 0。

### 站点 B：campus2hand（二手交易系统）
- 仓库：github.com/steven123397/campus_secend_trading_system，分支 main，HEAD fe256e0；代码目录 /srv/apps/trading-system/app。
- 部署目录：/srv/apps/trading-system。
- 运行方式：Docker Compose（项目名 trading-system，工作目录 /srv/apps/trading-system，配置 docker-compose.yml）。
- 容器：trading-system（镜像 trading-system-app:latest，214 MB），Restart unless-stopped，已运行 2 个月。
- 端口：127.0.0.1:8101 -> 容器 8000（仅本机）。
- 反向代理：nginx server `campus2hand.site`，proxy_pass http://127.0.0.1:8101，listen 443 ssl（certbot managed）+ 80，证书 /etc/letsencrypt/live/campus2hand.site/fullchain.pem。
- 数据/卷：bind ./data:/app/data、./logs:/app/logs（本地目录，未用 named volume）；env_file .env（已脱敏未读）。
- 数据库：容器内自带，无外部 PG/Redis 端口暴露。
- 资源：占用很小（不足 1% CPU、内存 < 50 MiB 的 Python 应用）。

### 其他目录（非活跃网站）
- /srv/apps/devbrain：仓库 github.com/steven123397/DevBrain，分支 claude-test，HEAD fea0cdc。仅 openviking 文档同步 oneshot 服务（devbrain-openviking-sync.service），非 Web 站点，无对外端口。
- /srv/apps/project-c：仅空目录，无服务。
- /home/ubuntu/.hermes/hermes-agent：hermes-agent（python venv + node），有 docker-compose.yml 但当前**无运行容器**，不对外暴露端口。

## 5. Docker 与服务
| 项 | 详情 |
|---|---|
| Docker Engine | 29.4.0 |
| Docker Compose | v5.1.2（插件） |
| 存储驱动 / 架构 | overlayfs on containerd；x86_64；Ubuntu 22.04 |
| Docker Root | /var/lib/docker（144 M） |
| 容器 | 1（运行中 1）：trading-system |
| 镜像 | 2：trading-system-app:latest 214 MB、hello-world:latest 26 KB |
| 卷 | 0 |
| 网络 | bridge、host、none、trading-system_default（bridge） |
| 容器日志 | /var/lib/docker/containers 仅 48 KB |
| Docker 磁盘占用 | Images 214 MB，Containers 20 KB，Volumes/BuildCache 0 |

容器资源限制（本轮模板字段 NanoCpu 不存在，只取到部分）：
- trading-system：RestartPolicy=unless-stopped；未设 Memory/CPU 上限；LogDriver=json-file，未显式配置 max-size。
- 风险点：容器日志无大小限制，长期运行可能膨胀；ExamForge 容器应显式配置 `logging: driver: json-file, max-size: "10m", max-file: "3"`。

systemd 相关服务：
- nginx：enabled/active
- docker：enabled/active
- mycpu-frontend.service：enabled/active
- openviking.service、devbrain-openviking-sync(.path)、hermes-gateway.service、cosfs-devbrain-cos.service：enabled/active 或 static
- unattended-upgrades：enabled（APT::Periodic::Update-Package-Lists=1、Unattended-Upgrade=1）
- 已启用定时器：certbot.timer（续期）、apt-daily / apt-daily-upgrade、logrotate.timer、dpkg-db-backup.timer、fstrim.timer、man-db.timer、motd-news.timer、fwupd-refresh.timer、update-notifier-*。

## 6. 网络、域名与 HTTPS
监听端口（ss -tlnp）：
| 端口 | 监听 | 用途 |
|---|---|---|
| 22 | 0.0.0.0 / [::] | sshd（注意日志见大量 pam_qrlogin 失败，疑似腾讯云 QR 扫码登录尝试） |
| 80 | 0.0.0.0 | nginx（默认 + my-visual-cpu + campus2hand） |
| 443 | 0.0.0.0 | nginx（my-visual-cpu、campus2hand HTTPS） |
| 8101 | 127.0.0.1 | docker-proxy（trading-system） |
| 4173 | 127.0.0.1 | mycpu node frontend |
| 1933 | 127.0.0.1 | openviking-server |
| 53 | 127.0.0.53 | systemd-resolved |
| 123 | udp | ntpd |
| **3000 / 3001 / 5432 / 6379 / 8080** | — | **空闲**，可分配给 ExamForge |

nginx 已配置 server（脱敏后关键字段）：
- my-visual-cpu.site：listen 80 + 443 ssl，ssl_certificate /etc/letsencrypt/live/my-visual-cpu.site/fullchain.pem，upstream mycpu_frontend=127.0.0.1:4173，多 location 全部 proxy_pass http://mycpu_frontend。
- campus2hand.site：listen 443 ssl（certbot managed）+ listen 80，ssl_certificate /etc/letsencrypt/live/campus2hand.site/fullchain.pem，proxy_pass http://127.0.0.1:8101。
- default：80 default_server，root /var/www/html。

公网 IP：81.70.x.x；两个域名均解析到该 IP（本机 /etc/hosts 已绑定）。

证书：
- /etc/letsencrypt/live/ 下有 campus2hand.site、my-visual-cpu.site 两个目录，README 存在。
- 有效期（已确认，发证：Let's Encrypt；中间 CA：campus2hand=R13，my-visual-cpu=YR1）：
  - **campus2hand.site**：notBefore 2026-04-14，notAfter **2026-07-13**（勘察当日为最后一天，明日到期）。
  - **my-visual-cpu.site**：notBefore 2026-07-01，notAfter **2026-09-29**（约 2.5 个月，尚未进入 certbot 续期窗口 30 天）。
- certbot.timer 已启用并正常运行（NEXT Sun 2026-07-12 17:27:36 CST）。私钥未读取。
- **续期 dry-run 结果（关键）**：
  - `sudo certbot renew --dry-run` → `my-visual-cpu.site` 仍可成功，`campus2hand.site` **失败**。
  - 失败响应（来自 LE Boulder）：`Invalid response from https://dnspod.qcloud.com/static/webblock.html?d=campus2hand.site`。这证明 HTTP-01 请求没有命中本机 nginx 的临时 challenge 文件，而是返回 DNSPod `webblock.html`。
  - **结论**：campus2hand.site 明日 07-13 起大概率证书失效，HTTPS 会变自签/过期，二手交易系统前端将告警。
  - 根因推断：`campus2hand.site` 可能未完成 ICP 备案、备案失效或受到其他 DNS/接入策略影响。主机侧不能确认具体原因，需要在腾讯云控制台核实备案、DNS 和接入状态。

2026-07-14 任务 6 复核补充：

- `nginx -t` 通过，现有配置脱敏归档指纹为 SHA-256 `e52d6059e3cb68277783c377e1300eff936e7f64cf443bf9f42f6a21e88555b0`。
- `examforge.site` 与 `www.examforge.site` 均可解析，但 `/etc/letsencrypt/live/examforge.site/fullchain.pem` 尚不存在。
- `campus2hand.site` 证书现已确认过期；`my-visual-cpu.site` 证书有效至 2026-09-29。
- TCR registry 网络可达；`ubuntu` 用户已完成交互式登录，Docker 配置 owner 为 `ubuntu:ubuntu`、权限为 600，且存在 TCR 登录项。凭据值未读取；2026-07-15 已对 API、scheduler、Web、Worker 四个正式 digest 完成远程 manifest 读取验证，未执行镜像层拉取。

UFW：active，default deny incoming / allow outgoing / deny routed，**放行 22/80/443（含 v6）**。日志 on (low)。

nginx 当前状态：master + 4 worker，CPU 0%、内存各 6–10 MiB；80/443 当前 established 连接 1 个。

腾讯云安全组无法从主机内确认，需控制台核对放行端口（ExamForge 仅需 80/443 对外即可，内部端口经 nginx 转发）。

日志摘要（仅大小与最近错误类型）：
- my-visual-cpu nginx-error 日志：大量 `SSL_do_handshake() failed: bad key share`（客户端侧扫描器噪声），以及偶发 `client intended to send too large body`（10 MiB 上传被拒，nginx 默认 client_max_body_size 1 MiB）。
- my-visual-cpu audit.log：早期登录事件，5 月后无更新。
- journald err 摘要：最近一周几乎全是 sshd `pam_qrlogin conversation failed`（腾讯云 QR 扫码登录失败，非 ExamForge 关心）。
- dmesg err/crit：无。
- trading-system / devbrain logs：无近输出。

## 7. 数据与备份
- PostgreSQL / MySQL / MariaDB / Redis：均 inactive 且未安装二进制（无 psql / mysql / redis-server），与 ExamForge 无冲突。
- 现有持久化：
  - trading-system：/srv/apps/trading-system/{data,logs}（bind mount，体积很小）
  - openviking 索引/缓存：`/srv/data/hot` 下的现有 OpenViking 子目录（勘察时 15 M）
  - hermes：/home/ubuntu/.hermes 的 state.db（86 MiB）+ sessions/backups 目录
- 自动备份：/srv/backups/{devbrain,project-b,project-c,trading-system} 目录**均为空**；无 PG/mongodump/restic/borg 类 cron 任务；**当前实际没有业务自动备份在运行**。
- 日志轮转：logrotate.timer enabled，每日；journald 占 344 MiB（建议上限型配置）。
- cron（root crontab + /etc/cron.d）：
  - 腾讯云 stargate 自愈（每 5 分钟，root crontab 与 /etc/cron.d 各一份）
  - 云镜 YDCrontab（每 30 分钟，含 @reboot）
  - certbot（systemd timer 优先，cron 为兜底）
  - e2scrub_all（每周）
  - 标准 logrotate、apt-compat、man-db、dpkg、ntp、apport
- 腾讯云 agent：/usr/local/qcloud 7 M；barad_agent、YDService、cosfs 常驻，资源占用极小。

## 8. ExamForge 推荐部署布局
**总体策略**：CI 构建镜像 + 服务器仅 `docker compose pull && up -d`；同机 Compose 部署；复用 nginx 反代。

| 项 | 推荐 |
|---|---|
| 应用代码目录 | /srv/apps/examforge（放 compose 文件、nginx 片段、运维脚本；不存放构建产物） |
| Compose 项目名 | examforge |
| 持久化数据目录 | /srv/data/hot/examforge（vdb，勘察时 19 G 可用） |
| 内部端口 | Next.js Web 和 Fastify API 可按需映射到宿主机 `127.0.0.1:3000/3001` 供 nginx 反代；PostgreSQL、Redis、Worker 和 Scheduler 只在 ExamForge Compose 内部网络暴露，不映射宿主机端口 |
| 对外入口 | nginx 新增 server `examforge.<新子域名>`：`/` → 3000，`/api` → 3001；仅 80/443 对外 |
| TLS | 复用 Certbot，新增域名后 `certbot --nginx -d examforge.<域名>`，certbot.timer 自动续 |
| 镜像策略 | CI 产镜像推送私有 registry；服务器 `docker compose pull && up -d`；不在 4 G 内存主机上构建 |
| Postgres 数据卷 | bind 或 named volume 指向 /srv/data/hot/examforge/pgdata |
| Redis 持久化 | RDB/AOF 指向 /srv/data/hot/examforge/redis |
| Worker 并发 | **固定 1**（与其它站点共享 4 核） |
| Scheduler 资源 | 初始候选为 `cpus: 1.0-2.0`、内存 1-1.5 GB；不得在未运行 OR-Tools 真实基准前压缩到 256 MB |
| Postgres 资源 | `memory: 512m–768m`（建议 768m，并设 `shared_buffers=128MB`） |
| Redis 资源 | 初始候选为 128-256 MB；BullMQ 使用 `maxmemory-policy=noeviction`，并通过作业保留策略和监控控制增长，不使用 `allkeys-lru` 淘汰队列键 |
| Web 资源 | `memory: 256m–384m` |
| API 资源 | `memory: 256m–384m` |
| 日志驱动 | 所有 Compose 服务统一 `logging: driver: json-file, options: max-size: "10m", max-file: "3"` |
| 重启策略 | `restart: unless-stopped`（与现行风格一致） |
| Swap | 建议新增 2–4 GB `/swapfile` 作为极端峰值保护；swap 不替代正常内存预算，最终值由私有试部署确定 |
| 反向代理 | 复用现有 nginx；第五版不迁移 Caddy |
| 网络 | 单独 Compose network examforge_net，不与 trading-system_default 共享 |
| 默认 server | 建议 nginx default_server 对未知 Host 返回 444，降低扫描器噪声 |

## 9. 风险与待确认事项

### 9.1 已确认事实

1. `campus2hand.site` 证书已于 2026-07-13 过期，且此前续期 dry-run 已失败。这是现有站点的紧急运维事项，不是 ExamForge 当前实现阻塞；是否保留或修复该站点由用户决定。
2. 主机没有 swap，实际内存为 3.6 GiB。ExamForge 私有试部署必须记录关闭非必要交互进程后的基线和求解峰值，再确定容器限制；建议配置 2–4 GB swap 作为保护。
3. 现有 `trading-system` 容器日志没有尺寸上限。ExamForge 应显式设置 `json-file` 的 `max-size` 和 `max-file`。
4. 当前没有业务级自动备份。ExamForge 正式部署前需要 PostgreSQL 备份、独立存储复制和恢复演练。
5. nginx 默认上传限制可能不足。只有在 ExamForge 实际引入文件上传时，才需要按接口范围调整 `client_max_body_size`。
6. 20 GB 数据盘已与 openviking 共用，但当前占用很小。ExamForge 应使用独立子目录；COS 挂载不承载 PostgreSQL 或 Redis 在线数据。

### 9.2 待腾讯云控制台或人工确认

1. `campus2hand.site` HTTP-01 请求被 DNSPod `webblock.html` 截断的具体原因，包括备案、DNS 和接入状态。
2. ExamForge 候选域名的备案状态、解析权限和 HTTP-01 可达性。
3. 安全组实际放行端口、带宽、磁盘 IOPS 和云监控告警策略。
4. COS 桶已挂载到 `/srv/data/cos`；仍需确认权限、生命周期、容量和能否作为数据库备份的独立目标。
5. sudo 需要交互密码；nginx、Certbot、swap 和系统级目录的写操作需要用户授权并现场执行。

### 9.3 项目侧复核修正

1. BullMQ 使用的 Redis 必须设置 `maxmemory-policy=noeviction`，不能采用报告初稿中的 `allkeys-lru`。参见 [BullMQ Going to production](https://docs.bullmq.io/guide/going-to-production)。
2. scheduler 初始内存按 1-1.5 GB、CPU 按 1-2 核评估，随后用真实基准收敛；256 MB 不能作为未经验证的上限。
3. PostgreSQL 和 Redis 只在 Compose 内部网络暴露，不映射宿主机 5432/6379。
4. swap 是 OOM 峰值保护，不是部署可行性的替代证据。
5. 复用现有 nginx 是 ExamForge 项目基于服务器现状作出的设计选择，不是本报告对项目的强制要求。
6. 北京服务器访问广州 TCR registry 端点约为 0.12 秒，服务器侧只读登录准备正常。两次 GitHub 托管 Runner 正式发布均在跨境推送阶段未完成，不能据此归因于北京服务器访问 TCR；项目侧已决定保留 TCR，并将正式镜像构建与推送迁移到本地 WSL self-hosted Runner。详细边界见 `docs/design/第五版本地托管Runner发布设计.md`。

## 10. 后续需要用户确认的信息
- ExamForge 对外域名已确定为 `examforge.site`，根域名与 `www` 已解析；仍需等待备案通过并验证 HTTP-01 可达性。
- `campus2hand.site` 的备案、DNS 和接入状态。
- 是否同意在私有试部署前配置 2–4 GB swap，并以真实负载确定 Compose 内存上限。
- 是否允许你（或我提供命令后由你）执行：新增 nginx server、运行 certbot、配 nginx default_server return 444、调整 client_max_body_size。
- 镜像托管已选腾讯云 TCR 广州个人版，命名空间为 `examforge`；registry 网络与 `ubuntu` 用户登录准备已确认。GitHub 托管 Runner 跨境推送路径已停止使用，后续由本地 WSL Runner 发布正式镜像；仍需在取得完整 manifest 后验证服务器按 digest 只读拉取。
- vdb 已迁到共享挂载点 `/srv/data/hot`；ExamForge 使用 `/srv/data/hot/examforge`，与 OpenViking 子目录保持逻辑隔离。
- 是否需要配置自动备份（PG dump / 卷快照）的计划。
- 是否在安全组放行 ExamForge 对外端口（理论上只需 80/443，内部端口全经 nginx 转发可不开放）。
- ExamForge 项目已决定复用现有 nginx，不迁移 Caddy；仍需确认新增 server 配置和 reload 的执行权限。
- 维护窗口已定为备案通过后的第一个可用晚上 22:00–00:30（北京时间）；进入窗口时仍需用户最终确认开始，授权不得扩张到其他站点或全局服务。

## 11. 执行过的命令（只读，敏感脱敏）
普通用户只读：
```
id; hostname; hostnamectl; uname -m -r; uptime -s; uptime
lsb_release -a; cat /etc/os-release
lscpu; timedatectl; date
command -v codex; codex --version; ls -l $(command -v codex)
free -h; swapon --show; cat /proc/loadavg; nproc
ps -eo pid,user,%cpu,%mem,rss,comm --sort=-%cpu | head -n 11  （同时按 %mem）
ps -eo rss,user,comm --sort=-rss | head -6
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT
df -hT -x tmpfs -x devtmpfs; df -h /dev/vda2 /dev/vdb; df -i -x tmpfs -x devtmpfs
findmnt -t ext4,xfs,btrfs,overlay
docker version --format ...; docker compose version; docker info --format ...
docker ps -a --format ...; docker inspect trading-system --format '...labels...'
docker images; docker volume ls; docker network ls; docker system df
docker inspect trading-system --format '... NanoCpu ...' （报错：字段不存在）
sudo -n du -sh /var/lib/docker; du -sh /var/www /srv /opt /home --max-depth=1
ss -tulnp; ss -tlnp
find /var/www /srv /opt /home /root -maxdepth 4 \( -name compose*.yml -o -name Caddyfile -o -name nginx.conf \)
ls -l /etc/nginx/{sites-enabled,sites-available,conf.d}
git -C <dir> remote -v|rev-parse --abbrev-ref HEAD|rev-parse --short HEAD|status --porcelain
grep -E 'server_name|proxy_pass|root|listen|location' /etc/nginx/sites-available/* （脱敏）
cat /proc/<pid>/cmdline; ls -l /proc/<pid>/cwd
systemctl is-enabled|is-active nginx docker postgresql mysql mariadb redis redis-server
systemctl list-unit-files|list-timers; systemctl cat mycpu-frontend openviking devbrain-openviking-sync hermes-gateway
systemctl status hermes-gateway --no-pager
systemctl list-units --type=service --state=running | grep -iE 'postgres|mysql|mariadb|redis|caddy|apache'
crontab -l; ls -l /etc/cron.d /etc/cron.daily
mount|grep cosfs; df -h /srv/data/devbrain-lab/cos
getent hosts my-visual-cpu.site campus2hand.site
curl -s ifconfig.me （脱敏）
ls /srv/backups /srv/apps/* /srv/data/devbrain-lab/hot
```

sudo 只读（交互执行，见 sudo-readonly-commands.md）：
```
A. sudo ls -l /etc/letsencrypt/live/；for d in /etc/letsencrypt/live/*/; sudo openssl x509 ...  （glob 未展开，证书有效期未取到）
B. sudo grep -REhn 'ssl_certificate |listen |server_name |proxy_pass |root ' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
C. docker inspect trading-system --format '... NanoCpu ...'  （字段不存在，已知 RestartPolicy=unless-stopped，无 CPU/Mem 上限，LogDriver=json-file 无 max-size）
D. sudo journalctl --disk-usage；sudo journalctl -p err -b --since "7 days ago" --no-pager | tail -n 80  （主要是 sshd pam_qrlogin 失败）
E. sudo dmesg -T --level=err,crit,alert,emerg | tail -n 40  （无输出）
F. sudo du -sh /srv/backups/*；sudo ls -laR /srv/backups | head -n 80  （4 个备份目录均为空）
G. systemctl list-unit-files|list-timers --all
H. for u in root ubuntu; sudo crontab -u $u -l；sudo ls /etc/cron.d /etc/cron.{hourly,daily,weekly,monthlyly}; sudo cat /etc/cron.d/*  （脱敏）
I. sudo du -sh /usr/local/qcloud ...；sudo ls -la /usr/local/qcloud | head  （7 M）
J. sudo tail /srv/apps/trading-system/logs/*.log; /srv/apps/my_visual_CPU/logs/*.log; sudo journalctl -u mycpu-frontend -u openviking -u hermes-gateway -p err --since "7 days ago"
K. systemctl list-units --type=service --state=running | grep -iE 'postgres|mysql|mariadb|redis|caddy|apache'; lsmod | grep ... （无）
L. sudo dumpe2fs -h /dev/vda2|/dev/vdb; mount | grep vda2|vdb
M. systemctl is-enabled unattended-upgrades; sudo cat /etc/apt/apt.conf.d/20auto-upgrades
N. ps -o pid,user,%cpu,%mem,rss,cmd -C nginx; sudo ss -tan state established '( sport = :443 or sport = :80 )' | wc -l
```

已补充（sudo 手工执行，结果见 A2）：
```
sudo openssl x509 -in /etc/letsencrypt/live/campus2hand.site/cert.pem  -noout -subject -dates -issuer
  subject=CN=campus2hand.site  notBefore=Apr 14 07:44:41 2026 GMT  notAfter=Jul 13 07:44:40 2026 GMT  issuer=Let's Encrypt R13
sudo openssl x509 -in /etc/letsencrypt/live/my-visual-cpu.site/cert.pem -noout -subject -dates -issuer
  subject=CN=my-visual-cpu.site   notBefore=Jul  1 18:22:41 2026 GMT  notAfter=Sep 29 18:22:40 2026 GMT  issuer=Let's Encrypt YR1
```

注：未读取 .env、私钥、Codex 凭据、容器完整环境变量、/etc/shadow 等敏感文件；sudo 全程只读。
