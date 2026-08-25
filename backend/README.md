# 龙华区观澜中学校园墙 Node/Express 后端

这是校园墙的 Node.js + Express API。PostgreSQL 18 是账号、权限、留言与结构化审计的运行时数据源。

项目仓库：[ZONGRUICHD/Campus-Wall-For-GuanLan](https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan)

## 运行

从仓库根目录首次启动本地开发环境：

```bash
npm install
npm run db:up
npm run db:wait
npm run db:migrate
npm run dev
```

仅启动后端：

```bash
npm --workspace backend run dev
```

生产方式：

```bash
npm --workspace backend start
```

默认监听 `http://localhost:5412`，健康检查为 `GET /health`。

## 技术栈

- Node.js 20+ 与 Express
- PostgreSQL 18 与 `pg`
- `multer`、`sharp` 与系统 `ffmpeg`
- `cookie-parser`、`compression`、`express-rate-limit`
- Node `crypto.scrypt` 密码哈希与 HMAC 签名会话

## 环境变量

完整默认值见 `backend/.env.example`。生产环境至少配置：

```bash
NODE_ENV=production
SECRET_KEY=replace-with-a-long-random-secret
DATABASE_URL=
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=campus_wall
PGUSER=campus_wall
PGPASSWORD=replace-with-your-production-db-password
PGSSL=false
ALLOWED_ORIGINS=https://your-domain.example
SESSION_COOKIE_SECURE=true
CAPTCHA_PROVIDER=none
CAPTCHA_ENABLED=false
CAPTCHA_SITE_KEY=
CAPTCHA_SECRET_KEY=
RATE_LIMIT_LOGIN=30
RATE_LIMIT_REGISTER=10
RATE_LIMIT_WRITE=40
RATE_LIMIT_INTERACTION=240
RATE_LIMIT_UPLOAD=240
```

`NODE_ENV=production` 时，默认密钥或默认开发数据库密码会导致进程拒绝启动。设置 `DATABASE_URL` 后会优先使用连接串。

### 审核群机器人提醒

审核提醒支持飞书自定义群机器人和企业微信群机器人，可单独启用，也可同时推送。游客/普通 `user` 的普通校园动态或表白便签初次进入待审，或任意内容被管理端明确退回待审时，系统会先在 PostgreSQL 的 `moderation_notification_outbox` 持久记录事件，再由后台 worker 异步发送；管理角色普通动态/表白便签和登录用户失物招领的初次免审发布不写审核 outbox。超时、限流或临时网络错误不会阻塞发帖，并会指数退避重试。单条或同一类别的摘要会深链到 `/admin/wall` 或 `/admin/confessions`，同时包含两类内容的混合摘要进入 `/admin` 仪表盘。

生产服务器的环境文件可配置：

```bash
PUBLIC_SITE_URL=https://wall.example.com
MODERATION_NOTIFY_ENABLED=true

# 飞书：Webhook 必须属于 open.feishu.cn/open.larksuite.com；启用签名校验时填写 Secret。
MODERATION_NOTIFY_FEISHU_WEBHOOK=
MODERATION_NOTIFY_FEISHU_SECRET=

# 企业微信：Webhook 必须属于 qyapi.weixin.qq.com。
MODERATION_NOTIFY_WECOM_WEBHOOK=

MODERATION_NOTIFY_TIMEOUT_MS=5000
MODERATION_NOTIFY_MAX_ATTEMPTS=6
MODERATION_NOTIFY_POLL_MS=2000
MODERATION_NOTIFY_COALESCE_MS=5000
MODERATION_NOTIFY_MIN_INTERVAL_MS=30000
MODERATION_NOTIFY_BATCH_SIZE=50
MODERATION_NOTIFY_RETENTION_DAYS=30
```

完整 Webhook URL 与飞书签名 Secret 都属于密钥，只能放在服务器环境变量，不能提交到 Git、写进前端或贴到公开群。通知只发送帖子编号、系统判定的内容类型、附件/投票情况、提交时间、全站待审数量和审核后台链接；不会外发正文、用户填写的标签、发布者身份、联系方式或附件地址。“全站当前待审”是两个展示队列的合计，不应与目标页面的单队列数量混淆。Webhook 采用 HTTPS 精确域名与路径白名单，禁止跳转。短时间内出现多条内容会合并为一条群摘要，同一机器人默认每 30 秒最多发送一条；首次启用时，已有待审积压只发送一条摘要，避免匿名刷帖造成通知轰炸。

审核后台深链只允许 HTTPS；`http://localhost` 和 `http://127.0.0.1` 仅用于本地开发。生产站未启用 HTTPS 时机器人仍会提醒，但不会附加登录按钮。单类深链必须保留 `status=pending`，单条消息还会带 `message=:id`；混合摘要不附单队列筛选，直接进入仪表盘。

## PostgreSQL 数据模型

主要表：

