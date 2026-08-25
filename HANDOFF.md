# 龙华区观澜中学校园墙——项目交接文档

> - 最后更新：2026-08-25
> - 适用分支：`main`
> - 代码仓库：<https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan>
> - 学校名称：龙华区观澜中学

本文档用于开发、审核、运维和应急接管。它说明当前产品规则、代码结构、账号权限、审核流程、数据位置、本地运行、生产部署、备份恢复和常见故障。功能细节以 `main` 分支代码为最终事实来源；本文件应在每次改变架构、权限、数据结构或部署方式时同步更新。

## 1. 交接原则与敏感信息

以下信息绝不能写入 Git、工单、截图或公开聊天：

- SSH 密码、私钥和宝塔面板密码；
- `SECRET_KEY`、数据库密码、Cookie 或会话值；
- 飞书/企业微信群机器人 Webhook 与签名 Secret；
- 学生个人信息、未公开内容、举报/反馈正文和生产日志原文；
- 生产数据库、头像和上传文件的未加密备份。

服务器地址、账号、密码和第三方机器人密钥应通过独立密码管理器交接。仓库只保留变量名、路径、操作命令和脱敏示例。发现凭据曾被提交到 Git 时，不能只删除文件，必须立即轮换该凭据并检查历史记录。

## 2. 当前环境与来源

| 环境 | 位置 | 用途 |
| --- | --- | --- |
| 本机工作区 | `C:\Users\zongt\Documents\campuswall-react` | 开发、测试、构建与提交 |
| GitHub | `ZONGRUICHD/Campus-Wall-For-GuanLan` 的 `main` | 唯一代码交付分支 |
| 生产项目目录 | `/www/wwwroot/campuswall-react` | 服务器当前检出的代码 |
| 前端静态目录 | `/www/wwwroot/campuswall-react/frontend/dist` | Nginx 对外托管的构建产物 |
| 后端工作目录 | `/www/wwwroot/campuswall-react/backend` | Node/Express 服务工作目录 |
| 后端环境文件 | `/etc/campuswall/backend.env` | 生产变量与密钥，权限必须为 `root:root 600` |
| systemd 服务 | `campuswall.service` | 后端常驻与自动重启 |
| 后端监听 | `127.0.0.1:5412` | 只允许 Nginx/本机访问 |
| PostgreSQL 数据库 | `campus_wall` | 账号、留言、权限、通知、审计等结构化数据 |
| 生产备份根目录 | `/www/backups/campuswall` | 每次上线前和定期备份 |

当前公开访问入口由 Nginx 站点配置决定。仓库内的 `deploy/nginx-campuswall.conf` 是参考基线，生产实际配置修改后必须同步回仓库。公网只应开放 `80/443`，不要公开 `5412/5432`。

## 3. 系统架构

请求链路：

```text
浏览器
  ├─ 页面、/assets/* ───────────────> Nginx ──> frontend/dist
  ├─ /api/*、/health ──────────────> Nginx ──> Node/Express :5412
  └─ 受保护的上传/缩略图资源 ───────> Nginx ──> Node/Express 鉴权
                                                     ├─ PostgreSQL
                                                     ├─ backend/static
                                                     ├─ backend/help、backend/logs
                                                     └─ 飞书/企业微信机器人（可选）
```

生产环境中 Nginx 直接托管前端构建产物，并把 API 与受保护静态资源反向代理给后端。不要用 Nginx `root`/`alias` 直接公开 `backend/static/uploads` 或 `backend/static/tiny_files`，否则会绕过待审核附件和失物招领登录保护。

后端当前按**单实例进程**设计：`MessageStore` 会把消息与分区载入进程内缓存，并使用进程内锁。不要未经架构改造就启用 PM2 cluster、多个 systemd 实例或横向多副本，否则不同进程的缓存可能短暂不一致。正式环境的单个 `campuswall.service` 实例符合当前模型。

## 4. 技术栈

