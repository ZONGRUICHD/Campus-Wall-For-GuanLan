# 龙华区观澜中学校园墙

面向龙华区观澜中学的校园交流平台，采用 React、Node.js/Express 与 PostgreSQL 构建。

代码仓库：[ZONGRUICHD/Campus-Wall-For-GuanLan](https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan)

完整的开发、审核、部署、备份、回滚与应急接管说明见 [HANDOFF.md](./HANDOFF.md)。

## 生产架构

- 正式前端：`https://wall.zongtech.xyz`，由 Cloudflare Pages 项目 `guanlan-campus-wall` 托管；稳定默认域名为 `https://guanlan-campus-wall.pages.dev`。
- 正式 API：`https://api-wall.zongtech.xyz`，Cloudflare 橙云代理后通过 Origin Rule 回源到服务器 Nginx 的 HTTPS 8443，再反向代理到 `127.0.0.1:5412`。
- Origin Rule 精确条件：`(http.host eq "api-wall.zongtech.xyz" and cf.edge.server_port eq 443)`，动作是把目标端口覆盖为 `8443`。
- 源站 443 被同机既有服务占用，不能为本项目抢占。8443 只允许 Cloudflare 官方 IPv4/IPv6 网段；PostgreSQL 5432 与 Node 5412 不向公网开放。
- API 使用 Cloudflare Origin CA 证书，路径为 `/etc/campuswall/tls/api-wall.zongtech.xyz.pem`，私钥为同目录 `.key`。API DNS 必须保持 Proxied；区域全局模式保持现有 `Full`，专用 Configuration Rule `Campus Wall API strict TLS` 以 `(http.host eq "api-wall.zongtech.xyz")` 精确匹配 API 并将 SSL 设置为 `Strict`，不会影响同区域其他主机。
- 不要恢复旧名 `api.wall.zongtech.xyz`：当前 Free 区域的 Universal SSL 只覆盖根域和一级通配符 `*.zongtech.xyz`，不会覆盖再嵌套一层的该主机；`api-wall.zongtech.xyz` 是可覆盖的一级子域。

权威部署资产为 `wrangler.jsonc`、`frontend/.env.production`、`frontend/public/_headers`、`deploy/nginx-campuswall-api.conf`、`deploy/cloudflare-realip.conf` 与 `deploy/campuswall.service`。旧 `deploy/nginx-campuswall.conf` 仅供历史同源部署参考。

## 产品规则

- 普通校园墙允许游客直接匿名发帖，不要求先创建账号。
- 每一条新帖子都先进入待审核队列；只有审核通过后才会出现在公开列表、详情、分区和热门内容中。
- 用户可以使用任意合规用户名和密码自行注册。用户名支持 2–24 位中文、字母、数字、点、下划线或短横线。
- 登录用户可以维护昵称、头像和个人简介，并查看自己的发布、评论、收藏和通知。
- 失物招领仅向登录用户开放。未登录访问会跳转到登录页，登录后可查看和发布寻物或招领启事。
- 表白墙使用 Three.js 渲染粉色粒子爱心。
- 首页持续展示最新校园公告；审核员、管理员和超级管理员均可发布、编辑或收回公告。
- 反馈与举报提交后由管理后台统一处理；公开页面只显示提交成功提示。
- 管理员、超级管理员和审核员也可以发帖；所有审核员使用同一个全局队列，可以审核全部待审内容，包括自己提交的内容，操作会保留审计记录。

## 角色与权限

账号使用统一角色模型：

| 角色 | 权限范围 |
| --- | --- |
| `user` | 普通注册用户；使用个人中心与登录后功能 |
| `reviewer` | 所有审核员完全同权；审核全局待审内容并管理主页公告；不能分配角色或管理其他平台设置 |
| `admin` | 管理内容、公告、反馈、举报、设置和用户状态；不能分配角色 |
| `super_admin` | 拥有全部后台权限，并可把注册用户设置为任意角色 |

角色变更、改密和停用会递增会话版本，使旧会话立即失效。系统禁止修改自己的角色，并保证至少保留一位启用的超级管理员。

## 账号与数据架构

