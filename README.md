# 校园墙（campuswall-react）

校园墙是一个可自行部署的校园留言墙 SPA，采用 React 前端、Node/Express 后端和 PostgreSQL 18 数据库，并提供完整的用户、内容与管理功能。

## 技术栈

- 前端：React 19、React Router 7、Tailwind CSS 4、Vite
- 后端：Node.js 20+、Express、multer、sharp、cookie-parser
- 数据库：PostgreSQL 18，留言正文使用 JSONB 保存原有数据结构
- 媒体处理：图片使用 sharp，视频处理依赖系统 `ffmpeg`
- 本地数据库：Docker Compose `postgres:18`

## 主要功能

- 游客和学生账号均可匿名发帖、评论、上传图片/音视频与附件。
- 登录用户可选择展示昵称，学号只用于身份绑定和后台管理。
- 登录用户可收藏留言，并在“个人中心 -> 我的收藏”跨设备查看。
- 登录用户可在“我的发布”查看全部本人内容，包括匿名留言，并编辑文字、标签、匿名状态或安全删除自己的留言。
- 登录用户可在“我的评论”跨留言查看本人评论、回复引用与附件，并安全删除自己发表的评论。
- 评论支持按楼层回复并显示可信引用摘要；被回复者会收到独立回复通知。
- 留言和评论都可单独举报；提交后会生成独立追踪码，可公开查询待处理状态、处置结果和管理员公开说明。后台按留言聚合显示上下文，并可保留内容，或将违规评论、整条留言移入回收站。
- 帮助反馈会生成独立追踪码；提交者可在公开页面查询处理状态和管理员回复，后台可筛选、回复、备注、流转和结单。
- 留言收到评论或回复时会生成账号通知，导航栏显示未读数量；通知支持单条删除、全部已读和清空。
- 用户可自行修改头像、昵称、个人简介、性别和密码；修改或管理员重置密码后，其他设备的旧会话自动失效。
- 发帖文字、标签和匿名选项会自动保存为浏览器草稿，发布成功后自动清除。
- 留言支持移动端系统分享；不支持系统分享时自动复制详情链接。
- 可发布 2-6 项单选投票，支持截止时间、实时结果和跨刷新防重复投票。
- 点赞与点踩使用 PostgreSQL 反应记录，同一账号或访客只能保留一种状态，登录用户可跨设备恢复。
- 管理员可将优质留言置顶或设为精华，置顶内容在墙页优先展示，精华内容优先进入热门。
- 管理员可填写原因下架留言并随时恢复；下架内容不会出现在公开列表、详情、分区和热门中，作者仍可查看原因。
- 管理员可选择开启“发帖需要审核后公开”。开启后新留言和编辑过的公开留言进入待审核状态，作者仍可在“我的发布”查看；后台支持队列筛选、单条审核和批量通过、退回、下架、恢复。
- 后台提供独立评论管理队列，可搜索、筛选、单条或批量下架/恢复评论；被下架评论不会计入公开评论数和热门权重，回复中的原文引用会自动脱敏，登录作者仍可查看原因并收到通知。
- 留言与评论删除统一进入后台内容回收站；恢复会还原删除前的公开/待审/下架状态，只有回收站内容才能被彻底删除，附件会保留到最终清理。
- 发布者主动删除被举报内容时，对应待处理举报会自动归档，并向追踪码查询页返回“相关内容已由发布者删除”。
- 管理员写操作同步写入 PostgreSQL 结构化审计时间线，可按管理员、动作、对象和关键词检索；旧 `admin_log.json` 仍保留兼容视图。
- 登录、发帖/评论、点赞/投票、上传、帮助/举报使用独立频率限制，降低撞库和刷接口风险。
- 管理后台支持运营统计、留言、账号、应用、公告、举报、日志和平台安全设置。
- 管理员账号支持后台新增、停用、重置密码和细粒度权限分配；密码仅保存 scrypt 哈希，改密、重置或停用会立即注销旧会话。
- 管理员可在平台设置中控制全站发帖/评论、游客发帖/评论和发帖预审，维护暂停说明、社区公约和敏感词；策略由后端强制执行。
- 学生登录验证码可在 `/admin/settings` 配置 Turnstile 或 reCAPTCHA；服务端密钥加密保存且不会返回浏览器。

