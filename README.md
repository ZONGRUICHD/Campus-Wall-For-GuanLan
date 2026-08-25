# 龙华区观澜中学校园墙

面向龙华区观澜中学的校园交流平台，采用 React、Node.js/Express 与 PostgreSQL 构建。

> 当前文档版本：**3.0**（2026-08-26）。本轮代码验收与部署状态不在 README 中预先宣告，最终记录见 [HANDOFF.md 的“本轮验收记录”](./HANDOFF.md#151-30-本轮验收记录)。

代码仓库：[ZONGRUICHD/Campus-Wall-For-GuanLan](https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan)

完整的开发、审核、部署、备份、回滚与应急接管说明见 [HANDOFF.md](./HANDOFF.md)。每次功能、修复、主要交互或运维变更都必须在同一提交同步更新交接文档。

扩展与第三方接入文档：

- [提醒系统接入文档](./docs/NOTIFICATION_INTEGRATION.md)：飞书、企业微信现有配置，以及 QQ、微信的官方接入路线和可靠性要求；
- [模块开发文档](./docs/MODULE_DEVELOPMENT.md)：用前端注册表、后端模块清单与版本化 API 新增功能板块。

## 生产架构

- 正式前端：`https://wall.zongtech.xyz`，由 Cloudflare Pages 项目 `guanlan-campus-wall` 托管；稳定默认域名为 `https://guanlan-campus-wall.pages.dev`。
- 正式 API：`https://api-wall.zongtech.xyz`，Cloudflare 橙云代理后通过 Origin Rule 回源到服务器 Nginx 的 HTTPS 8443，再反向代理到 `127.0.0.1:5412`。
- Origin Rule 精确条件：`(http.host eq "api-wall.zongtech.xyz" and cf.edge.server_port eq 443)`，动作是把目标端口覆盖为 `8443`。
- 源站 443 被同机既有服务占用，不能为本项目抢占。8443 只允许 Cloudflare 官方 IPv4/IPv6 网段；PostgreSQL 5432 与 Node 5412 不向公网开放。
- API 使用 Cloudflare Origin CA 证书，路径为 `/etc/campuswall/tls/api-wall.zongtech.xyz.pem`，私钥为同目录 `.key`。API DNS 必须保持 Proxied；区域全局模式保持现有 `Full`，专用 Configuration Rule `Campus Wall API strict TLS` 以 `(http.host eq "api-wall.zongtech.xyz")` 精确匹配 API 并将 SSL 设置为 `Strict`，不会影响同区域其他主机。
- 不要恢复旧名 `api.wall.zongtech.xyz`：当前 Free 区域的 Universal SSL 只覆盖根域和一级通配符 `*.zongtech.xyz`，不会覆盖再嵌套一层的该主机；`api-wall.zongtech.xyz` 是可覆盖的一级子域。

权威部署资产为 `wrangler.jsonc`、`frontend/.env.production`、`frontend/public/_headers`、`deploy/nginx-campuswall-api.conf`、`deploy/nginx-campuswall-legacy-redirect.conf`、`deploy/cloudflare-realip.conf` 与 `deploy/campuswall.service`。旧 `deploy/nginx-campuswall.conf` 仅供历史同源部署参考；服务器 IP 的 80 端口只负责把页面请求重定向到 Pages、把旧 API/静态路径重定向到正式 API 域名。

## 产品规则

- 普通校园墙允许游客直接匿名发帖，不要求先创建账号。
- 普通校园动态按服务端生效 capability 分流：游客与没有 `content.publish.bypass_review` 的账号初次发布进入 `/admin/wall`；具备该能力的账号立即公开，不进入审核队列。
- 用户可以使用任意合规用户名和密码自行注册。用户名支持 2–24 位中文、字母、数字、点、下划线或短横线。
- 登录用户可以维护昵称、头像和个人简介，并查看自己的发布、评论、收藏和通知。
- 失物招领仅向登录用户开放。未登录访问会跳转到登录页；登录用户初次发布后立即可见，不进入审核队列。
- 表白墙使用 Three.js 渲染粉色便签爱心；游客和没有免审 capability 的账号初次提交进入 `/admin/confessions`，具备 `content.publish.bypass_review` 的账号立即公开。
- 表白墙爱心由便签实例组成，支持射线拾取、悬停/按压反馈、精选便签轮播与波纹突出；离屏、页面隐藏或系统要求减少动态时暂停，WebGL 不可用时保留普通便签列表。
- `/p` 是从公开消息真实标签聚合的话题目录，支持搜索、按热度/更新时间/名称排序和分页；`/p/:tag` 只展示精确包含该标签的公开内容，不再把“全部话题”当成一个虚拟标签。
- 首页公告使用稳定 ID、标题、摘要、正文、优先级、状态和发布时间；后台支持草稿、立即/定时公开、归档恢复、搜索筛选、实时预览和细粒度读写权限。
- 主题系统支持跟随系统/浅色/深色三态，以及海蓝、樱粉、紫藤、青绿、暖橙五种强调色；选择只保存在当前设备，并跨同源标签页同步。
- 反馈与举报提交后由管理后台统一处理；公开页面只显示提交成功提示。
- 后台把待审内容拆成“帖子审核”和“表白墙审核”两个互斥展示队列；reviewer 角色模板锁定且所有审核员完全同权，新授权检查使用 `content.queue.read/content.review`，旧 `review_posts` 只作兼容别名，操作保留审计记录。
- 前端功能板块集中在 `frontend/src/modules/registry.jsx` 注册，后端通过 `GET /api/modules` 发布安全、不可执行的启用清单；新增板块应遵循 [模块开发文档](./docs/MODULE_DEVELOPMENT.md)，不能在路由、导航与页脚分别散落硬编码。

## 角色与权限

账号使用“角色默认权限 + 用户个人覆盖”的 RBAC 模型。个人覆盖只存差异，解析优先级为：**角色默认 → `allow` 增加 → `deny` 移除（拒绝最终优先）**。

| 角色 | 权限范围 |
| --- | --- |
| `user` | 默认只有前台能力；可由超级管理员逐项授予后台 capability |
| `reviewer` | 所有审核员完全同权；权限模板锁定，不能设置个人覆盖 |
| `admin` | 默认拥有内容、公告、工单、举报、日志、设置和普通用户管理能力；允许个人 `allow/deny` 覆盖 |
| `super_admin` | 永久全权；权限模板锁定，可分配角色和他人的个人权限 |

细粒度 capability 至少覆盖后台概览、发布免审/官方身份、审核队列/审核/作者身份/非公开附件、帖子和评论的查看/上下架/删除/恢复/永久删除、媒体修复、公告读/建/改/归档、反馈、举报、用户资料/禁言/状态/改密、设置和三类日志。旧 `review_posts`、`notice`、`manage_users` 等粗权限仍作为兼容别名返回，但新代码应检查 capability。

只有超级管理员可整组替换或恢复他人的个人覆盖；禁止修改自己，`users.role.assign` 与 `users.permissions.assign` 不能作为普通覆盖分配。调整必须提供原因、显式确认串和当前 `permission_version`，版本冲突返回 409。权限或角色实际变化会递增 `session_version`，使旧前台/后台会话立即失效；角色变化同时清空覆盖。系统继续保证至少一位启用的超级管理员。本轮未实现 step-up 二次验证，高危授权必须依赖最小超级管理员人数、强密码、原因与审计复核。

## 账号与数据架构

- PostgreSQL `users` 表是普通登录与后台登录的单一账号源，保存用户名、scrypt 密码哈希、状态、角色、`session_version` 与 `permission_version`。
- `user_permission_overrides` 以 `(user_id, permission_key)` 为主键保存 `allow/deny` 差异及创建/更新操作者；读取用户列表时批量聚合，不允许逐用户 N+1 查询。
- 用户名经过 NFKC 规范化并使用不区分大小写的唯一键，避免逻辑重复账号。
- 旧 `backend/managers.json` 只在升级后的首次启动中作为一次性迁移来源。迁移关系记录在 PostgreSQL，后续认证与权限判断不再读取该文件。
- 留言存储在 PostgreSQL `messages.data` JSONB 中；审核状态由 `moderation_status` 与 `review_status` 共同决定。
- 旧 SQLite 留言库和旧审核列表只用于一次性迁移，运行时数据源为 PostgreSQL。
- 上传文件保存在 `backend/static/uploads`，缩略图保存在 `backend/static/tiny_files`，头像保存在 `backend/static/avatars`。新上传的帖子/评论图片无论直传还是分块上传，都会纠正 EXIF 方向、限制解码像素和最长边，并只保留压缩后的 WebP 展示文件；原始图片及已完成的分片不会保留。

## 技术栈

- 前端：React 19、React Router 7、Tailwind CSS 4、Vite、Three.js
- 后端：Node.js 22.12+、Express、multer、sharp、cookie-parser、express-rate-limit
- 数据库：PostgreSQL 18
- 媒体处理：图片使用 sharp；视频处理依赖系统 `ffmpeg`
- 前端托管与边缘代理：Cloudflare Pages、Cloudflare DNS/Origin Rules
- 源站代理：Nginx（HTTPS 8443）与 systemd
- 运行方式：开发、CI 与生产均连接操作系统原生 PostgreSQL 服务，不依赖容器运行时

## 快速开始

要求：

- Node.js 22.12+
- 已安装、已启动且可通过 TCP 连接的 PostgreSQL 18
- 系统可调用 `ffmpeg`

首次本地启动：

```bash
npm install
npm run db:wait
npm run dev
```

执行前先用操作系统服务管理器启动 PostgreSQL，并按 `backend/.env.example` 创建数据库、角色和本地环境变量。`npm run db:wait` 只检查连接，不会安装或启动数据库。只有确认需要导入已备份的旧 SQLite 留言库时，才单独执行 `npm run db:migrate`；全新环境不要运行迁移。

默认地址：

- 前端：http://localhost:1145
- 后端健康检查：http://localhost:5412/health

如需临时改用其他前端端口，应直接向前端 workspace 透传参数：

```bash
npm --workspace frontend run dev -- --port 5173
```

日常开发也可以直接运行：

```bash
npm run dev:local
```

`dev:local` 会先等待已经运行的 PostgreSQL，再同时启动前后端；它不会管理数据库服务，也不执行历史数据迁移。只有第一次接入旧数据时需要运行 `npm run db:migrate`。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动后端和前端 |
| `npm run dev:local` | 等待原生 PostgreSQL 可连接后启动前后端 |
| `npm run dev:frontend` | 仅启动前端 |
| `npm run dev:backend` | 仅启动后端 |
| `npm run build` | 构建前端 |
| `npm run pages:dev` | 构建并用 Wrangler 本地预览 Pages 产物 |
| `npm run pages:deploy` | 构建并发布到 `guanlan-campus-wall` 的 production branch |
| `npm run start:backend` | 以生产方式启动后端 |
| `npm run admin:reset-password -- <用户名>` | 在服务器终端恢复最高权限账号 |
| `npm run db:wait` | 等待数据库可连接 |
| `npm run db:migrate` | 一次性导入旧 SQLite 留言 |

## 项目结构

```text
campuswall-react/
├── backend/
│   ├── src/              # API、数据服务、认证与权限
│   ├── scripts/          # 数据迁移与账号恢复脚本
│   ├── static/           # 上传、缩略图、头像和公告运行数据
│   └── help/             # 反馈与举报运行数据
├── frontend/
│   ├── src/              # React 页面、组件、状态与 API 封装
│   ├── src/modules/      # 编译期模块注册表
│   └── public/           # favicon、Pages `_headers` 与兼容静态资源
├── docs/
│   ├── MODULE_DEVELOPMENT.md
│   └── NOTIFICATION_INTEGRATION.md
├── deploy/
│   ├── campuswall.service
│   ├── nginx-campuswall-api.conf
│   ├── nginx-campuswall-legacy-redirect.conf
│   └── cloudflare-realip.conf
├── wrangler.jsonc        # Cloudflare Pages 项目与构建目录
└── package.json
```

## 环境配置

后端默认配置见 `backend/.env.example`。生产环境至少需要设置：

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
ALLOWED_ORIGINS=https://wall.zongtech.xyz
PUBLIC_SITE_URL=https://wall.zongtech.xyz
SESSION_COOKIE_SAMESITE=Lax
SESSION_COOKIE_SECURE=true
CAPTCHA_PROVIDER=none
CAPTCHA_ENABLED=false
CAPTCHA_SITE_KEY=
CAPTCHA_SECRET_KEY=
```

也可以只设置 PostgreSQL 连接串：

```bash
DATABASE_URL=<PostgreSQL connection URL>
```

生产环境必须更换 `SECRET_KEY`、数据库密码与最高权限账号密码，并保持 `SESSION_COOKIE_SECURE=true`。`ALLOWED_ORIGINS` 只允许正式前端完整来源，不要添加旧 IP、Pages 预览域名或带凭据的通配符。

正式前端的公开构建变量位于 `frontend/.env.production`：

```env
VITE_API_BASE_URL=https://api-wall.zongtech.xyz
VITE_STATIC_URL=https://api-wall.zongtech.xyz/static/
VITE_APP_ENV=production
```

`VITE_*` 会进入浏览器资源，不能包含密码、令牌、Webhook、私钥或数据库连接串。修改后必须重新发布 Pages，仅重启后端不会生效。

## 主要接口

公开校园墙：

- `GET /health`
- `GET /api/modules`（后端允许的模块清单，五分钟公开缓存）
- `GET /api/topics?q=&s=popular|newest|name&start=&end=`
- `GET /api/notice`（只返回已到发布时间的 `published` 公告）
- `GET /api/get_messages`
- `POST /api/get_hot_messages`
- `POST /api/get_message_details/:id`
- `POST /api/wall/submit`
- `POST /api/wall/comment/:id`
- `POST /api/wall/like/:id`
- `POST /api/wall/dislike/:id`
- `POST /api/wall/poll/:id/vote`
- `POST /api/help/form`
- `POST /api/help/report/:id`
- `POST /api/help/report/:messageId/comment/:commentId`

账号与登录后功能：

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

后台与权限：

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/verify`
- `GET /api/admin/api/messages`（`scope=posts|confessions` 分别返回帖子或表白墙队列；省略时保留兼容的 `all` 视图）
- `GET /api/admin/api/get_message/:id`
- `POST /api/admin/messages/:id/review`
- `POST /api/admin/messages/bulk-moderation`
- `GET /api/admin/users`（面向 10,000+ 账号的服务端分页接口；支持 `page/page_size/q/role/status/muted/sort_by/sort_order`，返回筛选总数、页数和全局角色/状态统计，前端不会加载全量用户）
- `GET /api/admin/roles`
- `GET /api/admin/permissions`（capability catalog、角色默认模板与保护策略）
- `GET /api/admin/users/:id/permissions`（个人默认/覆盖/生效权限与版本；仅超级管理员）
- `PUT /api/admin/users/:id/permissions`（整组替换 `allow/deny`；需原因、确认串与 `permission_version`）
- `DELETE /api/admin/users/:id/permissions`（恢复角色默认；需原因、确认串与 `permission_version`）
- `PUT /api/admin/users/:id/role`
- `GET /api/admin/notice`
- `POST /api/admin/notice`
- `PUT /api/admin/notice/:noticeId`
- `DELETE /api/admin/notice/:noticeId`（归档，不是物理删除）

普通 `user` 获得任一后台 capability 后也能从顶部进入对应后台页面；`admin_session` 与 `user_session` 都可被后端统一解析，但每个接口仍检查实时 capability。隐藏导航不是权限边界。

## 提醒系统

- 已实现并可配置：飞书自定义群机器人、企业微信群机器人；两者可单独或同时启用。
- 未实现：QQ 官方机器人、微信生态消息通道。仓库没有个人 QQ/微信机器人，也不会采用逆向协议、Hook 或非官方框架。QQ 后续应接入 QQ 开放平台官方机器人；微信按场景选择微信客服 iLink、公众号模板消息或小程序订阅消息。
- 审核提醒使用 PostgreSQL outbox：与内容保存同事务写入（通知写失败通过 savepoint 补偿，不能阻断发帖），后台 worker 合并、限速、超时、拒绝重定向、检查 HTTP 和业务码、解析 `Retry-After`、指数退避、死信、陈旧锁恢复和留存清理。
- Webhook 只接受官方 HTTPS 目标；payload 不含正文、作者身份、联系方式或附件地址。配置、上线、故障恢复和未来 provider 契约见 [提醒系统接入文档](./docs/NOTIFICATION_INTEGRATION.md)。

## 审核与访问边界

- 游客与没有 `content.publish.bypass_review` 的账号发布普通校园动态或表白便签时以 `moderation_status=pending`、`review_status=pending` 创建，并写入审核 outbox；后台分别在 `/admin/wall` 和 `/admin/confessions` 展示，审核通过后才会公开。
- 具备 `content.publish.bypass_review` 的账号发布普通动态和表白便签，以及已登录用户发布失物招领，初次直接以 `moderation_status=visible`、`review_status=approved` 创建，不进入审核队列。
- 队列归属按当前内容动态计算：结构化 `lost_found` 内容优先归入帖子侧；其余内容只有在标签数组精确包含 `表白` 时才归入表白墙侧，`表白墙`、`#表白` 等近似标签不算。作者编辑标签后内容可能在两页之间移动，但不会清除审核状态或 `review_hold`。
- 任意内容被管理端明确退回待审后会设置 `review_hold=true` 并进入当前分类对应的展示队列；作者编辑不能清除该锁或自行重新公开，只有审核员再次通过才能解除。
- 公开接口始终只返回 `visible + approved` 内容；待审核、下架和已删除内容不会从公开列表、详情、分区、热门或互动接口泄漏。免审发布只决定初始状态，不绕过后续隐藏、删除和访问控制。
- 两个页面只是展示分流，不是权限分组或两套审核状态；任意具备 `content.review` 的账号都能处理两边实际待审内容，reviewer 模板始终同权，单条与批量能力一致。免审内容不会占用待审队列。
- 失物招领由登录接口单独读取与发布，公共校园墙接口会过滤该类内容。
- 失物招领附件按登录状态控制，不能通过静态文件 URL 绕过专区登录要求。
- 管理写操作记录到 PostgreSQL 审计时间线。

> 源站 Nginx 必须按 `deploy/nginx-campuswall-api.conf` 把 `/static/uploads`、`/static/tiny_files`、`/static/files` 与 `/api/*` 反向代理到 Node。禁止用 `root` 或 `alias` 直接公开 `backend/static`，否则会绕过登录和审核鉴权。前端页面由 Pages 托管，源站 Nginx 不再提供 `frontend/dist`。

## 部署与备份

前端发布在维护者工作区执行：

```bash
npm ci
npm --workspace backend test
npm --workspace backend run check
npm run build
git push schoolrepo HEAD:main
# 等待该 main 提交的 GitHub Actions CI 全部通过后再继续
npx wrangler whoami
npm run pages:deploy
```

后端由服务器快进同一个已通过 GitHub Actions CI 的 GitHub `main` 提交后执行测试并重启 `campuswall.service`。生产环境切换时还必须核对：Pages 自定义域名 Active、CNAME `wall` 指向 Pages、A `api-wall` 保持橙云、Origin Rule 精确表达式与 8443 动作、Origin CA 证书/SAN/私钥权限、UFW Cloudflare-only 网段、`ALLOWED_ORIGINS` 与 Secure Cookie。详细命令、上线顺序和回滚见 [HANDOFF.md](./HANDOFF.md#17-生产部署标准流程)。

本项目所有环境都使用操作系统原生 PostgreSQL；仓库不提供数据库容器定义，发布时也不得把现有 systemd、Nginx 或 PostgreSQL 服务替换成临时容器。

生产备份至少应包含：

- PostgreSQL 数据库
- `backend/static/uploads`
- `backend/static/tiny_files`
- `backend/static/avatars`
- `backend/static/notice.json`
- `backend/help/*.json`
- `backend/manage_message.json`
- `/etc/campuswall/backend.env`
- Origin CA 证书与私钥（私钥只能进入 root-only 加密备份）
- Nginx/systemd/UFW 有效配置，以及 Pages/DNS/Origin Rule 的脱敏记录
- `backend/admin_log.json`

`backend/managers.json` 仅作为升级时的一次性迁移输入保留，不是运行时账号数据库。迁移完成后应将其作为敏感历史备份离线保存，不要提交到 Git。

## 验证

```bash
npm run build
npm --workspace backend test
npm --workspace backend run check
npm audit --omit=dev --registry=https://registry.npmjs.org
```

本轮验收范围是功能、权限、安全边界、视觉/响应式和构建；**没有执行压力测试，也没有引入 Docker**。下列命令和人工矩阵是发布门槛，不代表本轮已经执行成功；实际结果、时间、提交和执行人必须由主任务在 [HANDOFF.md](./HANDOFF.md#151-30-本轮验收记录) 补录后才能发布。

发布后还应验证 `https://wall.zongtech.xyz/`、`/admin/wall`、`/admin/confessions` 等 SPA 深链接、`https://api-wall.zongtech.xyz/health`、正式 Origin 的 CORS 预检与恶意 Origin 拒绝。重点回归：注册与 Cookie 会话、无免审能力账号的普通动态/表白初始待审、具备 `content.publish.bypass_review` 的账号初始公开、帖子与表白只进入各自队列、精确 `表白` 和失物招领优先级、`review_hold` 不可由作者编辑绕过、登录失物招领立即公开、reviewer 完全同权、机器人分类深链，以及非 `visible + approved` 内容和附件不公开。

校园动态还需回归朋友圈式信息层级：头像与作者、正文、时间和操作的阅读顺序清晰；1 张媒体保留自然比例，2 张和 4 张使用两列，3 张与 5–9 张使用三列，超过 9 张只展示前 9 张并在最后一格标出剩余数量。发布器允许累计选择最多 20 个图片、视频或音频文件；需验证删除后继续添加、草稿恢复、投票、上传进度、全屏预览、评论展开，以及 360/520/768/1080px、软键盘、浅色/深色、键盘操作和减少动态偏好。

还必须验证：话题目录由真实公开标签聚合且精确筛选；主题三态与五种强调色持久化/跨标签同步；Three.js 爱心点击、精选轮播、离屏暂停、reduced-motion 和 WebGL 降级；公告草稿/定时/归档恢复/优先级与公开时间过滤；普通用户获得后台能力、deny 优先、依赖校验、版本冲突、审核员/超级管理员锁定、权限变更后会话即时失效；模块清单失败时只启用编译期安全默认值。

## 3.0 变更摘要

- 新增可逐用户配置的细粒度权限、三态继承编辑器、乐观版本和审计元数据，同时保留旧粗权限兼容。
- 修复 `/p`：由真实公开标签生成可搜索、排序和分页的话题目录，并按精确标签读取内容。
- 重做 Three.js 表白便签爱心的互动、精选轮播、性能暂停与无障碍降级。
- 新增外观三态与五套强调色主题选择器。
- 公告升级为标题/摘要/正文/优先级/状态/发布时间模型，支持草稿、定时、归档恢复、预览和权限分离。
- 新增前后端模块注册表、`GET /api/modules` 与模块开发规范。
- 加固提醒 outbox，并补齐飞书、企业微信、QQ、微信的完整接入与维护文档；其中 QQ、微信仍是路线说明，未上线。
- 保留 2.4 及更早的部署、媒体、万级用户、审核分流和 Cloudflare 架构历史；详细历史见 [HANDOFF.md](./HANDOFF.md#26-文档维护与变更记录)。