- `users`：统一账号源，保存 `username`、规范化唯一键 `username_key`、密码哈希、状态、`role` 与 `session_version`。
- `legacy_manager_migrations`：记录旧后台账号到统一用户 ID 的一次性迁移关系，使启动迁移可重复执行而不会重复创建账号。
- `messages`：留言 ID 与 JSONB 数据；评论、附件、标签、投票和审核字段保留在 JSONB 中。
- `partitions`：标签与留言关系。
- `message_reactions`、`poll_votes`：点赞/点踩与投票身份去重。
- `user_favorites`、`user_notifications`：个人收藏和通知。
- `platform_settings`：验证码与社区运营设置。
- `admin_audit_events`：后台写操作的结构化审计记录。
- `moderation_notification_outbox`：审核群机器人投递任务、重试状态与脱敏错误摘要。

`users.role` 只允许：

- `user`
- `reviewer`
- `admin`
- `super_admin`

用户名先做 NFKC 规范化，再生成不区分大小写的 `username_key`。合法用户名为 2–24 位中文、字母、数字、点、下划线或短横线。密码长度为 8–128 个字符，仅保存带随机盐的 scrypt 哈希。

## 统一账号与旧数据迁移

PostgreSQL `users` 是普通入口和后台入口的单一账号源。后台登录不再维护第二套密码或权限文件。

升级旧部署时，服务启动会读取一次 `managers.json`，将其中账号、密码哈希、状态和权限映射到统一角色：

- 旧审核权限映射为 `reviewer`
- 旧最高权限映射为 `super_admin`
- 其他旧后台账号映射为 `admin`

迁移完成后，`legacy_manager_migrations` 会阻止再次导入；认证、改密、停用、角色判断和会话校验全部以 PostgreSQL 为准。`managers.json` 只作为迁移输入和离线历史备份，不再是运行时账号源。

旧 SQLite 留言库仍可通过 `npm run db:migrate` 一次性导入。旧 `manage_message.json` 的审核列表也只在首次启动时迁入消息 JSONB，并保留迁移标记。

## 注册、会话与角色

- `POST /api/user/register` 创建默认角色为 `user` 的账号，并写入签名 `user_session` Cookie。
- `POST /api/user/login` 与 `POST /api/admin/login` 校验同一条 PostgreSQL 用户记录。
- 只有 `reviewer`、`admin`、`super_admin` 可以登录后台。
- `reviewer` 可以处理 `/admin/wall` 帖子审核和 `/admin/confessions` 表白墙审核两个展示队列，并发布、编辑或收回主页公告；两页都由同一个 `review_posts` 权限授权。
- `admin` 可以管理内容、用户状态、公告、反馈、举报、日志和平台设置，但不能分配角色。
- `super_admin` 拥有全部权限，并可调用角色接口。
- 只有超级管理员可以改变角色；不能修改自己的角色，也不能移除最后一位启用的超级管理员。
- 角色变更、改密、重置密码和停用会递增 `session_version`，旧用户会话和后台会话随即失效。

权限始终由后端检查，前端侧栏隐藏只用于界面简化。

## 发帖与审核不变量

- 普通校园墙允许游客匿名发帖。
- 游客和普通 `user` 发布普通校园动态或表白便签时固定进入 `pending + pending` 并写审核 outbox；后台按内容类别分别在帖子审核或表白墙审核页展示，审核通过前不会公开。
- `reviewer`、`admin`、`super_admin` 初次发布普通校园动态或表白便签时直接创建为 `visible + approved`，不进入审核队列。
- 失物招领仍要求登录，但所有登录角色初次发布后都立即成为 `visible + approved`。
- 展示类别由 `contentCategories.js` 动态计算：存在结构化 `lost_found` 时始终优先归入 `posts`；否则仅标签数组精确包含 `表白` 时归入 `confessions`，`表白墙`、`#表白` 等近似值归入 `posts`。作者编辑标签后可以改变展示页，但不能借此改变审核状态。
- 上述管理角色内容和失物招领的初次免审发布不写入审核队列或审核通知 outbox。任何内容被管理端明确退回待审时，都必须设置 `review_hold=true`、写入 outbox，并显示在当时分类对应的页面。
- `review_hold` 是服务端安全锁：作者编辑不能清除或自行恢复 `visible + approved`，只有审核员再次通过才能解除。所有审核员完全同权，可审核两个展示队列中的任意实际待审内容。
- 单条审核与批量审核在两个页面使用相同的既有权限规则：审核员沿用 `review_posts`，管理员沿用 `manage_wall_message`；操作写入管理日志与结构化审计，展示分流不是新的授权边界。
- 公开接口只返回 `moderation_status=visible` 且 `review_status=approved` 的内容。
- 免审只影响初始状态；下架或已删除内容仍不会进入列表、详情、分区、热门、收藏或公开互动。

## 失物招领访问边界

失物招领是登录后专区：