## 快速开始

要求：

- Node.js 20+
- Docker Desktop，或一个可用的外部 PostgreSQL 18
- 系统可调用 `ffmpeg`，用于视频上传转码和预览生成

首次本地启动：

```bash
npm install
npm run db:up
npm run db:wait
npm run db:migrate
npm run dev
```

打开：

- 前端：http://localhost:5173
- 后端健康检查：http://localhost:5412/health

日常本地开发也可以用一条命令启动 PostgreSQL、后端和前端：

```bash
npm run dev:local
```

注意：`dev:local` 不会自动执行历史 SQLite 数据迁移。第一次接入旧数据时，仍需要先运行一次 `npm run db:migrate`。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动 Node 后端和 Vite 前端 |
| `npm run dev:local` | 先启动本地 PostgreSQL，再启动前后端 |
| `npm run dev:frontend` | 仅启动前端 |
| `npm run dev:backend` | 仅启动后端 |
| `npm run build` | 构建 React 前端 |
| `npm run start:backend` | 以生产方式启动 Node 后端 |
| `npm run admin:reset-password -- <用户名>` | 在服务器终端恢复管理员密码或创建恢复账号 |
| `npm run db:up` | 启动 Docker PostgreSQL 18 |
| `npm run db:wait` | 等待 PostgreSQL 可连接 |
| `npm run db:migrate` | 从旧 SQLite 导入留言到 PostgreSQL |
| `npm run db:down` | 停止 compose 服务 |

## 项目结构

```text
campuswall-react/
├── backend/              # Node/Express API 服务
│   ├── src/              # 后端源码
│   ├── scripts/          # PostgreSQL 等待和 SQLite 迁移脚本
│   ├── static/           # 运行时上传、缩略图和公告目录（数据不入 Git）
│   ├── help/             # 运行时帮助与举报目录（数据不入 Git）
│   └── package.json
├── frontend/             # React + Vite 前端
│   ├── public/           # favicon 和旧静态资源
│   ├── src/              # React 页面、组件、样式和 API 封装
│   └── package.json
├── compose.yml           # 本地 PostgreSQL 18
└── package.json          # 根目录统一脚本
```

## 视觉

- 默认站点名称为“校园墙”，可在部署时按需定制。
- 通用 favicon 位于 `frontend/public/favicon.svg`。
- 主色迁移自旧站 CSS：蓝色 `#2A5CAA`，橙色 `#FF7F3E`。
- React 主应用主题变量集中在 `frontend/src/styles.css`；旧静态页面配色保留在 `frontend/public/static/css`。

## 环境配置

后端默认配置见 `backend/.env.example`。本地默认值可直接配合 `compose.yml` 使用；生产环境建议复制为 `backend/.env` 并至少修改：

```bash
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
```

如果你更喜欢一行连接串，也可以直接设置 `DATABASE_URL`，后端会优先使用它：

```bash
DATABASE_URL=<PostgreSQL connection URL>
```

本地 compose 默认数据库参数为：

```text
host=localhost port=5432 database=campus_wall user=campus_wall
```

## 数据说明

- 运行时消息数据库是 PostgreSQL 18。
- 普通用户账号保存在 PostgreSQL `users` 表中，学号 `username` 唯一且不可修改，密码使用 Node `crypto.scrypt` 加盐哈希保存。
- 登录用户发帖默认匿名；选择非匿名时，公开页面只展示发布时的昵称快照，不展示学号或真实姓名。
- 管理员可以在后台通过 Excel 导入账号、编辑资料、停用账号、禁言/解禁和重置密码。
- `backend/static/messages/messages.db` 只作为一次性迁移来源和备份保留，后端运行时不再读取 SQLite。
- `messages.data` 使用 JSONB 保存原留言 JSON，评论、附件、标签、点赞和点踩等字段不拆表。
- 留言状态使用 `moderation_status=pending|visible|hidden|deleted` 与 `review_status=pending|approved`。旧数据缺少状态字段时按“公开但待复核”兼容读取；旧 `manage_message.json` 审核列表首次启动时会迁入 PostgreSQL 并保留备份记录。
- 关闭发帖预审时，仍在 `pending` 的留言会自动转为公开但待复核；开启预审不会追溯隐藏已有公开留言。
- 投票内容保存在消息 JSONB 中，投票身份记录保存在 `poll_votes(message_id, voter_key)`，数据库唯一键负责拦截重复投票。
- 分区索引使用 `partitions(tag, message_id)`，启动和迁移时会根据消息标签补齐。
- 上传文件保存在 `backend/static/uploads`。
- 缩略图保存在 `backend/static/tiny_files`。
- 应用广场数据保存在 PostgreSQL `apps` 表中，上传图标保存在 `backend/static/apps/icons`。
- 公告、反馈工单、举报和旧管理员文本日志继续使用原 JSON 文件；结构化管理员审计记录保存在 PostgreSQL `admin_audit_events`，反馈工单保留公开回复、内部备注和处理时间线。