- 前端：React 19、React Router 7、Vite 8、Tailwind CSS 4、Three.js、Bootstrap Icons、DOMPurify；
- 后端：Node.js 20+、Express 4、`pg`、`multer`、`sharp`、`cookie-parser`、`compression`、`express-rate-limit`；
- 数据库：PostgreSQL 18；
- 媒体处理：图片由 Sharp 处理，视频依赖系统 `ffmpeg`；
- 生产代理：Nginx；
- 进程管理：systemd 的 `campuswall.service`；
- 密码与会话：Node `crypto.scrypt` 密码哈希、HMAC 签名 Cookie、`session_version` 会话失效机制。

## 5. 仓库结构

```text
campuswall-react/
├── frontend/
│   ├── src/App.jsx                 # 路由与前端权限守卫
│   ├── src/components/Layout.jsx   # 前台桌面/手机顶部与底部导航
│   ├── src/components/AdminShell.jsx
│   ├── src/contexts/               # 用户、平台、提示状态
│   ├── src/pages/                  # 前台页面
│   ├── src/pages/admin/            # 后台页面
│   └── dist/                       # 构建产物，不作为源码手改
├── backend/
│   ├── src/server.js               # 服务入口、中间件、路由挂载与清理任务
│   ├── src/config.js               # 环境变量解析与生产安全检查
│   ├── src/routes/                 # public/wall/users/admin/upload/staticFiles
│   ├── src/services/               # 数据、认证、权限、通知和媒体处理
│   ├── scripts/                    # 数据迁移、数据库等待、管理员恢复
│   ├── test/                       # Node 内置测试
│   ├── static/                     # 上传、缩略图、头像等运行数据
│   ├── help/                       # 反馈/举报兼容运行数据
│   └── logs/                       # 后端错误日志
├── deploy/
│   ├── campuswall.service          # systemd 基线
│   ├── nginx-campuswall.conf       # Nginx 基线
│   └── prepare-runtime.sh          # 运行账号、Node 路径、数据目录准备
├── compose.yml                     # 仅供本地 PostgreSQL
├── README.md                       # 产品与开发总览
├── README_BAOTA_DEPLOY.md          # 宝塔部署教程
├── SECURITY.md                     # 漏洞报告与敏感数据规则
└── HANDOFF.md                      # 本交接文档
```

`artifacts/` 是本机辅助产物，不属于项目交付内容，除非经过人工确认，否则不要提交。

## 6. 产品功能与重要边界

- 游客可以匿名发布普通校园墙内容，无需学号验证；
- 用户可用任意合规用户名与密码注册；
- 所有新帖子都先进入统一待审核队列，审核通过前不公开；
- 表白墙使用 Three.js 粉色爱心场景，爱心粒子以便签形式呈现；
- 首页持续展示最新校园公告；审核员、管理员和超级管理员均可发布、编辑或收回；
- 失物招领必须登录后才能查看和发布，仍走统一审核流程；
- 登录用户可维护昵称、头像、简介，查看自己的帖子、评论、收藏和通知；
- 管理角色也能发帖；所有审核员可审核全局队列中的全部内容，包括自己提交的帖子；
- 反馈与举报只在后台处理，前台不提供公开进度查询。

## 7. 统一账号、角色与权限

PostgreSQL `users` 表是普通登录和后台登录的唯一账号源。旧 `backend/managers.json` 只作为一次性迁移输入，不再是运行时权限数据库。

| 角色 | 前台功能 | 后台入口 | 权限边界 |
| --- | --- | --- | --- |
| `user` | 注册用户功能 | 无 | 不能审核、管理或分配角色 |
| `reviewer` | 可正常发帖 | 有，顶部导航直接显示 | 所有审核员完全相同；可审核统一队列中的全部内容并管理主页公告；不能管理用户、设置或角色 |
| `admin` | 可正常发帖 | 有 | 内容、用户状态、公告、反馈、举报、日志和设置管理；不能分配角色 |
| `super_admin` | 可正常发帖 | 有 | 全部权限，包括把用户设为 `user/reviewer/admin/super_admin` |

