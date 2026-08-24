# 龙华区观澜中学校园墙 Node/Express 后端

这是校园墙 API 的 Node.js + Express 后端，保持现有 React 前端接口兼容。消息运行时数据层使用 PostgreSQL 18，旧 SQLite 文件只用于一次性迁移和备份。

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

生产方式启动后端：

```bash
npm --workspace backend start
```

后端默认监听 `http://localhost:5412`，健康检查为 `GET /health`。

## 技术栈

- Express
- PostgreSQL 18 + `pg`
- compression
- multer
- sharp
- ffmpeg
- cookie-parser
- express-rate-limit
- dotenv

## 环境变量

默认值见 `backend/.env.example`。本地 compose 默认连接参数：

```text
host=localhost port=5432 database=campus_wall user=campus_wall
```

生产环境建议至少设置：

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
CAPTCHA_TIMEOUT_MS=8000
MAX_USER_IMPORT_ROWS=5000
MAX_AVATAR_SIZE=5242880
MAX_APP_ICON_SIZE=5242880
MAX_POLL_OPTIONS=6
MAX_POLL_DURATION_DAYS=30
MAX_CONTENT_LENGTH=104857600
MAX_CHUNK_SIZE=10485760
UNREFERENCED_UPLOAD_RETENTION_MS=7200000
PENDING_ATTACHMENT_RETENTION_MS=172800000
MAX_UPLOAD_STORAGE_BYTES=8589934592
MIN_FREE_DISK_BYTES=8589934592
RATE_LIMIT_LOGIN=30
RATE_LIMIT_WRITE=40
RATE_LIMIT_INTERACTION=240
RATE_LIMIT_UPLOAD=240
RATE_LIMIT_UPLOAD_BYTES=268435456
MAX_CONCURRENT_UPLOADS_PER_IP=3
MAX_CONCURRENT_UPLOADS_GLOBAL=24
RATE_LIMIT_FEEDBACK=20
```

`NODE_ENV=production` 时，默认 `SECRET_KEY` 占位值会导致启动立即失败；使用 PG 分项配置时，默认 PostgreSQL 开发密码同样会被拒绝。仅配置 `DATABASE_URL` 时无需额外设置未使用的 `PGPASSWORD`。

如果你更喜欢一行连接串，也可以直接设置 `DATABASE_URL`，后端会优先使用它。

## PostgreSQL 表结构

运行时会自动初始化 schema：

```sql
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partitions (
  tag TEXT NOT NULL,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (tag, message_id)
);

