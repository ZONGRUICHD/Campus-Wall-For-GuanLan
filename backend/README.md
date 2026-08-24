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
- `reviewer` 只能处理帖子审核队列。
- `admin` 可以管理内容、用户状态、公告、反馈、举报、日志和平台设置，但不能分配角色。
- `super_admin` 拥有全部权限，并可调用角色接口。
- 只有超级管理员可以改变角色；不能修改自己的角色，也不能移除最后一位启用的超级管理员。
- 角色变更、改密、重置密码和停用会递增 `session_version`，旧用户会话和后台会话随即失效。

权限始终由后端检查，前端侧栏隐藏只用于界面简化。

## 发帖与审核不变量

- 普通校园墙允许游客匿名发帖。
- 所有新帖子固定进入 `pending`，审核通过前不会公开。
- 注册用户和后台角色发帖也遵循同一审核流程。
- 后台角色可以选择以官方身份发帖，但不能通过自己发布的帖子。
- 自审检查同时比较统一用户 ID 与旧数据兼容用户名；单条审核和批量审核不能绕过。
- 公开接口只返回 `moderation_status=visible` 且 `review_status=approved` 的内容。
- 下架或已删除内容不会进入列表、详情、分区、热门、收藏或公开互动。

## 失物招领访问边界

失物招领是登录后专区：

- `GET /api/user/lost-found`：读取已审核的寻物与招领启事。
- `POST /api/user/lost-found`：发布启事，仍进入统一待审核队列。
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
- `POST /api/notice`
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
- `GET /api/admin/api/messages`
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
- 未引用上传、未合并分片和超期待审附件会定期清理。
- 视频转码受 `FFMPEG_TIMEOUT_MS` 限制。
- 宝塔/Nginx 必须把 `/static/uploads`、`/static/tiny_files` 和 `/api/static` 反向代理到本服务，禁止通过 `root` 或 `alias` 直接公开 `backend/static`；否则会绕过失物招领登录保护及待审核附件鉴权。

## 检查

```bash
npm --workspace backend run check
```

完整构建：

```bash
npm run build
```