- PostgreSQL `users` 表是普通登录与后台登录的单一账号源，保存用户名、scrypt 密码哈希、状态、角色和会话版本。
- 用户名经过 NFKC 规范化并使用不区分大小写的唯一键，避免逻辑重复账号。
- 旧 `backend/managers.json` 只在升级后的首次启动中作为一次性迁移来源。迁移关系记录在 PostgreSQL，后续认证与权限判断不再读取该文件。
- 留言存储在 PostgreSQL `messages.data` JSONB 中；审核状态由 `moderation_status` 与 `review_status` 共同决定。
- 旧 SQLite 留言库和旧审核列表只用于一次性迁移，运行时数据源为 PostgreSQL。
- 上传文件保存在 `backend/static/uploads`，缩略图保存在 `backend/static/tiny_files`，头像保存在 `backend/static/avatars`。

## 技术栈

- 前端：React 19、React Router 7、Tailwind CSS 4、Vite、Three.js
- 后端：Node.js 22.12+、Express、multer、sharp、cookie-parser、express-rate-limit
- 数据库：PostgreSQL 18
- 媒体处理：图片使用 sharp；视频处理依赖系统 `ffmpeg`
- 前端托管与边缘代理：Cloudflare Pages、Cloudflare DNS/Origin Rules
- 源站代理：Nginx（HTTPS 8443）与 systemd

## 快速开始

要求：

- Node.js 22.12+
- Docker Desktop，或可用的 PostgreSQL 18
- 系统可调用 `ffmpeg`

首次本地启动：

```bash
npm install
npm run db:up
npm run db:wait
npm run db:migrate
npm run dev
```

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

`dev:local` 不执行历史数据迁移；只有第一次接入旧数据时需要运行 `npm run db:migrate`。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动后端和前端 |
| `npm run dev:local` | 启动本地 PostgreSQL 后再启动前后端 |
| `npm run dev:frontend` | 仅启动前端 |
| `npm run dev:backend` | 仅启动后端 |
| `npm run build` | 构建前端 |
| `npm run pages:dev` | 构建并用 Wrangler 本地预览 Pages 产物 |
| `npm run pages:deploy` | 构建并发布到 `guanlan-campus-wall` 的 production branch |
| `npm run start:backend` | 以生产方式启动后端 |
| `npm run admin:reset-password -- <用户名>` | 在服务器终端恢复最高权限账号 |
| `npm run db:up` | 启动本地 PostgreSQL |
| `npm run db:wait` | 等待数据库可连接 |
| `npm run db:migrate` | 一次性导入旧 SQLite 留言 |
| `npm run db:down` | 停止本地数据库服务 |

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
│   └── public/           # favicon、Pages `_headers` 与兼容静态资源
├── deploy/
│   ├── campuswall.service
│   ├── nginx-campuswall-api.conf
│   └── cloudflare-realip.conf
├── compose.yml
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
- `GET /api/admin/api/messages`
- `GET /api/admin/api/get_message/:id`
- `POST /api/admin/messages/:id/review`
- `POST /api/admin/messages/bulk-moderation`
- `GET /api/admin/users`
- `GET /api/admin/roles`
- `PUT /api/admin/users/:id/role`

后台接口继续按角色映射出的权限做服务端校验；隐藏导航不是权限边界。

## 审核与访问边界

- 新帖子固定以 `moderation_status=pending`、`review_status=pending` 创建。
- 审核通过后才会变为公开；待审核、下架和已删除内容不会从公开列表、详情、分区、热门或互动接口泄漏。
- 审核员不按发布者、内容类别或负责范围拆分权限；任意审核员均可处理全局队列中的全部待审内容。
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
npx wrangler whoami
npm run pages:deploy
```

后端由服务器快进 GitHub `main` 后执行测试并重启 `campuswall.service`。生产环境切换时还必须核对：Pages 自定义域名 Active、CNAME `wall` 指向 Pages、A `api-wall` 保持橙云、Origin Rule 精确表达式与 8443 动作、Origin CA 证书/SAN/私钥权限、UFW Cloudflare-only 网段、`ALLOWED_ORIGINS` 与 Secure Cookie。详细命令、上线顺序和回滚见 [HANDOFF.md](./HANDOFF.md#17-生产部署标准流程)。

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

发布后还应验证 `https://wall.zongtech.xyz/`、一个 SPA 深链接、`https://api-wall.zongtech.xyz/health`、正式 Origin 的 CORS 预检与恶意 Origin 拒绝。重点回归：任意用户名注册、Cookie 刷新保持登录、游客普通发帖待审、失物招领登录保护、四种角色权限、角色变更后的旧会话失效、所有审核员可处理全部待审内容、待审核内容与附件不公开，以及桌面和手机端导航与表单。