权限规则：

1. 审核员不存在分组、负责范围、单独授权或上下级关系；新增审核员自动获得与现有审核员完全相同的审核权限。
2. 审核队列是全局队列，不按审核员、作者、标签、普通动态、表白或失物招领拆分访问权限。
3. `reviewer` 可以审核全部待审帖子，包括自己提交的内容；该口径对单条和批量审核一致，操作仍写入审计。
4. `admin` 不等于 `super_admin`；只有超级管理员能改变角色。
5. 系统禁止修改自己的角色，并保证至少保留一个启用的超级管理员。
6. 角色改变、停用、改密和重置密码会递增 `session_version`，旧前台/后台会话立即失效。
7. 前端隐藏菜单只是界面优化；真正的权限边界必须由后端接口再次检查。

后台入口：审核员、管理员、超级管理员登录后，前台顶部导航直接显示后台入口；普通用户和游客不显示。直接访问 `/admin` 仍会执行后端会话和权限校验。

## 8. 发帖与审核流程

```text
游客/用户/审核员/管理员提交
           ↓
moderation_status=pending
review_status=pending
           ↓
写入 PostgreSQL，并按配置写入审核通知 outbox
           ↓
所有审核员看到同一个待审队列
           ├─ 通过 → visible + approved → 公开列表/详情/搜索/分区可见
           └─ 退回/拒绝 → 保持非公开并记录理由/审计
```

必须保持的不变量：

- 新帖子不能绕过 `pending` 状态；
- 待审核、已下架、已删除内容不能从公开列表、详情、热门、分区、收藏或互动接口泄漏；
- 待审核附件也不能通过猜测文件名访问；
- 单条审核和批量审核都必须使用相同的全局审核权限，不得因发布者或内容类别缩小某位审核员的范围；
- 审核结果必须记录操作账号与时间，以便在允许审核自己内容的前提下保留追溯能力；
- 失物招领、表白等类别仍属于统一待审内容，不能形成审核盲区；
- 审核和管理写操作要进入结构化审计记录。

评论当前属于发布后管理对象，管理员可隐藏、恢复或移入回收站；若未来增加“评论先审后发”，必须同步扩展数据状态、公开过滤、审核队列、通知和测试，不能只增加一个前端按钮。

## 9. 审核消息提醒

后端支持飞书自定义群机器人和企业微信群机器人，可单独或同时启用。帖子首次提交、编辑后重新送审、退回待审时，系统先将任务写入 PostgreSQL `moderation_notification_outbox`，再由后台 worker 异步发送。

设计约束：

- 通知失败不能阻塞用户发帖；
- 临时网络错误按指数退避重试；
- 多条内容会合并摘要，并有最小发送间隔，避免刷屏；
- 首次启用时历史积压只汇总提醒；
- 机器人消息不发送正文、发布者身份、联系方式或附件地址；
- Webhook 仅允许官方 HTTPS 域名，禁止重定向；
- 后台深链仅在 `PUBLIC_SITE_URL` 为 HTTPS 时加入消息。

关键变量：

```env
PUBLIC_SITE_URL=https://wall.example.com
MODERATION_NOTIFY_ENABLED=true
MODERATION_NOTIFY_FEISHU_WEBHOOK=
MODERATION_NOTIFY_FEISHU_SECRET=
MODERATION_NOTIFY_WECOM_WEBHOOK=
MODERATION_NOTIFY_TIMEOUT_MS=5000
MODERATION_NOTIFY_MAX_ATTEMPTS=6
MODERATION_NOTIFY_POLL_MS=2000
MODERATION_NOTIFY_COALESCE_MS=5000
MODERATION_NOTIFY_MIN_INTERVAL_MS=30000
MODERATION_NOTIFY_BATCH_SIZE=50
MODERATION_NOTIFY_RETENTION_DAYS=30
```

启用后重启服务，并通过 `journalctl` 确认出现启用目标和投递结果。不要在命令行历史中直接粘贴 Webhook；优先编辑权限为 `600` 的环境文件。