- `GET /api/user/lost-found`：读取 `visible + approved` 的寻物与招领启事；接口本身仍要求登录。
- `POST /api/user/lost-found`：登录用户初次发布后立即创建为 `visible + approved`，不进入审核队列；若该内容后来被管理端退回，`review_hold` 仍阻止作者编辑后自行重新公开。
- 公共校园墙列表、搜索、详情、分区、热门与公开用户发布列表会过滤失物招领内容。
- 匿名请求不能通过保留标签或 `lost_found_type` 绕过专区接口。
- 静态附件路由会结合消息类型和当前登录状态检查访问权，避免通过已知文件名绕过登录限制。

## 接口概览

公开接口：

- `GET /health`
- `GET /api/get_messages`
- `POST /api/get_hot_messages`
- `POST /api/get_message_details/:id`
- `POST /api/get_message_partitions/:id`
- `POST /api/get_tags`
- `POST /api/get_partition_messages`
- `GET /api/notice`（`POST` 仅保留旧客户端兼容）
- `POST /api/wall/submit`
- `POST /api/wall/comment/:id`
- `POST /api/wall/like/:id`
- `POST /api/wall/dislike/:id`
- `POST /api/wall/poll/:id/vote`
- `POST /api/chunked_upload`
- `POST /api/merge_chunks`
- `POST /api/direct_upload`
- `POST /api/help/form`
- `POST /api/help/report/:id`
- `POST /api/help/report/:messageId/comment/:commentId`

账号接口：

- `GET /api/user/captcha/config`
- `POST /api/user/register`
- `POST /api/user/login`
- `POST /api/user/logout`
- `GET /api/user/session`
- `GET /api/user/me`
- `PUT /api/user/me/profile`
- `POST /api/user/me/password`
- `POST /api/user/me/avatar`
- `GET /api/user/lost-found`
- `POST /api/user/lost-found`
- `GET /api/user/me/messages`
- `GET /api/user/me/comments`
- `GET /api/user/me/favorites`
- `GET /api/user/me/notifications`

后台接口：

- `GET /api/admin/verify`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/dashboard/stats`
- `GET /api/admin/api/messages`（`scope=posts|confessions` 在状态筛选和分页前完成内容分流；省略或使用 `all` 时保留兼容的合并结果，响应中的 `counts` 按当前 scope 计算）
- `GET /api/admin/api/get_message/:id`
- `POST /api/admin/messages/:id/review`
- `POST /api/admin/messages/bulk-moderation`
- `POST /api/admin/messages/:id/moderation`
- `GET /api/admin/comments`
- `GET /api/admin/trash`
- `GET /api/admin/audit`
- `GET /api/admin/report`
- `GET /api/admin/feedback`
- `GET /api/admin/users`
- `GET /api/admin/users/stats`
- `GET /api/admin/roles`
- `PUT /api/admin/users/:id/role`

## 反馈与举报

前台允许提交反馈以及对留言或评论发起举报。提交成功后只返回成功页面，不提供面向公众的处理状态页面。后台继续保存工单、内部备注、处置记录和审计信息，供有权限的管理角色处理。

## 运行数据与备份

至少备份：

- PostgreSQL 数据库或 compose volume `campus_wall_postgres_data`
- `static/uploads`
- `static/tiny_files`
- `static/avatars`
- `static/notice.json`
- `help/*.json`
- `manage_message.json`
- `admin_log.json`

`managers.json` 是敏感的一次性迁移输入。迁移后应离线保存或安全归档，不要继续依赖，也不要提交到 Git。

临时分片目录 `static/chunks` 可清理，但会中断正在进行的上传。

## 安全注意

- 生产环境必须修改 `SECRET_KEY`、数据库密码和最高权限账号密码。
- `ALLOWED_ORIGINS` 应限制为真实前端域名；HTTPS 部署应启用 `SESSION_COOKIE_SECURE=true`。
- 注册与登录分别受 `RATE_LIMIT_REGISTER`、`RATE_LIMIT_LOGIN` 限制。
- Turnstile 或 reCAPTCHA 的服务端密钥加密保存在 PostgreSQL，公开接口只返回站点配置。
- 上传路径限制在 `static` 目录内；文件名经过安全归一化。
- 上传请求同时受次数、字节、并发、磁盘总量和最小剩余空间限制。
- 头像会自动纠正 EXIF 方向、居中裁剪为正方形并压缩为 WebP；替换成功后会清理不再引用的旧头像。
- 未引用上传、未合并分片和超期待审附件会定期清理。
- 视频转码受 `FFMPEG_TIMEOUT_MS` 限制。
- 宝塔/Nginx 必须把 `/static/uploads`、`/static/tiny_files` 和 `/api/static` 反向代理到本服务，禁止通过 `root` 或 `alias` 直接公开 `backend/static`；否则会绕过失物招领登录保护、待审核普通动态附件鉴权以及下架/删除状态检查。

## 检查

```bash
npm --workspace backend run check
```

完整构建：

```bash
npm run build
```