CREATE TABLE IF NOT EXISTS poll_votes (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  option_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, voter_key)
);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reactor_key TEXT NOT NULL,
  reaction SMALLINT NOT NULL CHECK (reaction IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, reactor_key)
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  real_name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  gender SMALLINT NOT NULL DEFAULT 0,
  avatar_file TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  muted_until TIMESTAMPTZ,
  mute_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  session_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS apps (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  partition TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  icon_file TEXT,
  icon_url TEXT NOT NULL DEFAULT '',
  icon_background TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`messages.data` 保留原留言 JSON 结构，评论、附件、标签、编辑记录、点赞、点踩、投票、置顶、精华和审核状态等字段不拆表，方便保持 API 响应兼容。留言 `moderation_status` 使用 `pending|visible|hidden|deleted`，`review_status` 使用 `pending|approved`；公开接口只返回同时为 `visible` 与 `approved` 的留言。每条评论也带有 `moderation_status=visible|hidden|deleted`，旧评论缺少字段时兼容为可见。公开响应会移除下架和已删除评论，并将回复它的引用摘要替换为固定占位文本。`poll_votes` 只保存投票身份与选项关系，用唯一键防止同一登录用户或访客重复投票。
普通用户密码使用 `crypto.scrypt` 加盐哈希保存，不保存明文密码。昵称、性别和最长 200 字的个人简介可由用户自行维护；删除账号按停用处理，历史内容保留。
应用广场已从产品主流程移除；PostgreSQL `apps` 表及旧接口仅为历史数据兼容保留，不进入公开/管理导航或仪表盘统计。

## SQLite 迁移

一次性迁移使用 Node.js 内置的 `node:sqlite`，执行迁移时需要 Node.js 22 或更高版本；生产运行不依赖 SQLite 原生扩展。

旧文件 `static/messages/messages.db` 保留为迁移来源和备份。导入命令需要从仓库根目录运行：

```bash
npm run db:migrate
```

迁移脚本会：

- 初始化 PostgreSQL schema。
- 读取 SQLite `messages` 和 `partitions`。
- 以事务 upsert 到 PostgreSQL。
- 根据留言 `tags` 补齐缺失的分区索引。
- 保留 SQLite 文件，不会删除原数据。

## 运行数据

迁移、部署和备份时应保留：

- PostgreSQL 数据库或 compose volume `campus_wall_postgres_data`
- `static/uploads`
- `static/tiny_files`
- `static/apps/icons`
- `static/notice.json`
- `help/*.json`
- `managers.json`
- `manage_message.json`
- `admin_log.json`

临时分片目录 `static/chunks` 可按需清理，但正在上传的分片会受影响。

上述内容均属于运行数据并已从 Git 排除。干净克隆首次启动会创建目录和空公告文件；管理员文件不会附带默认账号，请在项目根目录运行 `npm run admin:reset-password -- <用户名>` 创建第一个管理员。

## 接口兼容

后端保留原 `/api`、`/static`、`/health` 路径。前端开发环境通过 Vite 代理转发到 `http://localhost:5412`。

常用接口：

- `GET /health`
- `GET /api/get_messages`（可用 `tag` 参数按标签精确筛选公开且已审核留言）
- `POST /api/get_hot_messages`
- `POST /api/get_message_details/:id`
- `POST /api/wall/submit`
- `POST /api/wall/like/:id`
- `POST /api/wall/dislike/:id`
- `POST /api/wall/comment/:id`
- `POST /api/chunked_upload`
- `POST /api/merge_chunks`
- `POST /api/direct_upload`
- `POST /api/help/form`
- `GET /api/help/status/:ticketId`
- `GET /api/help/report/status/:reportId`
- `GET /api/community/config`
- `POST /api/help/report/:id`
- `POST /api/help/report/:messageId/comment/:commentId`
- `POST /api/user/login`
- `POST /api/user/logout`
- `GET /api/user/me`
- `PUT /api/user/me/profile`
- `POST /api/user/me/avatar`
- `POST /api/user/me/password`
- `GET /api/user/me/favorites/ids`
- `GET /api/user/me/favorites`
- `POST /api/user/me/favorites/:messageId`
- `DELETE /api/user/me/favorites/:messageId`
- `GET /api/user/me/messages`
- `PUT /api/user/me/messages/:messageId`
- `DELETE /api/user/me/messages/:messageId`
- `GET /api/user/me/comments`
- `DELETE /api/user/me/comments/:messageId/:commentId`
- `GET /api/user/me/notifications/unread-count`
- `GET /api/user/me/notifications`
- `POST /api/user/me/notifications/:notificationId/read`
- `POST /api/user/me/notifications/read-all`
- `DELETE /api/user/me/notifications/:notificationId`
- `DELETE /api/user/me/notifications`
- `GET /api/user/:id/profile`
- `GET /api/user/:id/messages`
- `GET /api/user/:id/avatar`
- `GET /api/admin/verify`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/managers`
- `POST /api/admin/managers`
- `PUT /api/admin/managers/:username`
- `POST /api/admin/managers/:username/reset_password`
- `POST /api/admin/managers/me/password`
- 旧 `/api/admin/users*` 接口仅为数据兼容保留，限超级管理员调用，不再属于新产品权限体系或仪表盘统计
- 旧 `/api/admin/apps*` 接口仅为数据兼容保留，限超级管理员调用，不再属于管理导航或统计主流程
- `GET /api/admin/dashboard/stats`
- `GET /api/admin/settings/captcha`
- `PUT /api/admin/settings/captcha`
- `GET /api/admin/settings/community`
- `PUT /api/admin/settings/community`
- `GET /api/admin/api/messages?status=pending|approved|visible|hidden|awaiting_publication|all`
- `POST /api/admin/messages/:messageId/review`
- `POST /api/admin/messages/bulk-moderation`
- `GET /api/admin/comments`
- `POST /api/admin/comments/:messageId/:commentId/moderation`
- `POST /api/admin/comments/bulk-moderation`
- `GET /api/admin/trash`
- `POST /api/admin/trash/messages/:messageId/restore`
- `DELETE /api/admin/trash/messages/:messageId`
- `POST /api/admin/trash/comments/:messageId/:commentId/restore`
- `DELETE /api/admin/trash/comments/:messageId/:commentId`
- `POST /api/admin/trash/bulk`
- `GET /api/admin/audit`
- `GET /api/admin/report`
- `GET /api/admin/reports/history`
- `POST /api/admin/reports/:messageId/:reportId/resolve`
- `GET /api/admin/feedback`
- `PUT /api/admin/feedback/:ticketId`
- `GET /api/user/captcha/config`

管理员登录后写入签名 `admin_session` cookie。启动时会把旧 `managers.json` 的明文密码原地迁移为 scrypt 哈希，并补齐账号状态、权限和 `session_version`；改密、重置密码或停用账号后，旧版本会话立即失效。拥有 `manage_admins` 权限的超级管理员会动态获得全部当前及未来权限。审核员账号只授予 `review_posts`，仅能读取审核队列以及通过或退回留言，不能管理用户、管理员、设置、回收站或内容上下架。
访客无需学号或学生登录即可发帖；普通用户登录后写入签名 `user_session` cookie，并可在发帖/评论时绑定账号。拥有 `review_posts` 或 `manage_wall_message` 的管理员可使用签名管理会话以官方身份发帖，留言仍进入待审核状态，且不能批准自己发布的官方留言。公开接口会隐藏匿名消息的学号和官方发帖人的后台登录名。
评论回复使用同一留言内的 `refer_id` 关联目标评论，引用摘要由后端根据目标内容生成；无效或已删除的目标会被拒绝，上传中的附件会同步回收。
“我的评论”接口只返回当前会话所属账号的评论；原帖下架且不属于当前账号时，不返回原帖正文摘要。通知删除和清空同样按当前账号隔离。
留言与评论举报分别记录 `target_type`、目标摘要和可选 `comment_id`，提交成功返回 32 位追踪码。公开状态接口只返回举报对象类型、分类、状态、标准处置结果、处理时间和管理员主动填写的 `public_reply`，不会返回举报理由、邮箱、内容摘要或处理管理员。管理员可保留内容，或将被举报评论、整条留言移入回收站；处理记录会移入 `help/processed_report.json`。历史查询接口支持 `page`、`page_size`、`q`、`action` 和 `target_type` 参数，旧格式归档会在读取时兼容归一化。

帮助反馈保存在 `help/help.json`。提交成功会返回 32 位追踪码；公开状态接口只返回分类、主题、状态、时间和公开回复，不返回邮箱、反馈正文、内部备注或管理员信息。后台反馈接口支持分页、搜索、分类/状态筛选，并记录每次状态或回复变更的处理时间线。旧格式反馈会在首次读取时自动补齐工单字段。

社区运营策略保存在 PostgreSQL `platform_settings` 的 `community` 记录中。管理员可控制全局发帖、全局评论和游客评论，并维护暂停说明、社区公约和最多 200 个敏感词。游客发帖与发帖审核固定开启：所有新留言及用户编辑过的非下架留言都会进入 `pending`，只有审核通过才转为公开 `visible`；下架留言通过审核也不会被自动恢复。作者自己的发布接口仍返回待审核和下架内容。发帖、评论、回复、投票以及用户编辑留言都会经过后端策略校验；公开配置接口只返回可展示的开关、说明和规则，不返回敏感词。

失物招领复用留言标签：`失物招领` 为专区标签，`寻物启事` 与 `招领启事` 为类型标签（提交时兼容 `拾物启事` 别名）。使用 `GET /api/get_messages?tag=失物招领` 获取专区公开内容，或按类型标签精确筛选；接口始终只返回已审核且未下架的留言。

旧 `manage_message.json` 的已审核 ID 会在首次启动时迁入消息 JSONB；迁移标记和原列表备份仍保存在该文件中。之后 PostgreSQL 是审核状态的唯一运行时来源。

评论下架不会删除 JSONB 内容和附件，作者可在“我的评论”查看状态与公开原因。评论从公开详情、统计和热门评分中排除，且不能再被公开回复或举报。管理员可在 `/admin/comments` 单条或批量恢复。

留言和评论删除使用 `moderation_status=deleted` 软删除。作者自删、管理员删除和举报处置都会进入 `/admin/trash`；恢复会还原 `deleted_from_status`，彻底删除接口只接受回收站内容。被软删除内容仍计为附件引用，只有最终清除后才会删除无其他引用的上传文件。发布者主动删除被举报内容时，对应待处理举报会自动归档。管理员成功写请求会记录到 PostgreSQL `admin_audit_events`，`/admin/audit` 支持关键词、管理员、动作、对象类型和分页筛选；首次初始化会导入现有 `admin_log.json` 作为历史记录。

Excel 导入账号使用 multipart 字段 `file`，首行字段至少包含 `学号`、`密码`、`姓名`，也兼容 `username`、`password`、`real_name`。

## 安全注意

- 生产环境必须修改默认 `SECRET_KEY` 和管理员密码。
- 管理员应通过 `/admin/managers` 修改密码；忘记密码或全部账号被停用时，在项目根目录运行 `npm run admin:reset-password -- <用户名>`。恢复命令会交互式读取新密码，不把密码写入命令行参数。
- `ALLOWED_ORIGINS` 应配置为真实前端域名。
- HTTPS 部署应启用 `SESSION_COOKIE_SECURE=true`。
- `CAPTCHA_PROVIDER=none` 为默认关闭状态。管理员可在 `/admin/settings` 配置 Turnstile 或 reCAPTCHA；公开接口只返回启用状态、供应商和站点密钥。
- 验证码服务端密钥使用 `SECRET_KEY` 派生密钥加密后保存，登录校验只由后端调用供应商 Siteverify 接口完成。
- 静态文件和上传相关路径会限制在 `static` 目录内，避免路径穿越。
- 上传大小、分片大小、文本长度、标签数量和附件数量通过 `.env` 控制。`MAX_CONTENT_LENGTH` 默认将单文件总大小限制为 100 MiB，`MAX_CHUNK_SIZE` 默认将单个分片限制为 10 MiB。
- 上传请求次数和流量分别受 `RATE_LIMIT_UPLOAD` 与 `RATE_LIMIT_UPLOAD_BYTES` 控制；默认每个可信客户端 IP 在 15 分钟内最多上传 256 MiB。限流键只使用 Express 解析后的 `req.ip`，客户端自行设置 `user_session` Cookie 不会切换限流桶。
- 直传和分片请求在进入 Multer 内存缓冲前还会受并发门禁保护，默认每个可信客户端 IP 同时最多 3 个、单个后端进程全局最多 24 个；可通过 `MAX_CONCURRENT_UPLOADS_PER_IP` 与 `MAX_CONCURRENT_UPLOADS_GLOBAL` 调整。
- 未被帖子或评论引用的上传文件与未合并分片默认保留 2 小时，后台会定期清理，避免放弃发布的附件长期占用磁盘。
- 待审核帖子附件默认保留 48 小时，超时仍未通过则从帖子中移除并清理文件；上传目录总量默认限制为 8 GiB，同时始终为系统盘保留至少 8 GiB 可用空间。
- 图片或视频转换完成后会按最终主文件与缩略图相对原始文件的实际新增字节再次检查存储总量和磁盘余量；复核失败会清理本次上传产生的全部输出。
- 视频转码调用系统 `ffmpeg`，并受 `FFMPEG_TIMEOUT_MS` 超时限制。

## 性能策略

- `compression` 会压缩 JSON、文本和其他可压缩响应。
- `/static/uploads`、`/static/tiny_files` 以及 `/api/static/files/:filename`、`/api/static/tiny_files/:filename` 设置 7 天 `immutable` 缓存。
- `/static/apps` 使用 1 小时短缓存。
- `/static/notice.json` 保持 `no-cache`，确保公告更新能及时反映。

## 检查

```bash
npm --workspace backend run check
```

开发命令只监听 `src` 内的 JavaScript 文件，写入反馈、举报、公告或日志 JSON 时不会触发后端热重启。

完整项目构建请在仓库根目录运行：

```bash
npm run build
```