## 10. 头像上传链路

头像上传接口为 `POST /api/user/me/avatar`，必须登录并通过可信来源校验。当前规则：

- 最大上传体积默认 5 MiB；
- 只接受实际可解码的 JPEG、PNG、WebP、GIF；扩展名和请求 MIME 不能代替内容验证；
- 自动应用 EXIF 方向后，以图片中心裁剪为正方形；
- 最大输出边长默认 512，不放大较小原图；
- 统一转为静态 WebP，默认质量 82；动画 GIF 只取第一帧；
- 默认移除 EXIF/GPS 等元数据；
- 透明图片保留透明通道；
- 限制输入像素数和 Sharp 同时处理数量，降低图片炸弹与内存峰值风险；
- 先写唯一临时文件，再原子替换；数据库更新失败时删除候选文件；
- 替换成功后只删除已无用户引用的旧头像；
- 前端选择文件后显示圆形居中裁剪预览和明确错误提示。

关键变量：

```env
MAX_AVATAR_SIZE=5242880
AVATAR_OUTPUT_SIZE=512
AVATAR_WEBP_QUALITY=82
MAX_AVATAR_INPUT_PIXELS=40000000
MAX_CONCURRENT_AVATAR_PROCESSING=2
```

## 11. PostgreSQL 数据与运行文件

主要表：

- `users`：账号、密码哈希、角色、状态、头像文件名、会话版本；
- `legacy_manager_migrations`：旧后台账号一次性迁移记录；
- `messages`：留言主体及 JSONB 数据；
- `partitions`：标签/分区与留言关系；
- `message_reactions`、`poll_votes`：互动与投票去重；
- `user_favorites`、`user_notifications`：收藏和站内通知；
- `platform_settings`：社区与验证码设置；
- `admin_audit_events`：后台结构化审计；
- `moderation_notification_outbox`：审核群机器人持久投递队列。

运行文件：

- `backend/static/uploads`：原始上传；
- `backend/static/tiny_files`：缩略图；
- `backend/static/avatars`：处理后的 WebP 头像；
- `backend/static/chunks`：上传分片，可清理但会中断正在上传的任务；
- `backend/static/apps/icons`：兼容运行图标；
- `backend/static/notice.json`、`backend/help/*.json`、`backend/manage_message.json`、`backend/admin_log.json`：兼容运行数据；
- `backend/logs/info.log`：后端错误日志。

后端每 15 分钟清理一次超期未引用上传和分片。头像目前在正常替换时清理旧文件；若进程在文件写入与数据库提交之间被强制终止，极少数孤儿头像需由后续维护任务或人工审计处理。

## 12. 环境变量分组

完整默认值见 `backend/.env.example`，生产以 `/etc/campuswall/backend.env` 为准。

基础与数据库：

```env
NODE_ENV=production
SCHOOL_NAME=龙华区观澜中学
SITE_NAME=龙华区观澜中学校园墙
APP_NAME=龙华区观澜中学校园墙 API
SECRET_KEY=<至少 32 字节随机值>
HOST=127.0.0.1
PORT=5412
DATABASE_URL=
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=campus_wall
PGUSER=campus_wall
PGPASSWORD=<强密码>
PGSSL=false
```

来源、Cookie 与验证码：

```env
ALLOWED_ORIGINS=https://wall.example.com
SESSION_COOKIE_SAMESITE=Lax
SESSION_COOKIE_SECURE=true
SESSION_MAX_AGE=604800
CAPTCHA_PROVIDER=none
CAPTCHA_ENABLED=false
CAPTCHA_SITE_KEY=
CAPTCHA_SECRET_KEY=
```

上传与磁盘保护：