部署和备份时需要保留：

- PostgreSQL 数据库，或本地 compose volume `campus_wall_postgres_data`
- `backend/static/uploads`
- `backend/static/tiny_files`
- `backend/static/apps/icons`
- `backend/static/notice.json`
- `backend/help/*.json`
- `backend/managers.json`（管理员密码哈希、状态、权限和会话版本）
- `backend/manage_message.json`
- `backend/admin_log.json`

这些目录和文件包含账号、用户内容或运行状态，已由 `.gitignore` 排除。公共仓库的干净克隆首次启动时会自动创建所需目录和空公告文件；首次使用管理后台前，请运行 `npm run admin:reset-password -- <用户名>` 创建管理员。生产备份应单独加密保存上述运行数据，不要提交到 Git。

## API 兼容

前端仍通过 `/api`、`/static`、`/health` 访问后端。Vite 开发代理指向 `http://localhost:5412`。

主要公开接口：

- `GET /health`
- `GET /api/get_messages`
- `POST /api/get_hot_messages`
- `POST /api/get_message_details/:id`
- `POST /api/get_message_partitions/:id`
- `POST /api/get_tags`
- `POST /api/get_partition_messages`
- `POST /api/notice`
- `POST /api/apps`
- `GET /api/community/config`
- `POST /api/wall/submit`
- `POST /api/wall/like/:id`
- `POST /api/wall/dislike/:id`
- `POST /api/wall/comment/:id`
- `POST /api/wall/poll/:id/vote`
- `POST /api/chunked_upload`
- `POST /api/merge_chunks`
- `POST /api/direct_upload`
- `POST /api/help/form`
- `GET /api/help/status/:ticketId`
- `GET /api/help/report/status/:reportId`
- `POST /api/help/report/:id`
- `POST /api/help/report/:messageId/comment/:commentId`
- `POST /api/user/login`
- `POST /api/user/logout`
- `GET /api/user/me`
- `PUT /api/user/me/profile`
- `POST /api/user/me/avatar`
- `GET /api/user/me/messages`
- `PUT /api/user/me/messages/:messageId`
- `DELETE /api/user/me/messages/:messageId`
- `GET /api/user/me/comments`
- `DELETE /api/user/me/comments/:messageId/:commentId`
- `GET /api/user/me/notifications`
- `DELETE /api/user/me/notifications/:notificationId`
- `DELETE /api/user/me/notifications`
- `GET /api/user/:id/profile`
- `GET /api/user/:id/messages`
- `GET /api/user/:id/avatar`
- `GET /user/:id/avatar`

管理员接口保留 `/api/admin/...` 路径。登录后使用签名 `admin_session` cookie，不再把管理员密码写入浏览器存储。

管理员账号接口：
- `GET /api/admin/managers`
- `POST /api/admin/managers`
- `PUT /api/admin/managers/:username`
- `POST /api/admin/managers/:username/reset_password`
- `POST /api/admin/managers/me/password`