```env
MAX_CONTENT_LENGTH=104857600
MAX_CHUNK_SIZE=10485760
MAX_UPLOAD_STORAGE_BYTES=8589934592
MIN_FREE_DISK_BYTES=8589934592
RATE_LIMIT_UPLOAD_BYTES=268435456
MAX_CONCURRENT_UPLOADS_PER_IP=3
MAX_CONCURRENT_UPLOADS_GLOBAL=24
PENDING_ATTACHMENT_RETENTION_MS=172800000
UNREFERENCED_UPLOAD_RETENTION_MS=7200000
FFMPEG_TIMEOUT_MS=120000
```

生产启动会拒绝默认 `SECRET_KEY` 和默认开发数据库密码。修改环境变量后必须重启 `campuswall.service`。

前端构建变量见 `frontend/.env.example`：`VITE_API_BASE_URL`、`VITE_STATIC_URL` 和 `VITE_APP_ENV`。`frontend/src/main.jsx` 当前在生产构建中加载 Umami，并在未配置时使用代码内网站 ID；这会产生第三方分析请求。学校正式接管前应完成隐私评审，如不需要统计，应改为显式开关并停止加载，而不是只把变量留空。

## 13. 本地开发

前置条件：Node.js 20+、npm、可用的 PostgreSQL 18、Docker Desktop（使用 `compose.yml` 时）和系统 `ffmpeg`。

首次运行：

```powershell
cd C:\Users\zongt\Documents\campuswall-react
npm install
npm run db:up
npm run db:wait
npm run db:migrate
npm run dev
```

常规本地运行：

```powershell
npm run dev:local
```

前端开发端口已在 `frontend/vite.config.js` 固定为 1145。分别启动时：

```powershell
npm run dev:backend
# 另一个终端
npm run dev:frontend
```

地址：

- 前端：`http://localhost:1145/`；
- 后端健康检查：`http://127.0.0.1:5412/health`；
- Vite 默认端口：`1145`。如需临时覆盖，使用 `npm --workspace frontend run dev -- --port <端口>`。

旧 SQLite 迁移只在首次接入旧数据时运行一次，不应在日常启动或每次上线时重复执行。

## 14. 测试与发布门槛

每次提交前至少执行：

```powershell
npm --workspace backend test
npm --workspace backend run check
npm run build
git diff --check
```

还应人工验证：

1. 游客首页、动态、表白墙、话题和帮助可访问；
2. 游客发布普通内容后只进入待审，不在公开列表出现；
3. 任意用户名注册与登录正常；
4. 失物招领未登录会跳转登录，登录后可用；
5. 四种角色的导航和后端权限一致；
6. 任意审核员能看到并处理全部待审类别，包括其他人和自己提交的内容；
7. 单条审核和批量审核均不因发布者身份产生额外限制，且审计记录完整；
8. 超级管理员能分配角色，审核员和管理员不能；
9. 头像横图、竖图、透明 PNG、带方向信息图片均输出方形 WebP；
10. 桌面和手机导航、模态框、表单及页面切换动效正常；
11. 浏览器控制台无新增 warning/error，页面无 Vite 错误遮罩。

前端构建可能出现 Three.js 表白墙分包体积提示；这不是构建失败，但若体积继续增长应考虑路由懒加载和显式 chunk 拆分。

## 15. Git 工作流

1. 从最新 `schoolrepo/main` 开发；
2. 功能分支建议使用 `codex/<主题>`；
3. 提交前确认 `git status --short`，不要加入数据库、上传文件、`.env`、日志、备份或 `artifacts/`；
4. 测试通过后将目标提交推送到 GitHub `main`；
5. 生产服务器只部署 GitHub `main` 的已确认提交；
6. 记录上线前提交、上线后提交、备份目录和验证结果。

常用核对：

```powershell
git fetch schoolrepo main
git log --oneline --decorate -5
git status --short
git diff --check
```

## 16. 生产部署标准流程

生产服务采用 systemd，不能使用 Vite、nodemon 或 `npm run dev`。

### 16.1 上线前检查

```bash
cd /www/wwwroot/campuswall-react
git status --short
git rev-parse HEAD
systemctl is-active campuswall.service
curl -fsS http://127.0.0.1:5412/health
df -h /www/wwwroot /www/backups
```

工作树不干净时先识别文件所有者和用途，不要直接 `git reset --hard` 或删除运行数据。

### 16.2 建立上线备份

```bash
stamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="/www/backups/campuswall/${stamp}-before-deploy"
install -d -m 0700 "$backup_dir"
git rev-parse HEAD > "$backup_dir/previous-commit.txt"
sudo -u postgres pg_dump -Fc campus_wall > "$backup_dir/campus_wall.dump"
install -m 0600 /etc/campuswall/backend.env "$backup_dir/backend.env"
tar -C /www/wwwroot/campuswall-react -czf "$backup_dir/runtime-files.tar.gz" \
  backend/static backend/help backend/logs \
  backend/admin_log.json backend/manage_message.json frontend/dist
```

备份包含敏感数据，目录必须仅 root 可读，并应定期复制到加密的异机存储。

### 16.3 更新、测试与构建

```bash
cd /www/wwwroot/campuswall-react
git remote -v
git fetch origin main
git merge --ff-only origin/main
npm ci
npm --workspace backend test
npm --workspace backend run check
```

为降低半构建状态风险，先构建到独立目录：

```bash
stamp="$(date +%Y%m%d-%H%M%S)"
deploy_dist="frontend/dist.deploy-${stamp}"
npm --workspace frontend run build -- --outDir "dist.deploy-${stamp}"
test -f "$deploy_dist/index.html"
```

若依赖未变化可省略 `npm ci`，但修改 `package.json`/`package-lock.json`、Node 版本或原生模块时必须重新安装并验证。

### 16.4 原子切换与重启

```bash
nginx -t
mv frontend/dist "$backup_dir/frontend-dist.previous"
mv "$deploy_dist" frontend/dist
systemctl restart campuswall.service
systemctl is-active campuswall.service
curl -fsS http://127.0.0.1:5412/health
curl -fsSI http://127.0.0.1/
```

随后检查：

```bash
journalctl -u campuswall.service --since "5 minutes ago" --no-pager
git rev-parse HEAD
git status --short
```

最后从公网检查首页、`/health`、登录、后台入口和一个深链接刷新。只有代码、服务、页面和日志均正常才算上线完成。

## 17. 回滚

### 17.1 仅前端异常

```bash
cd /www/wwwroot/campuswall-react
mv frontend/dist "frontend/dist.failed-$(date +%Y%m%d-%H%M%S)"
mv "$backup_dir/frontend-dist.previous" frontend/dist
nginx -t && systemctl reload nginx
```

### 17.2 后端代码异常

先读取 `$backup_dir/previous-commit.txt`，确认目标提交后再创建回滚分支或部署该提交。不要用 `git reset --hard` 覆盖不明运行文件。推荐在本地对错误提交做 `git revert`，测试后推送 `main`，再按标准流程部署。

紧急情况下可在生产目录检出已确认提交并重启：

```bash
previous_commit="$(cat "$backup_dir/previous-commit.txt")"
git switch --detach "$previous_commit"
systemctl restart campuswall.service
curl -fsS http://127.0.0.1:5412/health
```

恢复服务后应尽快通过正常 Git 提交让生产重新回到 `main`，避免长期处于 detached HEAD。

### 17.3 数据异常

数据恢复会覆盖或合并生产数据，执行前必须停写、再做一次现状备份，并确认恢复时间点。自定义格式备份示例：

```bash
systemctl stop campuswall.service
sudo -u postgres pg_dump -Fc campus_wall > /www/backups/campuswall/pre-restore-$(date +%Y%m%d-%H%M%S).dump
sudo -u postgres pg_restore --clean --if-exists --no-owner -d campus_wall "$backup_dir/campus_wall.dump"
systemctl start campuswall.service
curl -fsS http://127.0.0.1:5412/health
```

不要在没有确认的情况下恢复数据库或覆盖上传目录。

## 18. 备份与恢复策略

最低备份集合：