留言管理扩展接口：
- `POST /api/admin/messages/:id/moderation`，JSON 字段支持 `pinned`、`featured`、`hidden` 和 `hidden_reason`
- `POST /api/admin/messages/:id/review`，JSON 字段 `action` 支持 `approve` 和 `return`
- `POST /api/admin/messages/bulk-moderation`，最多处理 100 条留言，`action` 支持 `approve`、`return`、`hide` 和 `restore`
- `GET /api/admin/api/messages`，支持 `status=pending|approved|visible|hidden|awaiting_publication|all`、搜索和分页
- `GET /api/admin/comments`，支持 `status=all|visible|hidden`、搜索和分页
- `POST /api/admin/comments/:messageId/:commentId/moderation`，JSON 字段支持 `hidden` 和 `hidden_reason`
- `POST /api/admin/comments/bulk-moderation`，最多处理 100 条评论，`action` 支持 `hide` 和 `restore`

内容回收站与审计接口：
- `GET /api/admin/trash`，支持 `type=all|message|comment`、搜索和分页
- `POST /api/admin/trash/messages/:messageId/restore`
- `DELETE /api/admin/trash/messages/:messageId`，JSON 必须包含 `confirm: "PURGE"`
- `POST /api/admin/trash/comments/:messageId/:commentId/restore`
- `DELETE /api/admin/trash/comments/:messageId/:commentId`，JSON 必须包含 `confirm: "PURGE"`
- `POST /api/admin/trash/bulk`，`action` 支持 `restore` 和 `purge`，最多处理 100 项
- `GET /api/admin/audit`，支持 `q`、`actor`、`action`、`target_type` 和分页

举报处置接口：
- `GET /api/admin/report`
- `GET /api/admin/reports/history`
- `POST /api/admin/reports/:messageId/:reportId/resolve`，JSON 字段 `action` 支持 `dismiss`、`delete_comment` 和 `delete_message`，可选 `public_reply` 向举报人公开处理说明

反馈工单接口：
- `GET /api/admin/feedback`，支持 `page`、`page_size`、`q`、`status` 和 `category`
- `PUT /api/admin/feedback/:ticketId`，JSON 字段支持 `status`、`public_reply` 和 `internal_note`

新增用户管理接口包括：
- `GET /api/admin/users`
- `GET /api/admin/users/stats`
- `POST /api/admin/users/import`
- `PUT /api/admin/users/:id`
- `POST /api/admin/users/:id/mute`
- `POST /api/admin/users/:id/unmute`
- `POST /api/admin/users/:id/disable`
- `POST /api/admin/users/:id/reset_password`

新增应用广场管理接口包括：
- `GET /api/admin/apps`
- `GET /api/admin/apps/stats`
- `POST /api/admin/apps`
- `PUT /api/admin/apps/:id`
- `POST /api/admin/apps/:id/hide`
- `POST /api/admin/apps/:id/restore`
- `DELETE /api/admin/apps/:id`

平台运营设置接口：
- `GET /api/admin/settings/community`
- `PUT /api/admin/settings/community`
- 公开 `GET /api/community/config` 不返回敏感词列表

普通用户登录后写入签名 `user_session` httpOnly cookie。`CAPTCHA_PROVIDER=none` 时后端跳过人机验证；登录页不向未登录用户展示验证码配置，后续接入 Turnstile/reCAPTCHA 时应由后台配置并扩展后端验证码适配层。

## 前端加载优化

- React 页面使用路由级懒加载，首页不会一次性加载所有公开页和管理后台代码。
- 富文本清洗工具 DOMPurify 按需加载，只有渲染公告或应用 HTML 内容时才请求相关 chunk。
- 前端 API 层使用原生 `fetch`，避免把 Axios 打进首屏主包。
- Bootstrap Icons 只打包当前 React 页面实际使用的图标类，并只输出现代浏览器使用的 `woff2` 字体。
- Umami 统计脚本不再写在 HTML 首屏里，生产环境会在页面渲染后空闲加载。
- Vite 开发环境如果出现依赖预构建缓存失效，可以按“开发排错”里的方法重建缓存。

## 后端性能

- Express 启用 `compression`，压缩 JSON、文本等可压缩响应。
- 上传文件和缩略图使用 7 天 `immutable` 缓存头，减少重复访问时的网络开销。
- 应用静态资源使用短缓存，公告 JSON 保持 `no-cache`，避免公告更新不及时。

## 开发排错

如果浏览器空白，并在控制台看到类似：