- PostgreSQL `campus_wall`；
- `backend/static/uploads`；
- `backend/static/tiny_files`；
- `backend/static/avatars`；
- `backend/static/apps/icons`；
- `backend/static/notice.json`；
- `backend/help/*.json`；
- `backend/admin_log.json`、`backend/manage_message.json`；
- `/etc/campuswall/backend.env`；
- 当前 Git 提交号与 Nginx/systemd 实际配置。

建议周期：数据库每日、运行文件每日增量/每周完整、每次上线前完整备份。至少保留一个异机加密副本，并定期做恢复演练；只有成功恢复过的备份才可信。

不要把 `backend/static/chunks` 作为必要备份；它是临时分片。不要从 GitHub 恢复数据库、头像、上传、举报、反馈或日志，因为这些数据本来就不在仓库中。

## 19. 账号与日常运营

### 19.1 创建或恢复最高管理员

在服务器项目根目录执行：

```bash
npm run admin:reset-password -- <用户名>
```

命令在终端交互读取新密码，可启用现有账号或创建恢复用超级管理员。不要把密码放在命令参数、脚本或文档中。

### 19.2 分配角色

超级管理员登录后从顶部后台入口进入“用户与权限”，选择用户并设置角色。审核员不能添加审核员，也不能修改任何人的角色；管理员同样不能分配角色。

### 19.3 审核员操作

审核员登录前台账号后：

1. 顶部导航出现后台入口；
2. 进入统一帖子审核队列；
3. 可查看所有待审类别，不需要手工输入 `/admin`；
4. 查看清晰的内容、附件、标签、投票、提交时间和审核状态；
5. 通过或退回其他人提交的内容；
6. 可处理自己发布的内容；系统仍记录审核账号、时间和结果；
7. 可从后台侧栏进入“公告管理”，发布、编辑或收回主页公告。

审核员除帖子审核与公告管理外，不应看见用户与权限、设置、举报、反馈、日志或回收站等管理模块。

## 20. 监控与日志

常用命令：

```bash
systemctl status campuswall.service --no-pager
journalctl -u campuswall.service -n 200 --no-pager
journalctl -u campuswall.service --since "1 hour ago" --no-pager
curl -fsS http://127.0.0.1:5412/health
nginx -t
tail -n 200 /www/wwwlogs/campuswall-error.log
tail -n 200 /www/wwwlogs/campuswall-access.log
df -h
free -h
sudo -u postgres psql -d campus_wall -c "SELECT 1;"
```

重点告警信号：

- systemd 反复重启或健康检查失败；
- PostgreSQL 连接失败、磁盘空间接近下限；
- 头像/上传频繁返回 429、400 或 Sharp 解码错误；
- 审核通知 outbox 大量重试或持续失败；
- Nginx 502、请求体过大或深链接 404；
- 待审内容出现在公开接口；
- 最后一位超级管理员被停用或没有可登录的审核员。

日志、数据库查询结果和截图可能含用户信息，对外分享前必须脱敏。

## 21. 常见故障

### 页面刷新后 404

确认 Nginx `location /` 使用 `try_files $uri $uri/ /index.html;`，并确认根目录指向 `frontend/dist`。

### API 502

依次检查 `campuswall.service`、`127.0.0.1:5412/health`、systemd 日志和 Nginx `proxy_pass`。

### 登录后刷新变成未登录

检查站点是否 HTTPS、`SESSION_COOKIE_SECURE`、`SESSION_COOKIE_SAMESITE`、`ALLOWED_ORIGINS`、反代的 `X-Forwarded-Proto` 和浏览器 Cookie。

### 登录时报 `Invalid request origin`

将实际前端来源（协议、域名、端口必须完全一致）加入 `ALLOWED_ORIGINS`，重启后端。不要用 `*` 配合凭据请求。

### 上传失败或 Nginx 413

同时检查 Nginx `client_max_body_size`、后端大小限制、磁盘总量/剩余空间限制、上传次数/字节/并发限流和目录权限。

### Sharp 在 Linux 启动失败

使用 Node 20/22 LTS，在服务器目标系统重新执行 `npm ci`，不要复制 Windows `node_modules`。确认 `sharp` 原生依赖与服务器架构匹配。

### 头像仍显示旧图

接口使用重新验证缓存。先确认用户记录中的 `avatar_file` 已更新、文件存在于 `backend/static/avatars`，再检查浏览器请求是否返回新 ETag/内容；不要通过永久 immutable 规则缓存头像接口。

### 审核员看不到后台入口

确认用户角色确实为 `reviewer`、账号状态启用、重新登录后 `user_session` 已刷新；再检查 `/api/user/session` 返回的角色和前端 `Layout.jsx` 条件。即使前端入口异常，后端仍必须拒绝普通用户访问后台。

### 审核通知没有发送

确认 `MODERATION_NOTIFY_ENABLED=true`、至少一个合法 Webhook、服务器可访问机器人域名、systemd 已重启。查看日志和 `moderation_notification_outbox` 状态；不要通过关闭审核或在发帖请求中同步调用 Webhook 来“修复”。

## 22. 安全检查表

- [ ] 生产 `SECRET_KEY` 与数据库密码不是示例值；
- [ ] `/etc/campuswall/backend.env` 为 `root:root 600`；
- [ ] Git 中不存在 `.env`、数据库、上传、头像、日志或备份；
- [ ] `ALLOWED_ORIGINS` 只包含真实来源；
- [ ] HTTPS 下启用 `SESSION_COOKIE_SECURE=true`；
- [ ] PostgreSQL 和 Node 后端端口未向公网开放；
- [ ] Nginx 未直接公开受保护运行目录；
- [ ] 所有写接口均有来源校验、鉴权或对应限流；
- [ ] 后端再次验证角色与权限，不能仅依赖前端隐藏；
- [ ] 所有新帖子固定进入待审，所有审核员对全局队列完全同权；
- [ ] 上传同时受类型、大小、字节、并发、磁盘和路径限制；
- [ ] 机器人 Webhook 不在前端或日志中泄露；
- [ ] 备份已加密、可恢复且存在异机副本。

## 23. 已知限制与后续建议

- 生产站应尽快绑定正式域名并启用 HTTPS，之后开启安全 Cookie；
- 生产分析脚本目前会连接 Umami；在面向未成年学生正式开放前，应确认学校的隐私告知、数据范围与是否继续启用；
- 机器人提醒需要学校自行创建飞书或企业微信群机器人并在服务器注入密钥；
- Three.js 表白墙构建分包较大，后续可继续优化加载体积；
- 可增加定期扫描无数据库引用头像的维护任务，处理进程崩溃留下的极少量孤儿文件；
- 评论当前是发布后管理，不是先审后发；如学校要求评论也先审，需按第 8 节完整扩展；
- 应为备份增加自动化、保留策略、异机复制和恢复演练记录；
- 应增加 HTTPS、外部可用性、磁盘、数据库和 outbox 积压监控。

## 24. 最终交接清单

- [ ] 接手人已获得 GitHub 仓库权限；
- [ ] 接手人已通过密码管理器获得服务器/宝塔凭据；
- [ ] 接手人知道生产目录、systemd 服务和环境文件位置；
- [ ] 接手人能在本地 1145 端口启动前端并运行后端测试；
- [ ] 接手人能完成一次无变更构建和健康检查；
- [ ] 接手人理解四种角色及“所有审核员完全同权”的规则；
- [ ] 接手人能从顶部导航进入审核后台并处理统一队列；
- [ ] 接手人能创建上线前备份、部署、验证和回滚；
- [ ] 接手人已做一次数据库和运行文件恢复演练；
- [ ] 接手人知道如何轮换管理员密码、数据库密码、`SECRET_KEY` 与机器人密钥；
- [ ] GitHub、本机和生产服务器上的 `HANDOFF.md` 来自同一 `main` 提交。