```text
GET /node_modules/.vite/deps/dompurify.js?... 504 (Outdated Optimize Dep)
```

这是 Vite 依赖预构建缓存过期，不是业务代码错误。处理方式：

```powershell
# 先停止正在运行的前端 dev 服务
Remove-Item -Recurse -Force frontend/node_modules/.vite, frontend/node_modules/.vite-temp
npm --workspace frontend run dev -- --force
```

如果后端也需要一起重新启动：

```bash
npm --workspace backend run dev
```

重启后在浏览器按 `Ctrl + F5` 强制刷新，或打开带时间戳的新地址，例如 `http://localhost:5173/?fresh=1`。

## 安全与运维注意

- 生产环境必须修改 `SECRET_KEY` 和默认管理员密码。
- 首次启动会把旧 `managers.json` 中的明文密码自动迁移为 scrypt 哈希；之后请在 `/admin/managers` 修改密码。无法登录时可运行 `npm run admin:reset-password -- <用户名>` 恢复。
- 生产环境请配置 `ALLOWED_ORIGINS`，避免跨站请求写入。
- HTTPS 部署时设置 `SESSION_COOKIE_SECURE=true`。
- `CAPTCHA_PROVIDER=none` 为默认关闭状态。可在管理后台“平台设置”中启用 Cloudflare Turnstile 或 Google reCAPTCHA，也可使用环境变量作为初始配置。
- 验证码服务端密钥使用 `SECRET_KEY` 派生密钥加密后存入 PostgreSQL；更换 `SECRET_KEY` 前应先关闭或重新配置验证码。
- 静态文件、上传文件和缩略图接口会限制在后端 `static` 目录内，避免路径穿越。
- 上传大小、文本长度、标签数量、评论附件数量等限制都在 `backend/.env.example` 中可配置。
- `RATE_LIMIT_LOGIN`、`RATE_LIMIT_WRITE`、`RATE_LIMIT_INTERACTION`、`RATE_LIMIT_UPLOAD`、`RATE_LIMIT_FEEDBACK` 可分别调整各类接口限额。
- 视频处理依赖外部 `ffmpeg`，服务端没有 `ffmpeg` 时视频转码和预览会失败。
- 不建议把 `backend/.env`、生产管理员账号文件或生产日志提交到仓库。

## 验证

常用检查：

```bash
npm run build
npm --workspace backend run check
npm audit --omit=dev --registry=https://registry.npmjs.org
```

功能回归重点：

- 首页公告和热门留言加载
- 墙页搜索、筛选、加载更多、发布、上传、互斥点赞/点踩、评论、投票及结果恢复
- 预审开关关闭时新留言立即公开但进入待复核队列；开启时新留言和编辑留言仅作者与管理员可见
- 管理员单条/批量通过、退回、下架、恢复，状态变化通知作者，待审核内容不会泄漏到列表、详情、分区、热门、收藏或互动接口
- 评论单条/批量下架与恢复、作者通知、隐藏引用脱敏、公开评论计数和热度过滤
- 作者自删、后台删除和举报删除进入回收站；恢复后状态还原，彻底删除仅接受回收站内容，附件引用在最终清理前保留
- 操作审计可按管理员和对象检索，失败请求和普通读取不会写入审计记录
- 管理员置顶/取消置顶、精华/取消精华、下架/恢复及前台过滤排序
- 留言详情、分区页、应用页、帮助、留言/评论举报、追踪码查询和后台公开处理说明流程
- 帮助反馈提交、追踪码查询、后台公开回复、内部备注、状态流转和结单
- 管理后台应用新增、编辑、下架、恢复和彻底删除
- 社区公约展示、全局/游客互动开关、暂停说明和敏感词后端拦截
- 普通用户 Excel 导入、登录、退出、修改头像/昵称/个人简介/性别
- 登录用户默认匿名发帖，关闭匿名时公开展示昵称
- 禁言用户不能发帖和评论，游客发帖仍可用
- 用户页只展示非匿名公开留言，不暴露学号
- 管理员登录、校验、退出、改密、账号停用、权限分配、旧会话失效、仪表盘统计、审核、回收站、操作审计、举报上下文、处置与历史检索、日志、公告、用户和验证码配置管理
