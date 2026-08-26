# 龙华区观澜中学校园墙——项目交接文档

> - 最后更新：2026-08-27
> - 文档版本：3.6
> - 适用分支：`main`
> - 代码仓库：<https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan>
> - 学校名称：龙华区观澜中学
> - 最近一次架构基线：Cloudflare Pages 前端 + 独立 HTTPS API 源站
> - 最近一次生产发布：2026-08-27 01:57 CST（应用提交 `a521da64f4bf444a3417459bffbe56e7747fd6b2`）

本文档用于开发、审核、运维和应急接管。它说明当前产品规则、代码结构、账号权限、审核流程、数据位置、本地运行、生产部署、备份恢复和常见故障。功能细节以 `main` 分支代码为最终事实来源；每次完成新功能、修复、主要交互或运维变更，都必须在同一提交同步更新本文件，不能把交接文档留到后续补写。

## 1. 交接原则与敏感信息

以下信息绝不能写入 Git、工单、截图或公开聊天：

- SSH 密码、私钥和宝塔面板密码；
- `SECRET_KEY`、数据库密码、Cookie 或会话值；
- 飞书/企业微信群机器人 Webhook 与签名 Secret；
- 飞书登录应用的 App Secret 与 `FEISHU_LOGIN_CHAT_ID`；
- SMTP 密码与完整发信账号；
- 学生个人信息、未公开内容、举报/反馈正文和生产日志原文；
- 生产数据库、头像和上传文件的未加密备份。

服务器地址、账号、密码和第三方机器人密钥应通过独立密码管理器交接。仓库只保留变量名、路径、操作命令和脱敏示例。发现凭据曾被提交到 Git 时，不能只删除文件，必须立即轮换该凭据并检查历史记录。

接手人在取得权限后的第一天应完成：验证 SSH 密钥登录、轮换任何曾通过聊天或临时渠道传递的密码、检查生产环境文件权限、确认至少两位可登录的管理角色、执行一次只读备份校验，并记录操作人和时间。不要在尚未验证新凭据可用前关闭旧登录方式。

## 2. 当前环境与来源

| 环境 | 位置 | 用途 |
| --- | --- | --- |
| 本机工作区 | `<本机工作区>\campuswall-react` | 开发、测试、构建与提交；实际绝对路径由接手人自行记录，不写入公开仓库 |
| GitHub | `ZONGRUICHD/Campus-Wall-For-GuanLan` 的 `main` | 唯一代码交付分支 |
| 正式前端 | `https://wall.zongtech.xyz` | Cloudflare Pages 自定义域名，所有浏览器页面请求从这里进入 |
| Pages 项目 | `guanlan-campus-wall` | 前端静态构建托管；默认地址为 `https://guanlan-campus-wall.pages.dev` |
| 正式 API | `https://api-wall.zongtech.xyz` | Cloudflare 代理后的后端、健康检查与受保护静态资源入口 |
| 生产项目目录 | `/www/wwwroot/campuswall-react` | 服务器当前检出的代码 |
| 前端构建目录 | `frontend/dist` | 本机/CI 的临时 Pages 上传产物；不再由生产 Nginx 对外托管 |
| 后端工作目录 | `/www/wwwroot/campuswall-react/backend` | Node/Express 服务工作目录 |
| 后端环境文件 | `/etc/campuswall/backend.env` | 生产变量与密钥，权限必须为 `root:root 600` |
| systemd 服务 | `campuswall.service` | 后端常驻与自动重启 |
| 后端监听 | `127.0.0.1:5412` | 只允许 Nginx/本机访问 |
| API Nginx vhost | `/www/server/panel/vhost/nginx/api-wall.zongtech.xyz.conf` | 在源站 `8443/tcp` 接收 Cloudflare HTTPS 回源 |
| Origin CA 证书 | `/etc/campuswall/tls/api-wall.zongtech.xyz.pem` | 仅用于 Cloudflare 到源站的 TLS；不是浏览器直连证书 |
| Origin 私钥 | `/etc/campuswall/tls/api-wall.zongtech.xyz.key` | 只能保存在源站/加密备份，必须 `root:root 600`，严禁入 Git |
| Cloudflare 实 IP配置 | `/etc/campuswall/cloudflare-realip.conf` | 只信任 Cloudflare 官方网段提供的 `CF-Connecting-IP` |
| PostgreSQL 数据库 | `campus_wall` | 账号、留言、权限、通知、审计等结构化数据 |
| 生产备份根目录 | `/www/backups/campuswall` | 每次上线前和定期备份 |

当前仓库中的生产基线：

- 正式页面入口只能使用 `https://wall.zongtech.xyz`；旧 IP 的 80 端口只保留 308 重定向，不作为发布或健康判定依据；
- 前端由 Cloudflare Pages 项目 `guanlan-campus-wall` 托管，`wall.zongtech.xyz` 使用 CNAME 关联该项目；
- API 由 `api-wall.zongtech.xyz` 的橙云代理进入 Cloudflare，再由 Origin Rule 把边缘 HTTPS 443 回源到 Nginx 8443；源站 443 被同机既有服务占用，不能为了本项目抢占或停止该服务；
- 不得恢复旧名 `api.wall.zongtech.xyz`：当前 Free 区域的 Universal SSL 通常覆盖根域与一级通配符 `*.zongtech.xyz`，不会覆盖再嵌套一层的 `api.wall.zongtech.xyz`；`api-wall.zongtech.xyz` 是一级子域，可由现有边缘证书覆盖；
- 真实上线起点：`2026-08-25T01:48:50+08:00`，由 `SITE_LAUNCHED_AT` 提供；这是首次验证公网 HTTP 200 的时间，不得在普通重启或发布时重置；
- 服务器时区应保持 `Asia/Shanghai`（用 `timedatectl` 核对）；公告、反馈等 JSON 的无时区时间字符串直接使用服务器本地时间，时区错误会造成展示和排序歧义；
- 生产 Git 远端应指向 `ZONGRUICHD/Campus-Wall-For-GuanLan`，部署来源只允许 `origin/main` 的快进提交；
- 最新实际状态必须以生产机上的 `git rev-parse HEAD`、`systemctl status campuswall.service` 和 `/health` 为准，不能只凭本文档日期判断。

当前前端发布入口由 Cloudflare Pages 决定，源站 Nginx 只处理 API、健康检查、受控静态资源和旧 IP 的确定性重定向。仓库内 `deploy/nginx-campuswall-api.conf`、`deploy/nginx-campuswall-legacy-redirect.conf`、`deploy/cloudflare-realip.conf`、`wrangler.jsonc`、`frontend/.env.production` 与 `frontend/public/_headers` 是该架构的权威基线。源站 `5412/5432` 永不公开，`8443` 只允许 Cloudflare 官方 IPv4/IPv6 网段访问；不要把它开放给全网。

## 3. 系统架构

请求链路：

```text
浏览器
  ├─ wall.zongtech.xyz ─────────────> Cloudflare Pages ──> frontend/dist
  └─ api-wall.zongtech.xyz ─────────> Cloudflare 代理（边缘 HTTPS 443）
                                      └─ Origin Rule：目的端口改写为 8443
                                         └─ 源站 Nginx TLS :8443
                                            └─ Node/Express :5412
                                               ├─ PostgreSQL
                                               ├─ backend/static
                                               ├─ backend/help、backend/logs
                                               ├─ 飞书/企业微信机器人（可选、已实现）
                                               └─ SMTP 邮箱（可选：验证信、用户通知、审核提醒）
```

Cloudflare Pages 只托管公开前端构建；登录、发帖、审核、上传和数据均由同一源站后端处理。浏览器构建中的 API 与静态资源基址分别固定为 `https://api-wall.zongtech.xyz` 和 `https://api-wall.zongtech.xyz/static/`。生产 Nginx 不再返回前端 `index.html`，只反向代理后端允许的路径，并对其他路径返回 404。

Cloudflare Origin Rule 的精确表达式必须为：

```text
(http.host eq "api-wall.zongtech.xyz" and cf.edge.server_port eq 443)
```

动作只覆盖目标端口为 `8443`。同时匹配主机名与边缘 443 可以避免把客户端显式访问其他边缘端口的请求也重写到源站 8443。`api-wall.zongtech.xyz` 的 DNS 记录必须保持橙云代理；一旦改成 DNS only，Cloudflare Origin CA 证书不会被普通浏览器信任，且源站 UFW 会拒绝非 Cloudflare 来源。

不要用 Nginx `root`/`alias` 直接公开 `backend/static/uploads` 或 `backend/static/tiny_files`，否则会绕过待审核附件和失物招领登录保护。真实客户端 IP 只能在请求确实来自 Cloudflare 官方网段时从 `CF-Connecting-IP` 还原；相关信任边界由 `/etc/campuswall/cloudflare-realip.conf` 控制。

后端当前按**单实例进程**设计：`MessageStore` 会把消息与分区载入进程内缓存，并使用进程内锁。不要未经架构改造就启用 PM2 cluster、多个 systemd 实例或横向多副本，否则不同进程的缓存可能短暂不一致。正式环境的单个 `campuswall.service` 实例符合当前模型。

生产 systemd 服务以 `campuswall:campuswall` 身份运行，不以 root 运行。由于宝塔安装的 Node 可能位于受 `ProtectHome=true` 保护的目录，`deploy/prepare-runtime.sh` 会把经过确认的 Node 可执行文件复制到 `/usr/local/lib/campuswall/node`。服务同时启用 `NoNewPrivileges`、`ProtectSystem=full`、空 capability 集、1536 MiB 内存上限和 45 秒停止超时；修改运行目录或上传目录时必须同步确认服务账号可写权限。

## 4. 技术栈

- 前端：React 19、React Router 7、Vite 8、Tailwind CSS 4、Three.js、Bootstrap Icons、DOMPurify；
- 后端：Node.js 22.12+（推荐当前 LTS）、Express 4、`pg`、`multer`、`sharp`、`cookie-parser`、`compression`、`express-rate-limit`；
- 数据库：PostgreSQL 17+；生产实测为 17.11，本地新环境推荐 18；
- 媒体处理：图片由 Sharp 处理，视频依赖系统 `ffmpeg`；
- 前端托管与边缘代理：Cloudflare Pages、Cloudflare DNS/Origin Rules；
- 源站代理：Nginx（HTTPS 8443）；
- 进程管理：systemd 的 `campuswall.service`；
- 密码与会话：Node `crypto.scrypt` 密码哈希、HMAC 签名 Cookie、`session_version` 会话失效机制。

## 5. 仓库结构

```text
campuswall-react/
├── frontend/
│   ├── src/App.jsx                 # 路由与前端权限守卫
│   ├── src/components/Layout.jsx   # 前台桌面/手机顶部与底部导航
│   ├── src/components/AdminShell.jsx
│   ├── src/contexts/               # 用户、平台、主题、提示状态
│   ├── src/modules/registry.jsx    # 编译期功能模块、路由与导航注册表
│   ├── src/pages/                  # 前台页面
│   ├── src/pages/admin/            # 后台页面
│   └── dist/                       # 构建产物，不作为源码手改
├── backend/
│   ├── src/server.js               # 服务入口、中间件、路由挂载与清理任务
│   ├── src/config.js               # 环境变量解析与生产安全检查
│   ├── src/routes/                 # public/wall/users/admin/upload/staticFiles
│   ├── src/services/               # 数据、认证、权限、通知和媒体处理
│   │   ├── contentCategories.js    # 帖子/表白墙审核展示分类的唯一后端口径
│   │   ├── moduleRegistry.js       # 后端允许公开的模块 manifest
│   │   └── noticeStore.js          # 公告规范化、ID 迁移、公开过滤与排序
│   ├── scripts/                    # 数据迁移、数据库等待、管理员恢复
│   ├── test/                       # Node 内置测试
│   ├── static/                     # 上传、缩略图、头像等运行数据
│   ├── help/                       # 当前反馈/举报 JSON 运行数据
│   └── logs/                       # 后端错误日志
├── deploy/
│   ├── campuswall.service          # systemd 基线
│   ├── nginx-campuswall.conf       # 旧同源部署参考，不是当前正式前端入口
│   ├── nginx-campuswall-api.conf   # 当前独立 API vhost 基线（TLS 8443）
│   ├── nginx-campuswall-legacy-redirect.conf # 旧 IP 入口的 308 重定向基线
│   ├── cloudflare-realip.conf      # Cloudflare 官方来源网段与真实 IP 恢复
│   └── prepare-runtime.sh          # 运行账号、Node 路径、数据目录准备
├── wrangler.jsonc                  # Pages 项目名与构建目录
├── frontend/.env.production        # 浏览器可见的正式 API/静态资源基址
├── frontend/public/_headers        # Pages 响应安全头与缓存策略
├── docs/
│   ├── MODULE_DEVELOPMENT.md       # 新板块、版本化 API 与维护流程
│   └── NOTIFICATION_INTEGRATION.md # 四类消息平台的接入/可靠性说明
├── README.md                       # 产品与开发总览
├── README_BAOTA_DEPLOY.md          # 宝塔部署教程
├── SECURITY.md                     # 漏洞报告与敏感数据规则
└── HANDOFF.md                      # 本交接文档
```

`artifacts/` 是本机辅助产物，不属于项目交付内容，除非经过人工确认，否则不要提交。

`README_BAOTA_DEPLOY.md` 保留了早期宝塔/PM2/Nginx 同源部署背景，只能作为历史参考；当前生产的权威部署资产是 `wrangler.jsonc`、`frontend/.env.production`、`frontend/public/_headers`、`deploy/campuswall.service`、`deploy/nginx-campuswall-api.conf`、`deploy/nginx-campuswall-legacy-redirect.conf`、`deploy/cloudflare-realip.conf`、`deploy/prepare-runtime.sh` 和本文档。若旧文档与这些文件冲突，以当前代码、Pages 配置和 systemd 流程为准。

## 6. 产品功能与重要边界

- 游客可以匿名发布普通校园墙内容，无需学号验证；
- 学生可用飞书登录（须为指定校园墙飞书群成员），也可用用户名密码注册；密码注册需审核员在后台通过后才能登录。后台人员仍由超级管理员创建，使用 `/admin/login`；
- 游客与没有 `content.publish.bypass_review` 的账号初次发布普通校园动态时进入 `/admin/wall`；具备该 capability 的账号立即公开，不进入队列；
- 表白墙使用 Three.js 实例化便签组成爱心；支持射线拾取、悬停/按压、精选轮播和波纹突出，游客/无免审能力账号初次提交后进入 `/admin/confessions`，具备免审 capability 的账号立即公开；
- `/p` 从真实公开消息标签聚合目录，支持搜索、排序与分页；`/p/:tag` 只返回标签数组精确包含该值的公开消息；
- 首页公告使用标题、摘要、正文、优先级、状态与发布时间模型；后台支持草稿、立即/定时发布、归档恢复、搜索、筛选和实时预览；
- 主题支持跟随系统/浅色/深色三态和海蓝、樱粉、紫藤、青绿、暖橙五种强调色；
- 失物招领页面和公开列表可未登录浏览；填写、评论和点赞必须登录。初次发布立即对所有人可见，不进入审核队列，且以登录身份发布以便追溯；
- 登录用户可维护昵称、头像、简介，查看自己的帖子、评论、收藏和通知；
- 后台发布/审核能力按 capability 判断；默认三种管理角色免审，普通 `user` 也可被超级管理员逐项授予后台能力；帖子与表白墙是两个互斥展示队列，所有 `reviewer` 仍使用锁定的同一角色模板、完全同权；
- 任意内容被管理端明确退回待审后会设置 `review_hold`，并显示在当前内容分类对应的队列；作者编辑不能自行重新公开；
- 反馈与举报只在后台处理，前台不提供公开进度查询。

主要前端路由：

| 路由 | 页面 | 访问条件 |
| --- | --- | --- |
| `/` | 首页、真实上线时长、校园公告、常用入口 | 公开 |
| `/wall` | 校园动态与发布入口 | 浏览公开；发帖总开关开启时游客和用户都可发，当前不能单独关闭游客发帖 |
| `/wall/message/:id` | 帖子详情 | 仅公开状态可由游客读取 |
| `/confessions` | Three.js 表白墙便签 | 公开浏览和发布；登录用户可改为展示昵称；游客/无免审能力账号待审，具备免审 capability 的账号立即公开 |
| `/lost-found` | 失物招领 | 浏览公开；填写必须登录；初次发布后立即可见 |
| `/p` | 真实标签话题目录；搜索、热度/更新时间/名称排序、分页 | 公开；包含失物招领标签 |
| `/p/:tag` | 精确标签下的公开动态 | 公开；失物招领标签也可未登录浏览 |
| `/help`、`/help/form` | 帮助与反馈 | 公开，提交受来源与限流保护 |
| `/rules` | 社区公约 | 公开 |
| `/login` | 飞书登录与用户名密码登录/注册 | 公开；飞书立即进入；密码注册待审后才能登录 |
| `/me` 及 `/me/*` | 个人资料、帖子、评论、收藏、通知 | 必须登录 |
| `/user/:id` | 公开用户主页 | 公开字段与公开帖子 |
| `/admin/login` | 后台登录 | 任一拥有后台 capability 的账号可建立后台会话；已有有效 `user_session` 也可直接验证 |
| `/admin` | 后台概览 | `dashboard.read` |
| `/admin/wall` | 普通帖子审核；包含非表白内容及结构化失物招领 | `content.queue.read`；具体动作再查对应 capability |
| `/admin/confessions` | 表白墙审核；仅当前标签精确包含 `表白` 且不是结构化失物招领的内容 | `content.queue.read`；审核需要 `content.review` |
| `/admin/notice` | 公告管理 | `notice.read`；创建/编辑/归档分别需要 `notice.create/update/delete` |
| `/admin/users` | 用户、角色与个人权限 | `users.read`；角色/个人权限分配仅超级管理员根能力 |
| `/admin/comments` | 评论管理 | `content.comment.read`；具体动作单独授权 |
| `/admin/trash` | 内容回收站 | `content.trash.read`；恢复/永久删除单独授权 |
| `/admin/settings` | 平台设置 | `settings.read`；验证码/社区写入单独授权 |
| `/admin/feedback`、`/admin/report` | 反馈与举报 | `feedback.read` / `report.read`；处理单独授权 |
| `/admin/log`、`/admin/audit`、`/admin/error_log` | 日志与审计 | `logs.legacy_admin.read` / `audit.read` / `logs.error.read` |

前端路由守卫只负责导航体验。接口能否访问必须以 Express 的登录、可信来源和权限检查为准；新增后台页面时要同时增加前端守卫、后台菜单和后端权限，不能只完成其中一层。

### 6.1 前端视觉、主题与动效

- 视觉基线是 Apple/SwiftUI 风格，而不是对 Apple 官网组件逐像素复制。权威设计变量在 `frontend/src/apple-design-tokens.css`，`frontend/src/styles.css` 只建立应用语义变量和页面样式；新增颜色、圆角、字号、间距前优先复用已有 token；
- 字体栈优先系统字体、SF Pro 与苹方；界面采用克制阴影、细分隔线、圆角卡片、半透明导航和蓝色主操作。浅色与深色必须分别验收，不能通过在浅色页面中固定黑色区域来伪造深色主题；
- `ThemePicker` 已提供完整主题入口：`theme-preference` 保存 `system/light/dark`，`theme-palette` 保存 `blue/rose/violet/green/orange`；用户可在界面中随时恢复“跟随系统”，不需要清 localStorage。解析后的明暗写入 `<html data-theme>`，强调色写入 `<html data-palette>`，同时更新 `meta[name=theme-color]`；同源标签页通过 `storage` 事件同步，存储不可用时安全回退；
- 所有页面组件已经通过 `React.lazy` 按路由拆分。页面路径变化时由 `.route-transition` 提供轻量进入动效，路由切换同时回到页面顶部；
- CSS 和 Three.js 场景都尊重 `prefers-reduced-motion`，毛玻璃降级尊重 `prefers-reduced-transparency`，高对比偏好使用 `prefers-contrast: more`。新增动效必须是非阻塞、可中断的辅助反馈，不能影响点击、键盘焦点或阅读；
- 响应式基线：不宽于 1080px 时启用底部五栏导航（首页、动态、表白、失物、我的）；不宽于 768px 时后台侧栏折叠、共享 Modal 呈底部 sheet；不宽于 520px 时失物字段单列；不宽于 360px 时品牌和发帖文案进一步收缩。布局已处理 iOS safe-area；新增固定按钮、sheet 或底部表单时必须继续加上 `env(safe-area-inset-*)`，并在窄屏、横屏及软键盘弹出场景验收；
- 共享 `Modal.jsx` 通过 Portal 挂到 `document.body`，负责背景锁滚动、焦点圈闭、Escape/遮罩关闭、关闭后恢复原焦点。新增弹层优先复用它；当前没有禁用 Escape/遮罩关闭的配置，如果业务不允许这种关闭方式，必须先扩展 Modal API，并继续保留可见关闭按钮与焦点管理；
- `styles.css` 是长期演进的层叠文件：前部有基础主题/Modal/media，约 3087 行后是当前 SwiftUI 覆盖，底部导航与路由动效在后半部，表白墙新版样式位于更后。后定义的同名 selector 会覆盖前文，仅修改早期规则可能看似无效；`mobile-menu-toggle/mobile-nav-drawer` 等规则目前没有 JSX 引用，清理前先用 `rg` 和浏览器回归确认；
- 图标来自本地 Bootstrap Icons 子集，不依赖外网字体。新增图标后必须同步子集文件并在生产构建中确认显示，避免再次出现空方框。网站 favicon 与顶栏品牌使用 `frontend/public/school-badge.webp` 校徽，不要再换回聊天气泡；
- 页面标题只保留一行主标题。不要使用 `page-kicker` + `h1`，也不要在主标题下再挂说明段形成双行标题。提示放到操作按钮旁或社区公约。后续新功能同样遵守；
- 深色主题使用抬升后的 grouped 底色（约 `#0e0e10`）和略浅的卡片（约 `#1c1c1e`），保留很轻的环境阴影与细分隔线，正文不要用纯白；不要回到纯黑、无阴影的硬边卡片。`meta[name=theme-color]` 深色值为 `#0e0e10`。

### 6.2 校园动态与发布器

- `/wall` 的动态流参考微信朋友圈的熟悉阅读层级，但只参考“作者 → 正文 → 媒体 → 时间/状态 → 互动/讨论”的信息组织，不复制微信品牌、图标、颜色、文案或像素尺寸。页面继续使用本项目的 Apple/SwiftUI token、圆角、材质、焦点样式和浅深色主题；后续不能为了更像参考图而引入品牌素材；
- 动态页顶部只保留栏目标签与主标题，搜索、筛选和排序紧随其后；旧版说明副标题与“当前已展示/全部分类/最新发布”三格概览已删除，不应以另一组重复摘要重新引入；
- `Wall.jsx` 只为动态列表传入 `MessageCard variant="moments"`。详情、个人发布、收藏和其他复用 `MessageCard` 的页面默认仍使用通用卡片；修改朋友圈式布局前应先确认目标 selector 带有 `.is-moments`，避免样式泄漏到后台和详情页；
- 桌面端头像/作者位于卡片顶部，正文、投票、标签、媒体、发布时间和操作组成连续主列；窄屏缩小头像与左侧留白，不能压缩正文到不可读宽度。置顶、精华、待审、下架、已编辑、匿名或公开身份仍按真实数据展示，视觉重排不得改变公开性或审核状态；
- 媒体网格是稳定产品规则：1 个媒体保留自然比例并限制最大宽高；2 个和 4 个媒体使用两列；3 个以及 5–9 个媒体使用三列；超过 9 个时信息流只渲染前 9 个，第 9 个覆盖 `+N` 剩余数量。点击任一可见项必须把完整附件数组和正确索引交给预览器，因此第 9 项仍能继续浏览第 10 项及以后附件；音频、视频和其他文件在相同网格中保留明确的类型、播放或查看语义；
- 图片点击后使用微信式沉浸黑色灯箱，不再出现文件管理器式白色标题窗或 UUID 文件名。灯箱支持左右按钮、键盘方向键、触摸滑动、项目计数、相邻图片预载、单击隐藏工具栏、Escape 退出、焦点圈闭和关闭后焦点恢复；加载失败时提供重试/新窗口。保存操作使用同一鉴权静态文件路由的 `?download=1` 直接流式下载并返回 `Content-Disposition: attachment`，避免在手机浏览器中把大附件完整读入 Blob。PDF 因源站 `SAMEORIGIN` 不能嵌入跨域 iframe，只提供打开或保存；视频在当前项内内联播放。工具栏与底部操作必须适配 safe-area，并尊重 reduced-motion；
- 动态操作条保留赞、踩、评论、分享、详情、举报以及作者自己的编辑/删除能力。紧凑布局可以折叠次要文字，但不能删掉功能或依赖颜色表达状态；互动摘要和评论区沿用真实计数与后端权限，待审或下架内容继续禁止公开互动；
- 发布器支持图文动态与投票，正文最多 2000 字、话题最多 8 个。登录用户默认匿名，可在发布器切换为展示昵称；游客只能匿名。单条动态最多累计选择 20 个图片、视频或音频文件；多次打开文件选择器会追加到现有选择，超过上限只保留剩余可用数量并给出提示。每项必须有本地预览或类型占位、可理解名称和独立移除按钮，删除后可以继续添加；
- 图片和视频本地预览使用临时对象 URL，组件卸载或文件替换时必须释放，避免连续选图导致内存增长。客户端只做预览与数量体验，服务端的文件类型、大小、总存储、并发和鉴权仍是安全边界；大于 5 MiB 的文件沿用分片上传，其余直接上传，上传进度和失败信息必须可见；
- 新上传的 JPEG、PNG、GIF、WebP 在服务器按真实内容解码并统一输出 WebP：自动纠正 EXIF、移除元数据，最长边默认 2048、初始质量 80、主图硬上限 1.5 MiB；透明 PNG 保留透明通道，GIF/动画 WebP 只保留第一帧，超过 200 帧拒绝。缩略图最长边 320、质量 68、目标不超过 160 KiB。直传和分块合并共用同一处理链；成功后只保留压缩主图和缩略图，原始图片与已完成分片立即删除，失败也必须清理临时文件。非图片附件按文件头校验真实类型，视频转码失败会删除并返回 400；同一分片会话合并互斥，禁止并发生成多份输出。该规则只影响新上传，历史文件不会自动转换或删除；评论附件接口当前禁用。
- 草稿只保存可序列化的正文、话题、动态类型和投票设置，不保存浏览器选择的本地文件。关闭后恢复草稿时必须明确附件需要重新选择，不能假装已持久化；发布成功才清空草稿和文件，失败时保留当前编辑状态以便重试；
- 移动端至少在 360/520/768px、横屏、软键盘弹出和 iOS safe-area 下验证发布 sheet、三列媒体、移除按钮、操作条和评论区，不允许横向滚动或被底部导航遮挡。浅色、深色、高对比、`prefers-reduced-motion`、`prefers-reduced-transparency` 均需单独验收；键盘用户必须能按可预测顺序完成打开、切换类型、编辑、添加/移除、发布和取消，状态变化需要文本或可访问名称，触控目标至少 44×44px。

### 6.3 表白墙

- `/confessions` 公开可访问；当前专用页面限制便签最多 280 字，并提交固定标签 `表白`。游客始终匿名；登录用户默认匿名，可改为展示昵称。游客和无免审 capability 的账号初次提交时创建为 `pending + pending`，写入 outbox 并显示在 `/admin/confessions`；具备 `content.publish.bypass_review` 的账号直接为 `visible + approved`，不入队；
- 页面标题只保留「表白墙」一行。提交区只保留「写一张便签」；审核/隐私提示放在提交按钮旁，不要用 kicker 或双行说明填回空白；
- 页面一次读取最近 72 条表白数据，但只展示 `moderation_status=visible`、`review_status=approved` 且正文非空的记录。待审、下架、删除或其他非公开状态内容不得进入 Three.js 场景；
- Three.js 爱心使用一个 `InstancedMesh` 承载最多 72 条真实便签并补足至少 56 个视觉槽位；Raycaster 将点击命中映射回真实便签，悬停、按压与激活状态有独立缩放/深度反馈。精选切换使用约 620ms 的波纹与心跳式突出，矩阵按需更新而非永久空转；Canvas 不可用时显示静态爱心，右侧/下方的普通便签列表始终保留完整键盘与触控入口；
- 每次进入/挂载表白墙时从当前便签中随机选取 3–5 条（不足 3 条时全选），本次停留期间集合保持稳定；精选集合按发布时间从旧到新轮播，每 4 秒突出下一条。鼠标悬停爱心、打开便签、页面进入后台、场景离开视口、系统要求减少动态或不足两条时暂停；页面恢复后只延续剩余过渡，不补播离屏帧；
- 游客/无免审能力账号提交成功后页面返回待审回执，不会立即重新拉取为可见便签，也不会出现在爱心中；审核通过后下一次加载才可见。具备免审能力的账号可立即公开。调整抓取数量、轮播顺序或随机算法时必须保留“按时间播放”和 reduced-motion 语义。

### 6.4 失物招领

- `/lost-found` 页面和 `GET /api/user/lost-found` 公开可浏览，只返回 `visible + approved`。前端不再用 `requiresUser` 挡住整页。`POST /api/user/lost-found` 必须登录；未登录填写会引导 `/login` 并保留回跳。校园动态混排列表默认仍不插入失物招领，避免和普通动态混在一起；话题目录与详情允许未登录查看失物招领；
- 启事分“寻物”和“招领”。当前页面约束为：物品名必填且最多 60 字、地点必填且最多 80 字，时间最多 60 字、公开联系方式最多 80 字、说明最多 500 字；联系方式可留空并通过评论沟通，页面应提醒用户保留未公开核验特征；
- 后端最终约束目前更宽：只强制合法 `kind` 和非空物品名，物品/地点/时间/联系/说明上限分别为 100/120/80/160/2000，地点在 API 层可为空。后端会忽略客户端拼接的正文和标签，依据结构化字段重新生成可读正文、`lost_found` 数据与标签；因此后端是数据权威，但地点必填和较短上限目前还不是安全边界；
- 登录用户发布失物招领时 `anonymous=false`，便于追溯。初次提交后的结构化字段、可读正文和标签直接以 `visible + approved` 保存并立即公开，不进入审核队列或审核通知 outbox；被管理端退回后则遵守 `review_hold`，作者编辑不能自行重新公开。评论、赞踩仍要求登录；
- 列表每页 24 条，支持全部、寻物、招领和已找回筛选。当前勾选“已找回”会发布一条新的状态启事，不是就地修改旧启事；以后若实现真正闭环，应增加原帖所有权校验和状态更新 API；
- 联系方式属于面向已登录用户展示的数据，仍需遵守学校隐私规范；不要填写身份证号、家庭地址等敏感信息。当前专用失物表单不支持附件；以后增加附件时必须沿用登录鉴权的静态文件链路，不能让 Nginx 直接公开。

### 6.5 登录回跳与角色导航

- 前台登录页主按钮为飞书官方授权；电脑扫码、手机跳转飞书 App。也提供用户名密码登录与注册：注册成功不签发会话，账号 `status=pending`，审核员通过后才能 `POST /api/user/login`。注册时可选填邮箱并勾选接收消息；验证邮件走 SMTP，验证前不发通知。已登录用户可在 `/me` 添加或更换邮箱、开关邮件通知，以及连接飞书账户。受保护页面跳转登录时保留 `pathname/search/hash`，成功后回到原目标，默认目标为 `/me`。飞书失败时回 `/login?feishu_error=` 或绑定场景下的 `/me?feishu_error=`，由页面映射文案；
- 飞书登录与审核提醒 Webhook 不是同一套应用。登录按固定 `chat_id` 校验群成员，机器人必须在群内；步骤见 `docs/FEISHU_LOGIN.md`。`GET /api/user/feishu/start?intent=bind` 仅已登录用户可用：把当前账号挂上 `feishu_open_id`（冲突则拒绝），再由机器人把该 `open_id` 拉进登录校验群。绑定失败不能假装已进群；
- 用户名密码用于前台 `POST /api/user/login`（`active` 且有密码哈希的账号）以及 `/admin/login`。待审 `pending` 即使用户名密码正确也不得登录；无密码的飞书账号不能走密码登录；
- 验证码 provider 只支持 Cloudflare Turnstile、Google reCAPTCHA 或关闭；后台密码登录当前不强制验证码。不能通过绕过后端验证临时放行；
- 任一登录账号只要后端返回至少一个 capability，顶部就显示后台入口；这包括获得个人授权的普通 `user`，不再把角色名当成入口条件。入口目标由其第一个可访问模块决定；
- 后端 `authenticatedAccount` 会按顺序解析 `admin_session` 与 `user_session`，因此有效前台会话可直接验证后台 capability；后台登录仍可建立独立 `admin_session`。这不是跳过鉴权：每个后台请求都重新读取数据库账号、核对 `session_version` 并检查动作级 capability；
- 后台侧栏和路由守卫按后端返回的 `capabilities` 过滤；无权访问某页时转到首个有权目的地或首页。角色名称、顶部入口和隐藏菜单都不是授权边界；
- 权限、角色、状态或密码变化造成 `session_version` 递增后，已有两类 Cookie 都会在下一次请求失效。不能用前端缓存的旧 capability 继续操作。

### 6.6 真实上线时长

- 首页运行时长不从构建日期、Git 提交或浏览器本地时间起算。后端公开配置返回 `site_launched_at` 与 `server_time`；`Home.jsx` 先计算客户端相对服务器的时钟偏移，再从真实上线起点每秒更新天/时/分/秒；
- 权威值是生产 `/etc/campuswall/backend.env` 的 `SITE_LAUNCHED_AT=2026-08-25T01:48:50+08:00`。服务重启、普通发布、数据库恢复、换域名和文档更新都不能重置；
- `Home.jsx` 的辅助 tooltip 和 `PlatformContext.jsx` 的故障 fallback 当前也含同一基准时间。若经证据确认上线时间需要更正，应在同一代码提交同步这两处、`backend/.env.example` 与本文档；部署变更窗口再通过服务器/密码管理渠道单独更新不入 Git 的生产环境文件，并记录服务器时间偏移验收，避免数字正确而说明文字错误。

### 6.7 模块注册表与扩展 API

- `frontend/src/modules/registry.jsx` 是编译期页面、支持路由与导航元数据的集中注册表；`App.jsx`、`Layout.jsx` 与 `PlatformContext` 从该注册表派生启用路由和导航，不要在三处分别复制同一板块；
- `backend/src/services/moduleRegistry.js` 是服务端允许清单，`GET /api/modules` 返回 `schema_version` 以及安全字段 `id/version/label/description/route/api_prefix/navigation/requires_login/enabled`，使用五分钟公开缓存。响应不能包含可执行脚本、任意 import 地址、密钥或服务端路径；
- 浏览器只会启用“已经编译进前端”且同时获后端允许的模块。manifest 请求失败时使用编译期安全默认集合，服务端响应不能远程注入代码；
- 新板块必须同时注册前端路由/导航元数据、后端 manifest、版本化 API、动作级 capability（如需要后台）、错误/空状态和测试。完整清单、推荐目录和 `/api/modules` 契约见 `docs/MODULE_DEVELOPMENT.md`；
- 当前 registry 是同仓构建期扩展机制，不是运行时插件市场。更改模块 API 时优先新增 `/api/<module>/v2` 或保持兼容适配，不能静默改变旧消费者语义。

## 7. 统一账号、角色与权限

PostgreSQL `users` 表是普通登录和后台登录的唯一账号源。旧 `backend/managers.json` 只作为一次性迁移输入，不再是运行时权限数据库。

注册与登录规则：

- 对外 `POST /api/user/register` 重新开放，但只创建 `role=user`、`status=pending` 的账号，不签发会话 Cookie。可选 `email` 与 `email_notify`；邮箱须验证后才发送站内通知的副本；
- 学生/普通用户也可走飞书 OAuth：`GET /api/user/feishu/start` 与 `GET /api/user/feishu/callback`。服务端用 HMAC `state` 防 CSRF，并用 `FEISHU_LOGIN_CHAT_ID` 核对群成员，不按群名判断。飞书登录仍直接创建/启用普通账号。已登录用户可用 `intent=bind` 把飞书挂到当前账号并尝试拉群；
- 飞书用户写入 `feishu_open_id`（唯一）与 `feishu_user_id`，密码可空；用户名为 `fs_` + `open_id` 的短哈希，昵称用飞书姓名。密码账号绑定飞书后保留原用户名；
- `users` 表另有 `email`、`email_verified_at`、`email_notify`、`pending_email` 与验证令牌哈希；已验证邮箱唯一。SMTP 未配置时注册仍成功，只是不发验证信。验证链接必须打到 API 源站，可用 `PUBLIC_API_URL`，否则从 `FEISHU_REDIRECT_URI` 推导，生产前台域名会回退到 `https://api-wall.zongtech.xyz`；
- `POST /api/user/login` 与 `POST /api/admin/login` 查询同一条用户记录。密码登录要求 `status=active` 且存在密码哈希；待审账号在密码正确时返回明确的审核中错误，不签发会话。后台登录还要求至少一项 capability；
- 后台人员由超级管理员 `POST /api/admin/users` 创建，禁止创建普通 `user`，禁止自己用该接口重复占用同名账号，并保留至少一名启用超级管理员的既有规则；
- 用户名先做 NFKC 规范化和首尾空格清理，长度 2–24 个 Unicode 字符；
- 只允许中文/其他 Unicode 字母、数字、点、下划线和短横线；
- 唯一性使用小写 `username_key` 判断，因此大小写不同不能注册成两个账号；
- 密码长度 8–128 个 JavaScript 字符，数据库只保存随机盐与 `scrypt` 哈希；无密码的飞书账号不能走改密接口；
- 是否能进入后台由生效 capability 决定，不再仅由角色名决定。
- 公开资料接口只返回启用账号的昵称、性别、简介、头像与注册时间，不含 `status`、用户名或角色；停用账号按不存在处理。
- 游客点赞/投票身份使用服务端 HMAC 签名的 `poll_voter` Cookie（`uuid.signature`）。未签名或被篡改的旧值在互动时会换发新令牌；只读页面不会为装饰状态签发 Cookie。

### 7.1 角色默认模板与个人覆盖

| 角色 | 默认能力 | 个人覆盖 | 必须保持的不变量 |
| --- | --- | --- | --- |
| `user` | 无后台默认能力 | 可 `allow` 或 `deny` | 可按需成为只读公告员、单项审核员等；不能获得根分配能力 |
| `reviewer` | 审核两个队列、非公开附件、发布免审/官方身份、公告全套、用户名密码注册通过/拒绝 | **锁定** | 所有审核员完全同权，不允许个人差异，也不能查看作者身份 |
| `admin` | 内容/评论/回收站、公告、反馈、举报、用户、设置、日志 | 可 `allow` 或 `deny` | 默认不能分配角色或个人权限；deny 可收窄默认能力 |
| `super_admin` | capability catalog 全部能力 | **锁定** | 永久全权，不能通过覆盖削弱或扩大 |

解析顺序必须固定为：

```text
角色默认 capability
  └─ 加入 user_permission_overrides.effect = allow
      └─ 移除 user_permission_overrides.effect = deny（拒绝最终优先）
          └─ 校验依赖关系并生成 effective capabilities
```

同一 capability 不能同时出现在 allow 和 deny。`reviewer` 与 `super_admin` 忽略并清理历史覆盖；角色改成或改出任意角色时都清空现有覆盖，避免旧授权在新职责中意外复活。`users.role.assign` 与 `users.permissions.assign` 是不可分配的根能力，只能来自 `super_admin` 角色模板。

### 7.2 capability catalog 与旧接口兼容

`backend/src/services/roles.js` 的 `permissionCatalogVersion=2` 是唯一事实来源。当前动作分组：

| 分组 | capability |
| --- | --- |
| 后台 | `dashboard.read` |
| 发布 | `content.publish.official`、`content.publish.bypass_review` |
| 审核 | `content.queue.read`、`content.review`、`content.author_identity.read`、`content.attachment.private.read` |
| 帖子/回收站 | `content.trash.read`、`content.message.pin/feature/hide/delete/restore/purge`、`content.media.repair` |
| 评论 | `content.comment.read/hide/delete/restore/purge` |
| 公告 | `notice.read/create/update/delete` |
| 反馈/举报 | `feedback.read/update`、`report.read/history.read/resolve` |
| 用户 | `users.read/profile.update/mute/status.disable/status.enable/password.reset` |
| 根安全 | `users.role.assign`、`users.permissions.assign`（不可作为覆盖分配） |
| 设置 | `settings.read/captcha.update/community.update` |
| 日志 | `logs.error.read`、`logs.legacy_admin.read`、`audit.read` |

catalog 同时声明 `risk`、`assignable` 与 `requires`。例如公告写操作依赖 `notice.read`，审核动作依赖 `content.queue.read`，永久删除依赖回收站读取。整组替换若产生缺依赖的生效集合，后端返回 `422 PERMISSION_DEPENDENCY_MISSING`，不能只依赖前端自动勾选。

对象范围与响应字段必须分开：`content.author_identity.read` 只决定在本来可见的审核对象中是否返回作者身份，绝不能扩大可枚举消息集合；`report.read` 只能读取与实际举报记录关联的对象；回收站/隐藏内容需要相应内容能力。详情接口必须先验证“对象是否属于操作者获权的队列/举报/回收站范围”，再按 capability 脱敏字段，不能用 `includeIdentity` 之类字段开关代替对象域检查。

旧 `review_posts`、`manage_wall_message`、`notice`、`view_user_log`、`view_report`、`view_log`、`view_admin_log`、`manage_settings`、`manage_users`、`manage_roles` 与 `manage_admins` 仍保留在 session/API 兼容对象中。只有当一个旧权限 bundle 的全部 capability 都有效时才返回该旧权限；因此旧客户端不会把残缺 bundle 误认为完整授权。所有新增接口和逐步改造的旧接口必须直接检查动作级 capability，不能继续新增粗权限。

### 7.3 数据表、批量读取与会话失效

`users` 新增：

```sql
permission_version BIGINT NOT NULL DEFAULT 0
feishu_open_id TEXT
feishu_user_id TEXT
```

`password_hash` / `password_salt` 对飞书用户可空。`feishu_open_id` 在非空时唯一。启动初始化会 `DROP NOT NULL` 并补列、补部分唯一索引。

个人差异使用规范化表：

```sql
CREATE TABLE user_permission_overrides (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);
```

启动初始化会以 `IF NOT EXISTS` 补表、列和索引，并删除 reviewer/super_admin 的非法历史覆盖。用户查询用一次聚合读取 `permission_overrides`，批量列表不能为每个用户再发一条 SQL；整组写入使用事务、`DELETE` 后 `unnest` 批量插入。

权限实际变化会同时递增目标用户的 `permission_version` 与 `session_version`；角色变化清空覆盖并递增两者。改密、重置密码、停用等安全动作仍递增 `session_version`。用户与管理员自助改密另受 `RATE_LIMIT_PASSWORD` 约束（按账号，默认 15 分钟 5 次）。前后台 Cookie 的载荷包含会话版本，下一次请求从数据库比较后立即失效，不依赖客户端定时刷新。

### 7.4 权限 API 契约

| 方法与路径 | 条件 | 关键契约 |
| --- | --- | --- |
| `GET /api/admin/roles` | 有任一后台能力 | 返回角色模板、`overrides_locked`、catalog 版本及当前操作者能否管理角色/权限 |
| `GET /api/admin/permissions` | 有任一后台能力 | 返回 catalog、角色模板、当前 capabilities 与锁定策略 |
| `GET /api/admin/users/:userId/permissions` | 仅 `super_admin` 根能力 | 返回 defaults、`overrides.allow/deny`、effective、锁定标记和 `permission_version` |
| `PUT /api/admin/users/:userId/permissions` | 仅 `super_admin` 根能力、可信来源 | **整组替换**；JSON 需 `allow[]`、`deny[]`、`permission_version`、非空 `reason`、`confirm=REPLACE_PERMISSION_OVERRIDES` |
| `DELETE /api/admin/users/:userId/permissions` | 同上 | 恢复默认；需 `permission_version`、非空 `reason`、`confirm=RESET_PERMISSION_OVERRIDES` |
| `PUT`/`PATCH /api/admin/users/:userId/role` | 仅 `super_admin` 根能力、可信来源 | 修改角色、清覆盖、撤销旧会话；禁止自己并保留至少一名启用超级管理员 |
| `POST /api/admin/users` | 仅 `super_admin` 根能力、可信来源 | 创建带密码的 `reviewer|admin|super_admin`；禁止普通 `user`，用户名冲突返回通用失败 |
| `GET /api/user/feishu/start` | 公开、登录限流 | 设置 `feishu_oauth` Cookie 后 302 到飞书官方授权页 |
| `GET /api/user/feishu/callback` | 公开、登录限流 | 校验 state/群成员后设置 `user_session`，再 302 回前端；错误不回传飞书原文 |
| `POST /api/user/register` | 公开、可信来源、注册限流、验证码 | 创建待审普通用户；成功 201，不登录 |
| `POST /api/admin/users/:id/registration/approve` | `users.status.enable`、可信来源 | 将 `pending` 普通用户改为 `active` |
| `POST /api/admin/users/:id/registration/reject` | `users.status.disable`、可信来源 | 将 `pending` 普通用户改为 `disabled` |

个人权限接口禁止修改自己，reviewer/super_admin 目标返回 `409 PERMISSION_OVERRIDES_LOCKED`。无效/缺失版本返回 400，版本不一致返回 `409 PERMISSION_VERSION_CONFLICT`，未知/受保护/重复冲突或缺依赖返回 422。前端遇到 409 必须刷新详情，不得用旧表单盲目重放。

每次成功写入的结构化审计 metadata 至少包含原因、确认串、是否变化、是否撤销会话、前后版本、前后 allow/deny 与生效能力增减。当前没有 step-up 二次验证：这是本轮明确限制，不得在文档中描述为已实现；高危分配依赖可信来源、仅超级管理员、禁止自己、显式确认、原因、版本冲突和审计，后续仍建议加入 WebAuthn/TOTP step-up。

### 7.5 管理界面与安全边界

`AdminUsers.jsx` 在原服务端分页用户管理中加入分组权限编辑器、待审注册筛选/通过/拒绝，并仅向超级管理员提供「创建管理员」表单。每项为三态：继承角色默认、明确允许、明确拒绝；界面显示风险和依赖，并只在保存时整组提交。reviewer/super_admin 显示锁定只读；普通 `user` 与 `admin` 可配置。恢复默认也是一次有原因、有确认、有版本的安全写操作。

用户管理继续按 10,000+ 账号设计：`GET /api/admin/users` 在 PostgreSQL 中完成筛选、排序、统计、`LIMIT/OFFSET` 分页，不把全量用户载入 Node 或浏览器。参数包括 `page`、`page_size`（10–100，默认 25）、最长 64 字的用户名/昵称/姓名前缀或纯数字 ID 搜索、`role/status/muted`、白名单 `sort_by`（注册时间、用户名、最后登录、角色、状态）与 `sort_order`；响应返回筛选总数、页数和全局角色/状态统计。首次建索引和高偏移分页边界沿用 2.4 规则。

前台 `UserContext` 保存后端返回的 capabilities；任一有效能力都可触发顶部后台入口。后台 `AdminShell` 和 `App` 路由守卫按 capability 过滤，并把无权页面重定向到首个有权模块。后端 `authenticatedAccount` 会解析 `admin_session` 或 `user_session`，普通用户获得能力后无需伪装成管理角色；每个接口仍必须用 `requireAdmin` 和具体 capability 校验，前端三态编辑器、隐藏菜单或角色标签都不是安全边界。

必须保持：

1. 所有 reviewer 完全同权，不能按人、类别或作者设置个人差异；
2. super_admin 永久全权，不能授权自己、削弱自己或把根能力下放为覆盖；
3. deny 高于角色默认与 allow；角色变化绝不继承旧覆盖；
4. 至少保留一名启用 super_admin，禁止修改自己的角色或个人覆盖；
5. 权限/角色变化即时撤销两类旧会话；
6. 后台动作与发布免审都按 capability 判断，不能因角色名称自动绕过个人 deny；
7. 审核员的“完全同权”优先于“逐人可配”诉求，锁定是产品安全边界而非 UI 限制。

会话规则：

- 前台 Cookie 为 `user_session`，后台 Cookie 为 `admin_session`；两者都是 HttpOnly 签名会话；
- 任一拥有 capability 的账号都可被统一解析，但后台接口仍必须使用 `requireAdmin` 并检查具体动作；
- Cookie 的 SameSite、Secure 和寿命由环境变量控制，默认寿命 7 天；
- `session_version` 不匹配、账号停用、角色/权限变更或签名无效时，会话应视为失效；
- 更换 `SECRET_KEY` 会让全部现有会话立即失效，也会影响用该密钥保护的验证码 Secret；轮换前需安排重新登录并重新保存相关密钥。

## 8. 发帖与审核流程

```text
提交内容
├─ 普通校园动态
│  ├─ 游客或无 content.publish.bypass_review 的账号 → pending + pending
│  │                      └─ 写审核通知 outbox → /admin/wall 帖子审核
│  │                         └─ 审核通过 → visible + approved
│  └─ 具备 content.publish.bypass_review → visible + approved（免审、不入队）
├─ 表白墙便签
│  ├─ 游客或无免审能力账号 → pending + pending → outbox → /admin/confessions 表白墙审核
│  │                     └─ 审核通过 → visible + approved → 进入爱心
│  └─ 具备免审能力账号 → visible + approved（免审、不入队）
└─ 失物招领（填写必须登录） → visible + approved（所有登录角色免审、不入队）

公开读取仍统一过滤：只返回 visible + approved

任意内容被管理端明确退回待审
└─ pending + pending + review_hold=true → 当前分类对应的展示队列
   ├─ 作者编辑 → 仍保持 pending，不得借编辑自行重新公开
   │              └─ 标签变化可使内容在两个展示队列之间移动
   └─ 审核员通过 → visible + approved，并解除 review_hold
```

队列分类不是持久化的新审核状态，而是根据当前消息动态计算：

- 只要存在结构化 `lost_found` 对象，就优先归入 `posts`，即使自定义标签中同时出现 `表白`；
- 其他内容只有在标签数组精确包含字符串 `表白` 时才归入 `confessions`；`表白墙`、`#表白`、包含“表白”的更长文本都不匹配；
- 除上述表白内容外，其余消息归入 `posts`；两个分类互斥且合计覆盖全部审核内容；
- 作者编辑标签后展示页可以变化，但 `moderation_status`、`review_status` 和 `review_hold` 仍按原审核规则处理，不能通过换标签绕过审核。

后台列表 API 使用 `GET /api/admin/api/messages?scope=posts|confessions`。服务端必须先按 scope 分类，再应用 `status`、`q`、`page` 和 `page_size`；响应的 `messages`、`total`、`total_pages` 与 `counts` 都以当前 scope 为准。省略 scope 或传 `all` 时保留旧客户端需要的合并结果。详情、单条审核和批量审核接口继续共用，不按展示类别复制；纯 `reviewer` 的身份脱敏、可见状态限制和评论移除规则也必须在两边一致。

必须保持的不变量：

- 发布者 capability 必须由服务端会话与数据库解析，客户端字段不能冒充免审身份；
- 游客与没有免审 capability 的账号发布表白便签和普通动态时必须进入 `pending + pending`；具备免审 capability 的账号和所有登录用户的失物招领初次发布直接使用 `visible + approved`，且不写审核队列或通知 outbox；
- 任意内容被管理端明确退回时必须设置 `review_hold=true`、写入 outbox，并进入当前分类对应的展示队列；作者后续编辑不能清除该标记或自行恢复公开，只有审核员通过才能解除；
- 待审核、已下架、已删除内容不能从公开列表、详情、热门、分区、收藏或互动接口泄漏；
- 待审核普通动态的附件也不能通过猜测文件名访问；失物招领附件仍必须验证登录；
- `/admin/wall` 与 `/admin/confessions` 的读取统一使用 `content.queue.read`，单条和批量审核统一使用 `content.review`；旧 `review_posts/manage_wall_message` 仅作 session 兼容映射。不得因发布者或内容类别缩小 reviewer 的范围。切换页面必须清空之前的选择项，不能把另一队列选择带入批量操作；
- 审核结果必须记录操作账号与时间，以便追溯；
- 当前“退回待审”使用 `pending + pending + review_hold`，但不采集退回理由，也没有独立 `rejected` 状态；如增加理由字段，必须同时扩展数据库、API、审核界面、用户通知和审计；
- 免审只决定创建时的初始状态；管理端后续下架或删除后，内容必须立刻从所有公开读取和互动接口消失；
- 审核和管理写操作要进入结构化审计记录。

评论当前属于发布后管理对象，管理员可隐藏、恢复或移入回收站；若未来增加“评论先审后发”，必须同步扩展数据状态、公开过滤、审核队列、通知和测试，不能只增加一个前端按钮。

## 9. 管理员公告系统

公告不是帖子或表白便签，也不进入任一审核展示队列。后台访问和动作分别检查 `notice.read/create/update/delete`；reviewer、admin、super_admin 的角色默认都包含全套公告能力，但普通 `user` 也可以被超级管理员授予部分能力，admin 也可能被个人 deny 收窄。角色名不再等价于公告权限。

### 9.1 数据源与记录结构

当前公告的唯一权威存储是 `backend/static/notice.json`，不是 PostgreSQL。典型记录：

```json
{
  "id": "稳定的随机 ID",
  "timestamp": "2026-08-25 20:00:00",
  "user": "审核员 <用户名>",
  "author_role": "reviewer",
  "title": "运动会期间校门开放时间调整",
  "summary": "请师生留意周五放学安排",
  "content": "公告纯文本正文，可分段换行",
  "priority": "important",
  "status": "published",
  "publish_at": "2026-08-26T01:30:00.000Z",
  "reminder_revision": 1,
  "updated_at": "2026-08-25 20:30:00",
  "updated_by": "管理员 <用户名>",
  "updated_by_role": "admin"
}
```

- `id` 是编辑、归档/恢复和前端已读状态的稳定标识；
- `timestamp` 是记录创建时间，`publish_at` 决定何时对外可见，`updated_at` 是最近编辑时间；未来时间的 `published` 记录在后台归类为“定时”，到点后由公开读取自然出现；
- `user/author_role/updated_by/updated_by_role` 只用于后台追溯，公开接口会删除；
- `title` 最多 80 字，`summary` 最多 200 字；两者为空的旧记录会从正文安全派生，`content` 上限来自后端 `MAX_TEXT_LENGTH`；
- `priority` 为 `normal/important/urgent`，`status` 为 `draft/published/archived`；“scheduled”只是前端对 `published + 未来 publish_at` 的展示桶，不是持久化状态；
- `reminder_revision` 用于重要/紧急公告再次提醒语义：首次公开至少为 1，管理员勾选更新提醒时递增；
- 所有文本移除控制字符和双向文本控制符并按纯文本渲染，正文用 `white-space: pre-wrap` 保留换行，不执行 HTML。

旧公告可能只有 `text/content/timestamp`，没有 ID 或出现重复 ID。`readNotices({ ensureIds: true })` 会补稳定 ID，并将旧记录规范化为标题、摘要、优先级、状态、发布时间和提醒修订；公开与管理读取目前都会请求该规范化，因此首次读取可能原地写回 JSON。部署前必须先备份 `notice.json` 并确认服务账号可写。编辑/归档接口仍接受数字数组索引作为旧客户端兼容回退，但新代码只能使用稳定 ID；移除回退前要确认没有旧客户端。自动规范化不生成业务审计事件。

### 9.2 API 契约

| 方法与路径 | 访问条件 | 行为 |
| --- | --- | --- |
| `GET /api/notice` | 公开 | 只返回 `published` 且 `publish_at <= now`；去除操作者字段，按发布时间倒序，`no-store` |
| `POST /api/notice` | 公开兼容入口 | 与 GET 返回同一安全、过滤、排序后的公开集合；新代码使用 GET |
| `GET /api/admin/notice` | `notice.read` | 返回全部草稿/定时/已发布/已归档记录、字段上限、枚举和当前公告 capabilities |
| `POST /api/admin/notice` | `notice.create` + 可信来源 | 创建草稿或立即/定时公告，返回 201 和新记录 |
| `PUT /api/admin/notice/:noticeId` | `notice.update` + 可信来源 | 编辑完整模型；可归档/恢复，重要或紧急公告可显式增加提醒修订 |
| `DELETE /api/admin/notice/:noticeId` | `notice.delete` + 可信来源 | **归档**公告并保留记录、归档操作者与时间，不物理删除 |

公告没有作者所有权限制，也不需要二次审批。管理页提供状态统计、创建/编辑表单、标题/摘要/正文、优先级、立即/定时、重要更新提醒、实时预览、搜索、状态/优先级筛选、归档和恢复；仅有 `notice.read` 时显示只读历史。公开集合按 `publish_at` 倒序，不因普通编辑自动置顶。当前仍没有自动过期、版本历史、乐观锁或实时推送；并发编辑仍是最后写入胜出。

### 9.3 首页展示与已读规则

- 没有公告时，首页不渲染空公告卡片；
- 有公告时，首页常驻显示 `publish_at` 最近的一条，以及当前公开公告总数；普通编辑不会改变公开排序；
- 用户点击卡片可查看所有仍在展示的公告；
- `important/urgent` 公告使用稳定 ID + `reminder_revision` 作为提醒/已读语义；普通公告保持常驻可读但不应强制抢焦点；
- 已读状态保存在当前浏览器 localStorage；首次发布或管理员显式选择“再次提醒”才增加修订，普通措辞编辑不会无条件反复弹窗；
- 已读状态不是账号数据，不跨浏览器同步；清理站点数据后会重新提示；
- localStorage 不可用时按更安全的“尚未读”处理，重要/紧急公告仍会自动打开，但关闭后无法持久记住已读，后续重新进入可能再次提示；
- 当前没有 WebSocket、SSE 或轮询。已经停留在首页的用户需要重新载入或重新进入首页，才能看到另一标签页刚发布/归档的公告。

首页公告使用 SwiftUI 风格 inset 卡片，手机端公告详情沿用可访问的底部 sheet/模态框。当前 React 首页使用文本节点渲染正文，不会执行公告里的 HTML。

仓库遗留的 `frontend/public/static/js/main.js` 和 `frontend/public/static/js/notice.js` 属于旧页面兼容代码，仍使用 `innerHTML` 拼装公告，旧清洗逻辑不足以阻止所有事件属性型 HTML。不要重新启用引用这些脚本的旧 HTML；若必须保留旧页面兼容，应先把公告正文改为 `textContent`/DOM 文本节点并增加 XSS 回归测试。安全验收可用无害的 `<img src=x onerror=...>` 字符串确认页面只显示文字且不会执行事件，但不得在生产公告中做测试。

### 9.4 审计、并发与备份边界

公告写操作进入后台结构化审计，包含操作者、角色、HTTP 动作、`target_type=notice`、稳定 ID、状态码以及状态/优先级/标题/提醒修订等 metadata；归档还记录正文摘要。是否能看审计由 `audit.read` 决定，不再按角色硬编码。当前通用审计在响应完成后异步 best-effort 写入，失败不会撤销公告操作，因此审计表不是公告备份，也不能当作强事务合规日志。

`notice.json`、反馈、举报和兼容管理日志共用 `writeJson`：先写临时文件再替换，Linux 上 `rename` 可避免截断半份 JSON；Windows 开发环境在无法覆盖时回退为复制。这仍是单进程、无文件锁、无事务的存储：读取解析失败会回退为默认空值，随后一次写入可能覆盖原文件；编辑接口没有版本号、ETag 或乐观锁，多个管理页面同时编辑时最后一次保存胜出。反馈与举报表有可配置条数上限（`MAX_FEEDBACK_RECORDS` / `MAX_REPORT_RECORDS`），达到上限后公开提交返回 503。公告管理异常或并发冲突时应先停止写操作、复制原文件和最近备份，再排查，不能直接发布一条新公告“试修复”。未经改造不要启用多进程同时写这些 JSON；若未来横向扩容，应先迁移到 PostgreSQL，并使用事务、稳定排序字段和并发控制。

日常只读核对：

```bash
cd /www/wwwroot/campuswall-react
node -e "const fs=require('fs');const p='backend/static/notice.json';const a=JSON.parse(fs.readFileSync(p,'utf8'));console.log({count:a.length,missingIds:a.filter(x=>x==null||x.id==null||String(x.id).length===0).length})"
curl -fsS http://127.0.0.1:5412/api/notice
```

人工验收必须覆盖角色默认与个人授权组合：`notice.read` 只读、建/改/归档动作分离、reviewer 模板锁定、admin deny、生效后旧会话失效；还要覆盖草稿、定时未到不公开、到点公开、优先级、提醒修订、归档/恢复、多条排序、换行/长文本、公开字段脱敏、旧记录规范化、纯文本 XSS、深色/手机布局和并发最后写入风险提示。

## 10. 审核消息提醒

后端当前已实现飞书自定义群机器人、企业微信群机器人和审核邮箱，可分别启停。三者已经拆入 `backend/src/services/notifications/providerRegistry.js` 与独立 provider，公共 `moderationNotifier` 只负责 outbox 调度、传输、限流、重试与回执。邮箱渠道走 SMTP `deliver`，不把 SMTP 密码写入后台或 Git。需要审核的普通校园动态或表白便签初次进入待审，或任意内容被明确退回待审时，系统把任务写入 PostgreSQL `moderation_notification_outbox`，再由后台 worker 异步发送；具有 `content.publish.bypass_review` 的发布者和登录用户初次发布失物招领不产生审核提醒。通知 payload 保存动态计算出的 `moderation_scope`，用于把审核入口指向正确页面。

超级管理员可直接打开 `/admin/notifications`，或从后台侧栏进入“消息提醒”。飞书与企业微信各自支持启停、write-only 替换 Webhook/签名密钥、显式清除和固定测试消息；邮箱渠道保存收件地址并开关，SMTP 主机/账号/密码只在服务器环境。保存后 `ModerationNotifier.reconfigure()` 会暂停新领取、等待在途发送结束、原子替换目标并即时恢复补偿扫描和 worker，无需重启服务。普通管理员默认只有 `settings.notifications.read`，修改与测试分别需要 `settings.notifications.update`、`settings.notifications.test`；超级管理员拥有全部三项，个人授权继续遵守权限依赖与会话失效规则。

配置按 provider 分别存放在 PostgreSQL `platform_settings` 的 `moderation_notification:<provider>` 记录中。Webhook 本身视同密码，连同飞书签名密钥使用独立派生域的 AES-256-GCM 密文保存；GET、错误响应、管理员文本日志与结构化审计只返回/记录渠道、启用状态和凭据是否变化，不返回 URL、Secret 或密文。数据库记录一旦存在即覆盖该 provider 的环境回退；显式清除不会重新启用旧环境变量。测试接口只读取已保存凭据并发送服务器固定隐私安全内容，按管理员 + IP + provider 限流，成功与失败均进入脱敏审计。

设计约束：

- 内容与 outbox 尽量在同一个 PostgreSQL 事务中写入；outbox 插入使用 savepoint，通知记录失败会回滚到保存点并记录错误，但不能回滚或阻塞已经合法提交的内容；
- 临时网络错误按指数退避重试，并解析秒数或 HTTP 日期格式的 `Retry-After`（最多接受 24 小时）；达到次数上限进入 `dead`；
- 多条内容会合并摘要，并有最小发送间隔，避免刷屏；
- 首次启用时历史积压只汇总提醒；
- 机器人消息不发送正文、发布者身份、联系方式或附件地址；
- 单条或同一类别的批次深链到 `/admin/wall` 或 `/admin/confessions`，并保留待审筛选；同时含两类内容的混合摘要进入 `/admin` 仪表盘；
- 通知中的数量文案必须写成“全站当前待审”，它是两个展示队列的合计，不应与落地页的单队列数量混淆；
- Webhook 仅允许飞书/Lark 或企业微信官方 HTTPS 域名和固定路径格式，禁止 HTTP、自定义端口、URL 用户信息、fragment 和重定向；
- HTTP 2xx 不等于投递成功，发送器还检查飞书/企业微信业务码；请求有硬超时，错误摘要脱敏，不记录 Webhook；
- worker 领取任务使用 `FOR UPDATE SKIP LOCKED`，启动时恢复陈旧 `processing` 锁，按 provider 限速，发送成功后持久化回执，定期清理超过留存期的终态任务；
- `SIGTERM/SIGINT` 关闭时停止新轮询并等待当前工作，避免部署窗口重复占锁；
- 后台深链仅在 `PUBLIC_SITE_URL` 为 HTTPS 时加入消息。

关键变量：

```env
PUBLIC_SITE_URL=https://wall.zongtech.xyz
PUBLIC_API_URL=https://api-wall.zongtech.xyz
NOTIFICATION_MASTER_KEY=
MODERATION_NOTIFY_ENABLED=true
MODERATION_NOTIFY_FEISHU_WEBHOOK=
MODERATION_NOTIFY_FEISHU_SECRET=
MODERATION_NOTIFY_WECOM_WEBHOOK=
MODERATION_NOTIFY_EMAIL_TO=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
MODERATION_NOTIFY_TIMEOUT_MS=5000
MODERATION_NOTIFY_MAX_ATTEMPTS=6
MODERATION_NOTIFY_POLL_MS=2000
MODERATION_NOTIFY_COALESCE_MS=5000
MODERATION_NOTIFY_MIN_INTERVAL_MS=30000
MODERATION_NOTIFY_BATCH_SIZE=50
MODERATION_NOTIFY_RETENTION_DAYS=30
RATE_LIMIT_NOTIFICATION_TEST=5
```

生产必须设置长期稳定的随机 `NOTIFICATION_MASTER_KEY`；它不进入 Git，轮换前必须停用渠道并准备重新录入。推荐在后台页面保存后发送固定测试消息并确认群内到达；后台保存即时生效。仅使用旧环境变量回退时才需要重启服务。不要在命令行历史中直接粘贴 Webhook；环境文件必须保持 `root:root 600`。

### 10.1 四类平台的当前状态

| 平台 | 当前状态 | 官方接入路线 |
| --- | --- | --- |
| 飞书 | **已实现** | 群自定义机器人 Webhook；可选签名 Secret，推荐作为主要提醒渠道 |
| 企业微信 | **已实现** | 群机器人 Webhook，推荐作为备用或并行渠道 |
| 邮箱 | **已实现** | 后台只开关和填写收件地址；SMTP 只保存在服务器环境 |
| QQ | **未实现** | 只接受 QQ 开放平台官方机器人：申请 Bot、接收官方凭据、缓存 access token、通过 OpenAPI 主动发消息；不得使用 go-cqhttp、逆向协议或个人号登录 |
| 微信 | **未实现** | 没有普通微信群官方 Webhook；按业务选择微信客服 iLink 私聊、公众号模板消息或小程序订阅消息，并完成用户/订阅关系映射；不得使用 Hook、注入、桌面自动化或个人号逆向框架 |

“给出接入路线”不等于“已经接入”。生产环境中 QQ/微信变量、provider 和 UI 都不存在。当前显式 registry 注册飞书、企业微信和邮箱；提醒启用时，启动巡检会把 outbox 内未知 provider 的 pending/sending 任务隔离为 dead，dispatcher 也会在网络请求前永久拒绝。各 provider 独立实现 `readConfig/validateTarget/buildMessage/classifyResponse`，邮箱另有 `deliver`。不能再出现“不是飞书就按企业微信”的默认分支。当前同一 provider 仍只支持一个目标；接入第三方通道或同平台多群前必须先给 outbox 增加稳定 `target_id` 并回填旧记录，再把幂等键升级为包含目标 ID。QQ/微信还需要把当前固定 Webhook POST 契约升级为可注入 token、动态请求、回调或 sidecar 的版本化 `buildRequest/deliver` 契约，不能只加一个空 provider 文件。

四个平台的后台创建步骤、官方文档链接、payload/业务码、token、限流、回调安全、死信重投、监控指标和扩展目录详见 `docs/NOTIFICATION_INTEGRATION.md`。新增渠道必须继续使用 outbox 异步投递、官方目标校验、正文/身份脱敏、速率限制、重试上限、可观测性和安全回滚，不能把第三方请求放回发帖请求中同步执行。

常用 outbox 检查：

```sql
SELECT provider, status, count(*)
FROM moderation_notification_outbox
GROUP BY provider, status
ORDER BY provider, status;

SELECT id, provider, message_id, attempts, next_attempt_at, last_error
FROM moderation_notification_outbox
WHERE status IN ('pending', 'dead')
ORDER BY created_at DESC
LIMIT 50;
```

查询结果中的 `last_error` 可能包含第三方响应摘要，对外分享前仍需检查并脱敏。大量 `pending` 通常意味着 worker 未运行、网络不可达或节流窗口；大量 `dead` 表示达到最大重试次数，需要先修复 Webhook/网络后再决定是否重投，不能直接清空队列。

## 11. 头像上传链路

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

头像表单只允许一个文件且不允许额外字段，但不要重新加入 Multer/Busboy 的 `parts: 1`：该限制会在第一个合法文件到达时触发 `LIMIT_PART_COUNT`，把所有小图片误报为无效或过大。当前路由使用 `files: 1`、`fields: 0` 和 5 MiB `fileSize`；超体积返回 413 `AVATAR_TOO_LARGE`，非法 multipart 返回 400 `INVALID_AVATAR_UPLOAD`。修改 multipart 规则后必须运行小 JPEG、超 5 MiB 和额外字段三类回归测试。

关键变量：

```env
MAX_AVATAR_SIZE=5242880
AVATAR_OUTPUT_SIZE=512
AVATAR_WEBP_QUALITY=82
MAX_AVATAR_INPUT_PIXELS=40000000
MAX_CONCURRENT_AVATAR_PROCESSING=2
```

## 12. PostgreSQL 数据与运行文件

主要表：

- `users`：账号、密码哈希、角色、状态、头像文件名、`session_version` 与权限乐观锁 `permission_version`；
- `user_permission_overrides`：逐用户、逐 capability 的 `allow/deny` 差异及创建/更新操作者；`(user_id, permission_key)` 唯一，删除用户级联删除；
- `legacy_manager_migrations`：旧后台账号一次性迁移记录；
- `messages`：留言主体及 JSONB 数据；
- `partitions`：标签/分区与留言关系；
- `message_reactions`、`poll_votes`：互动与投票去重；
- `user_favorites`、`user_notifications`：收藏和站内通知；
- `platform_settings`：社区与验证码设置；
- `admin_audit_events`：后台结构化审计；
- `moderation_notification_outbox`：审核群机器人持久投递队列。

运行文件：

- `backend/static/uploads`：最终附件；新图片只保留压缩后的 WebP 主图，非图片附件和历史文件保持原格式；
- `backend/static/tiny_files`：压缩缩略图；新图片缩略图为 WebP；
- `backend/static/avatars`：处理后的 WebP 头像；
- `backend/static/chunks`：上传分片，可清理但会中断正在上传的任务；
- `backend/static/apps/icons`：兼容运行图标；
- `backend/static/notice.json`：当前公告唯一权威存储，必须备份；
- `backend/help/help.json`：当前反馈工单的权威存储，必须备份；
- `backend/help/report.json`、`backend/help/processed_report.json`：当前待处理与已处理举报的权威存储，必须备份；
- `backend/admin_log.json`：后台兼容管理日志，仍持续写入，必须按运营留存要求备份；
- `backend/manage_message.json`：主要保留旧数据迁移状态和兼容信息；
- `backend/logs/info.log`：当前 Express 错误处理中实际追加的应用错误日志。

后端每 15 分钟清理一次超期未引用上传和分片。头像目前在正常替换时清理旧文件；若进程在文件写入与数据库提交之间被强制终止，极少数孤儿头像需由后续维护任务或人工审计处理。

## 13. 环境变量分组

完整默认值见 `backend/.env.example`，生产以 `/etc/campuswall/backend.env` 为准。

基础与数据库：

```env
NODE_ENV=production
SCHOOL_NAME=龙华区观澜中学
SITE_NAME=龙华区观澜中学校园墙
SITE_LAUNCHED_AT=2026-08-25T01:48:50+08:00
APP_NAME=龙华区观澜中学校园墙 API
DEBUG=false
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
PGSSL_REJECT_UNAUTHORIZED=true
```

非空 `DATABASE_URL` 优先于分散的 `PG*` 参数。`SITE_LAUNCHED_AT` 表示真实首次上线时间，发布、重启、迁移或换域名时都不应自动改为当前时间。开启 `PGSSL=true` 时由 `PGSSL_REJECT_UNAUTHORIZED` 控制证书校验；生产类 `NODE_ENV` 默认校验，本地可显式设为 false。当前生产使用本机 PostgreSQL，保持 `PGSSL=false`。

来源、Cookie 与验证码：

```env
ALLOWED_ORIGINS=https://wall.zongtech.xyz
SESSION_COOKIE_SAMESITE=Lax
SESSION_COOKIE_SECURE=true
SESSION_MAX_AGE=604800
PUBLIC_SITE_URL=https://wall.zongtech.xyz
PUBLIC_API_URL=https://api-wall.zongtech.xyz
CAPTCHA_PROVIDER=none
CAPTCHA_ENABLED=false
CAPTCHA_SITE_KEY=
CAPTCHA_SECRET_KEY=
```

正式前端和 API 均使用 HTTPS，生产必须保持 `SESSION_COOKIE_SECURE=true`。`ALLOWED_ORIGINS` 使用完整来源（协议、域名、端口），当前只允许 `https://wall.zongtech.xyz`；不要加入 Pages 预览域名、旧 IP 或带凭据的通配符。需要临时验收某个预览部署时，应建立有时限的单独变更记录，验收后立即移除并重启后端。飞书 OAuth 回跳要求 `SESSION_COOKIE_SAMESITE=Lax`（不要改成 `Strict`）。

飞书登录（只写变量名；真值只放服务器环境文件）：

```env
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_LOGIN_CHAT_ID=
FEISHU_REDIRECT_URI=https://api-wall.zongtech.xyz/api/user/feishu/callback
FEISHU_TIMEOUT_MS=8000
```

开放平台步骤、轮换 Secret 和与审核 Webhook 的区别见 `docs/FEISHU_LOGIN.md`。不要把 App Secret / `chat_id` 写入本文或 Git。

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
POST_IMAGE_MAX_EDGE=2048
POST_IMAGE_WEBP_QUALITY=80
POST_IMAGE_MAX_OUTPUT_BYTES=1572864
MAX_POST_IMAGE_INPUT_PIXELS=50000000
```

内容、头像与防刷：

```env
MAX_TEXT_LENGTH=10000
MAX_TITLE_LENGTH=200
MAX_TAGS=10
MAX_MESSAGE_FILES=20
MAX_COMMENT_FILES=10
MAX_AVATAR_SIZE=5242880
AVATAR_OUTPUT_SIZE=512
AVATAR_WEBP_QUALITY=82
MAX_AVATAR_INPUT_PIXELS=40000000
MAX_CONCURRENT_AVATAR_PROCESSING=2
RATE_LIMIT_LOGIN=30
RATE_LIMIT_REGISTER=10
RATE_LIMIT_WRITE=40
RATE_LIMIT_INTERACTION=240
RATE_LIMIT_UPLOAD=240
RATE_LIMIT_FEEDBACK=20
RATE_LIMIT_NOTIFICATION_TEST=5
RATE_LIMIT_PASSWORD=5
RATE_LIMIT_EMAIL=8
MAX_FEEDBACK_RECORDS=5000
MAX_REPORT_RECORDS=5000
```

审核通知：

```env
NOTIFICATION_MASTER_KEY=
MODERATION_NOTIFY_ENABLED=false
MODERATION_NOTIFY_FEISHU_WEBHOOK=
MODERATION_NOTIFY_FEISHU_SECRET=
MODERATION_NOTIFY_WECOM_WEBHOOK=
MODERATION_NOTIFY_EMAIL_TO=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
MODERATION_NOTIFY_TIMEOUT_MS=5000
MODERATION_NOTIFY_MAX_ATTEMPTS=6
MODERATION_NOTIFY_POLL_MS=2000
MODERATION_NOTIFY_COALESCE_MS=5000
MODERATION_NOTIFY_MIN_INTERVAL_MS=30000
MODERATION_NOTIFY_BATCH_SIZE=50
MODERATION_NOTIFY_RETENTION_DAYS=30
```

生产类环境（`NODE_ENV` 不是 `development`/`dev`/`test`）启动会拒绝占位 `SECRET_KEY`，也会拒绝默认开发数据库密码 `campus_wall_dev`（含写在 `DATABASE_URL` 里的情况）。修改环境变量后必须重启 `campuswall.service`。

正式前端构建变量由可提交的 `frontend/.env.production` 提供：

```env
VITE_API_BASE_URL=https://api-wall.zongtech.xyz
VITE_STATIC_URL=https://api-wall.zongtech.xyz/static/
VITE_APP_ENV=production
```

所有 `VITE_*` 值都会编译进浏览器资源，只能放公开配置，绝不能放密码、令牌、Webhook、私钥或数据库连接串。修改这些值后必须重新执行 Pages 构建和部署，仅重启后端不会改变已经发布的 JavaScript。`frontend/src/main.jsx` 当前在生产构建中加载 Umami，并在未配置时使用代码内网站 ID；这会产生第三方分析请求。学校正式接管前应完成隐私评审，如不需要统计，应改为显式开关并停止加载，而不是只把变量留空。

## 14. 本地开发

前置条件：Node.js 22.12+（推荐当前 LTS）、npm、操作系统原生 PostgreSQL 17+（新环境推荐 18）和系统 `ffmpeg`。根包及两个 workspace 的 engine 均声明为 `>=22.12.0`；Vite 8 与旧 SQLite 导入脚本也按这条基线验收，避免开发、构建和迁移使用不同版本。本项目不提供容器化数据库定义，开发者必须先通过操作系统服务管理器启动 PostgreSQL。

首次运行：

```powershell
cd C:\path\to\campuswall-react
npm install
npm run db:wait
npm run dev
```

首次运行前应在本机 PostgreSQL 中创建与 `backend/.env` 一致的角色和数据库，并确认服务监听本机 TCP。示例只展示对象关系，密码必须自行设置且不能提交：

```sql
CREATE ROLE campus_wall LOGIN PASSWORD '<本机专用密码>';
CREATE DATABASE campus_wall OWNER campus_wall;
```

复制 `backend/.env.example` 为未跟踪的本地环境文件，配置 `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` 后再执行 `npm run db:wait`。Windows 应使用“服务”或安装程序提供的服务命令，Linux 使用发行版对应的 `systemctl` 单元；npm 脚本不会安装、启动或停止 PostgreSQL。

`npm run db:migrate` 只用于把旧 SQLite 数据导入 PostgreSQL：仅当 `backend/static/messages/messages.db` 存在、确认需要导旧数据并已先备份时单独执行。全新环境没有该 SQLite 文件时脚本会以非零状态退出，这不代表 PostgreSQL 启动失败，也不应为了让命令成功而创建空 SQLite 文件。

常规本地运行（PostgreSQL 已经启动）：

```powershell
npm run dev:local
```

`dev:local` 的定义是 `db:wait && dev`：数据库不可连接时会失败退出，不会隐式创建临时数据库。需要停库时使用操作系统服务管理器，并先确认没有其他项目或用户共享该实例。

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

## 15. 测试与发布门槛

每次提交前至少执行：

```powershell
npm --workspace backend test
npm --workspace backend run check
npm run build
git diff --check
```

GitHub Actions 使用 Node.js 22，并在 Ubuntu runner 上启动系统自带的原生 PostgreSQL、创建一次性测试角色和数据库、以该角色实际执行 `SELECT 1` 后，再执行安装、审计、构建、语法检查与健康冒烟测试。CI 的数据库主版本跟随 runner image，作为 SQL 兼容性下限；生产当前实测为 PostgreSQL 17.11，本地新环境推荐 18。CI 不依赖容器服务；修改数据库初始化时必须同时验证 PostgreSQL 17 兼容性、新版 PostgreSQL 和 CI 原生服务，不能只让其中一个环境通过。

还应人工验证：

1. 游客首页、动态、表白墙、话题和帮助可访问；
2. 游客发布普通内容后只进入待审，不在公开列表出现；
3. 默认普通 `user` 发布普通动态进入待审；具备 `content.publish.bypass_review` 的账号初次发布立即公开且不进入队列/outbox，admin 被 deny 后不能继续按角色免审；
4. 游客/无免审能力账号提交表白便签后收到待审回执，不立即重新拉取或进入爱心，并写队列/outbox；具备免审能力的账号初次发布立即公开且不入队；
5. `/admin/wall` 只显示帖子侧，`/admin/confessions` 只显示表白墙侧；两页直接访问与刷新均不 404；
6. 混合构造普通帖子、精确 `表白` 标签、`表白墙`、`#表白`、结构化失物招领加 `表白` 标签的数据，确认只有精确 `表白` 且非 `lost_found` 的内容进入表白墙侧，两个分类互斥且无遗漏；
7. 两页的 `status + q + page + page_size` 组合、总数、页数和各状态计数均按当前 scope 计算；使用超过 20 条交错数据确认先分类再分页，不出现空页、重复或漏项；
8. 切换帖子/表白墙页面会清除选中项与详情，批量操作不携带另一页选择；旧 `/admin/wall?...&message=:id` 指向表白便签时会进入正确页面；
9. 单条或单类机器人提醒深链进入对应审核页，混合摘要进入仪表盘；所有通知数量明确写“全站当前待审”；
10. 失物招领未登录可浏览公开列表，填写/评论/点赞会引导登录；登录后初次发布立即可见且不进入队列/outbox；游客仍不能读取或猜附件地址；
11. 将管理角色普通动态、表白或失物招领明确退回待审后会设置 `review_hold` 并进入当前分类页面；作者编辑标签可换页但仍不公开，审核员通过后才恢复；
12. 合法用户名的 2/24 字符边界、非法字符、NFKC 与大小写唯一性，以及 8/128 字符密码边界均符合第 7 节；
13. 四种角色默认模板、个人 allow/deny 后的导航和后端能力一致；任意 reviewer 能看到并处理两个展示队列中的全部实际待审内容；
14. 单条审核和批量审核均不因发布者身份或展示类别产生额外限制，且审计记录完整；
15. 公开列表、详情、分区和互动接口始终只返回 `visible + approved`，pending/hidden/deleted 均不泄漏；
16. 超级管理员能分配角色和他人的个人权限，reviewer/admin/普通 user 不能；禁止自己、至少一名启用超级管理员、reviewer/super_admin 锁定和角色变化清覆盖均由后端强制；
17. 头像横图、竖图、透明 PNG、带方向信息图片均输出方形 WebP；
18. 公告 `notice.read/create/update/delete` 可分别授权和拒绝；默认 reviewer/admin/super_admin 均有全套能力，个人授权普通 user 只能执行实际获权动作；
19. 公告 GET/旧 POST 同一公开集合、公开字段脱敏、旧记录规范化、标题/摘要/正文、优先级、草稿、定时、提醒修订、归档/恢复和排序均符合第 9 节；
20. 公告中的 HTML 标签与事件属性只显示为文本，不在 React 页面执行；
21. 在 1080/768/520/360px、手机横屏与软键盘弹出时检查两个审核入口、状态筛选、搜索、批量栏、卡片按钮与详情 sheet，无横向滚动或 safe-area 遮挡，触控目标至少 44×44px；
22. 仅用键盘可进入两个审核页并完成筛选、搜索、选择、分页、打开详情和审核；Modal 保持焦点圈闭、Escape 关闭和焦点恢复；
23. 当前页面、搜索框、状态筛选、加载/空状态、队列数量和选中数量具有明确的可访问名称或状态播报，不能只依赖颜色或 placeholder；
24. 深色、浅色、跟随系统、五种强调色、跨标签页同步、`prefers-reduced-motion`、`prefers-reduced-transparency` 与高对比模式正常；
25. 浏览器控制台无新增 warning/error，页面无 Vite 错误遮罩；
26. 动态流分别构造无附件、长文、1/2/3/4/5/9/10/20 个附件的数据，确认 1 个媒体保留自然比例，2/4 使用两列，3/5–9 使用三列，10 个以上只显示前 9 个且第 9 格 `+N` 正确；
27. 从第 1 格和第 9 格打开附件预览，确认预览器仍持有完整附件数组、索引不偏移且可以继续浏览第 10–20 项；图片、视频、音频和其他允许类型均有可理解的视觉与无障碍名称；
28. 发布器分多次选择文件直到 20 项，验证第 21 项触发清晰提示而不覆盖已选文件；逐项删除后可继续添加，图片/视频预览不闪烁，音频有占位，正文、标签、投票和草稿不丢失；
29. 验证关闭发布器再打开只恢复正文、话题、类型和投票，不伪造本地附件恢复；发布失败保留编辑状态，成功后清空草稿、附件和进度；
30. 在 1080/768/520/360px、手机横屏、软键盘和 safe-area 下检查朋友圈式作者/正文/媒体/时间/操作/讨论顺序，无横向滚动或遮挡；触控目标至少 44×44px；
31. 仅用键盘完成打开发布器、切换图文/投票、编辑正文、选择与移除附件、添加话题、发布和取消；焦点圈、状态文本、媒体替代文本、减少动态/透明度、高对比及浅深色均正常；
32. 从动态网格打开图片灯箱，确认无 UUID 文件名和白色文件管理器外框；桌面按钮、方向键、Escape、焦点圈闭、关闭后焦点恢复、手机滑动、单击隐藏工具栏、safe-area、加载失败重试和鉴权流式保存均正常；视频能内联播放，PDF 只提供打开/保存；
33. 分别用直传和分块方式上传横竖 JPEG、透明 PNG、WebP、普通/超 200 帧 GIF、超大像素图与压缩后仍超限图片；确认成功项只留下 WebP 主图和缩略图、方向正确、透明度保留、元数据移除、原图/分片删除，失败项不留下临时文件，历史附件未被改写；
34. 上传很小的 JPEG 头像应成功输出方形 WebP，超过 5 MiB 返回 413，带额外字段的 multipart 返回 400，三者都不能再统一显示“请求体无效或文件过大”；
35. 管理员日志、操作审计和错误日志分别导出包含当前搜索/筛选范围的 UTF-8 BOM CSV；用含逗号、换行、双引号和以 `= + - @` 开头的字段验证格式与公式注入防护，确认导出不含未授权的敏感字段；
36. 用至少 10,000 条脱敏测试用户验证用户管理前缀/ID 搜索、角色/状态/禁言筛选、五种排序、25/50/100 每页、越界页夹取与全局统计；桌面和手机都不横向滚动，角色/状态标签绝不拆字，所有操作菜单按 capability 显示；列表权限数据不得出现逐用户 N+1；
37. `/p` 目录只从真实、非删除且对当前访问者可见的消息标签聚合；搜索、三种排序、24 条分页、空状态和失物招领登录边界正确，`/p/:tag` 使用精确标签且不会把“全部话题”当标签；
38. Three.js 爱心覆盖点击/触控命中、拖动不误点、悬停/按压、精选 3–5 条稳定抽样、4 秒旧到新轮播、波纹过渡、离屏/隐藏/悬停/弹窗/reduced-motion 暂停、WebGL 失败和普通便签列表降级；
39. ThemePicker 可在 system/light/dark 与 blue/rose/violet/green/orange 间选择，刷新持久化、系统主题变化、跨标签页同步、存储禁用回退、键盘/Escape/焦点恢复和所有后台/前台页面变量均正常；
40. 权限解析覆盖角色默认、allow、deny 最终优先、未知/受保护/重叠项拒绝、依赖缺失、reviewer/super_admin 锁定、角色变化清覆盖和旧粗权限“完整 bundle 才暴露”；
41. 权限详情/替换/恢复默认 API 覆盖仅超级管理员、禁止自己、原因必填、确认串、`permission_version` 冲突 409、事务批量写、`session_version` 即时失效和完整审计 metadata；
42. 普通 `user` 获得单项 capability 后可从顶部进入首个有权后台页面，直接刷新可通过；未获权页面/接口拒绝。admin 被 deny 后对应菜单、路由和动作同时消失或 403，不能靠旧角色/粗权限绕过；用已公开、待审、隐藏、删除、无举报、有关联举报的 ID 交叉验证详情对象域，`content.author_identity.read` 只能增字段，`report.read` 只能读关联举报对象；
43. 公告读/建/改/归档 capability 分离，草稿与未来定时公告不公开，到点后公开，归档后消失且可恢复；重要/紧急公告按 `reminder_revision` 提醒，普通编辑不无条件重复弹窗；
44. `GET /api/modules` 只返回固定安全字段；前端只启用编译期已知且后端允许的 ID，禁用模块同时移除主路由、支持路由和导航，manifest 失败使用安全默认值，远端字段不能注入脚本/import；
45. 飞书/企业微信校验官方 URL、签名/业务码、HTTP 错误、超时、重定向拒绝、`Retry-After`、重试/死信、并发领取、陈旧锁恢复、合并/限速、隐私脱敏和关闭等待；QQ/微信没有 provider 或假成功状态。
46. `/admin/notifications` 只向拥有 `settings.notifications.read` 的账号开放；飞书/企业微信分别验证未配置、已配置、启用、write-only 替换、显式清除、固定安全测试、保存失败保留草稿、热加载等待在途发送和测试限流；页面在桌面与 390px 手机视口无横向溢出，QQ/个人微信只展示官方能力限制，不出现伪配置表单。

现有自动化测试文件已经加入 `backend/test/rolesPermissions.test.js`、`backend/test/userStorePermissions.test.js`、`backend/test/messageStoreTopics.test.js`、`backend/test/moduleRegistry.test.js`、`backend/test/notificationSettingsStore.test.js`，并扩展 `backend/test/noticeStore.test.js` 与 `backend/test/moderationNotifier.test.js`。它们应与既有头像、图片压缩、审核分类/通知、角色统计和用户分页测试一起运行；仅有测试文件或前端截图不能证明本轮全部通过。仍应补审核列表路由的 scope 组合、真实浏览器主题/Three.js、权限编辑 E2E 与公告并发冲突测试。

`frontend/package.json` 当前没有 React 单元测试、E2E 或自动化无障碍测试脚本，前端发布仍依赖人工回归。除上面的双队列窄屏与键盘验收外，还要模拟 WebGL 不可用、验证码配置/脚本失败，并逐一登录四种角色核对顶部入口、后台侧栏和直接 API 拒绝。新增核心交互后应优先引入可重复的 E2E 与 axe 类可访问性测试。

前端页面已经使用路由懒加载。构建仍可能出现 Three.js 表白墙 vendor/场景分包体积提示；这不是构建失败，但若体积继续增长，应进一步拆分 Three.js vendor、延后场景初始化或提供更轻的移动端降级包，不能把“启用路由懒加载”当作尚未完成的工作。

### 15.1 3.0 本轮验收记录

本轮验收定义为：功能行为、动作级权限与安全边界、视觉/响应式/无障碍检查、后端定向测试和前端生产构建。**本轮没有使用 Docker，也没有执行压力、容量、长稳或渗透测试**；不能把“万级分页设计”写成已经完成压力验证。

以下记录均来自本轮实际执行；未覆盖的矩阵项继续明确保留为未执行，不能据此推断已经完成容量或全角色 E2E 验证：

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| 权限定向测试 | `node --test backend/test/rolesPermissions.test.js backend/test/userStorePermissions.test.js` | **通过，14/14** | 2026-08-26 04:35 CST / Codex |
| 话题/模块/公告/提醒定向测试 | 话题、模块、公告、提醒、审核角色与发布策略共 6 个测试文件 | **通过，28/28** | 2026-08-26 04:35 CST / Codex |
| 后端完整测试 | `npm --workspace backend test` | **通过，69/69** | 2026-08-26 04:37 CST / Codex |
| 后端语法检查 | `npm --workspace backend run check` 加逐个 `backend/src/**/*.js` 的 `node --check` | **通过** | 2026-08-26 04:37 CST / Codex |
| 前端生产构建 | `npm run build` | **通过**；Three.js 表白墙分包 535.88 kB（gzip 136.34 kB）触发体积提示，非构建失败 | 2026-08-26 04:37 CST / Codex |
| 依赖安全检查 | `npm audit --audit-level=high` | **通过，0 个已知漏洞** | 2026-08-26 04:35 CST / Codex |
| 功能/权限/视觉人工矩阵 | 本地页面桌面与 390×844 手机视口；首页、主题菜单、深色+樱粉、话题页面壳、Three.js Canvas 与 WebGL 场景 | **抽样通过**；未执行第 1–45 项全量四角色 E2E，本地未启动后端时 API 错误态也能正确降级 | 2026-08-26 04:33 CST / Codex |
| Git diff 格式检查 | `git diff --check` | **通过**；仅 Windows LF/CRLF 转换提示，无空白错误 | 2026-08-26 04:37 CST / Codex |
| GitHub 发布门禁 | 应用提交 `0f90700d91a3d204dfb965f23730dbd2a5d0963b`；Actions run `32896534267` | **通过**；原生 PostgreSQL、69/69 后端测试、构建、依赖审计、语法与健康冒烟全部通过 | 2026-08-26 04:40 CST / GitHub Actions |
| 生产部署 | 上线前隔离备份 `/www/backups/campuswall/20260826-044239-before-deploy`（含 PostgreSQL custom dump/目录校验、环境、systemd、Nginx、UFW、证书与校验和）；服务器快进到应用提交后重载 Nginx、重启 `campuswall.service`；Pages deployment `https://056614b8.guanlan-campus-wall.pages.dev` | **通过**；服务于 04:46:07 CST 进入 `active`，`127.0.0.1:5412/health` 正常；`user_permission_overrides` 与 `users.permission_version` 已确认存在 | 2026-08-26 04:46–04:48 CST / Codex |
| 生产线上冒烟 | `wall.zongtech.xyz` 首页、`/p`、`/confessions`、`/admin/notice` SPA 深链；API `/health`、`/api/modules`、`/api/topics`；正式 Origin 与恶意 Origin 预检；登录后的公告工作台及细分权限弹窗只读检查 | **通过**；页面/API 均为 200，正式 Origin 返回带凭据 CORS，恶意 Origin 不返回允许头；精确 `#表白` 链接、Three.js Canvas、主题菜单、公告字段/状态与逐项 allow/deny UI 均在线可见且无桌面横向溢出 | 2026-08-26 04:49–04:55 CST / Codex |

任一“待补”不得在没有证据时改成通过。发布必须再执行 17 节生产门槛，不能复用开发期口头结论。

### 15.2 3.1 提醒 provider 重构验收记录

本轮只调整后端提醒适配层、测试和文档；没有修改前端产物，不需要重复发布 Cloudflare Pages，也没有执行压力、容量、长稳或渗透测试。

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| 提醒定向测试 | `node --test backend/test/moderationNotifier.test.js backend/test/notificationProviderRegistry.test.js` | **通过，16/16**；覆盖显式 registry、重复/残缺适配器 fail fast、未知 provider 启动隔离与零网络调用、严格业务成功码、真实 dispatcher 接线、429、非法 JSON与超时 | 2026-08-26 12:25 CST / Codex |
| 非原生依赖后端回归 | 显式运行不加载 Sharp 的 10 个测试文件 | **通过，47/47**；覆盖权限、审核/发布策略、话题、公告、模块、提醒与并发 gate | 2026-08-26 12:19 CST / Codex |
| 后端语法检查 | `npm --workspace backend run check` 与新增/修改源文件逐个 `node --check` | **通过** | 2026-08-26 12:11 CST / Codex |
| 生产依赖审计 | `npm audit --omit=dev --registry=https://registry.npmjs.org` | **通过，0 个已知漏洞** | 2026-08-26 12:11 CST / Codex |
| 本机完整测试/构建 | `npm --workspace backend test`、`npm run build` | **受本机策略阻断**；可在本机执行的纯 JS 断言最终 47/47 通过，8 个原生依赖测试文件及 Rolldown 构建在加载 `sharp`/Rolldown `.node` 时被 Windows Application Control 拒绝，并非代码断言失败；完整结论以已通过的 GitHub Actions Ubuntu 门禁和生产服务器回归为准 | 2026-08-26 12:11–12:25 CST / Codex |
| Git diff 格式检查 | `git diff --check` | **通过**；仅 Windows LF/CRLF 转换提示，无空白错误 | 2026-08-26 12:12 CST / Codex |
| GitHub 发布门禁 | 应用提交 `1c0a105a0eccf21be487329a1ad0c0761e085824`；Actions run `32929793919` | **通过**；原生 PostgreSQL、74/74 后端测试、前端构建、0 漏洞审计、语法与健康冒烟全部通过 | 2026-08-26 12:20 CST / GitHub Actions |
| 生产备份 | `/www/backups/campuswall/20260826-122152-before-deploy` | **通过**；root-only 0700 目录、PostgreSQL custom dump、运行文件、环境/systemd/Nginx/UFW/Origin 证书与 SHA-256 校验均完成 | 2026-08-26 12:21 CST / Codex |
| 服务器回归与发布 | 服务器快进到应用提交后 `npm ci`、`npm --workspace backend test`、`npm --workspace backend run check`，再重启 `campuswall.service` | **通过**；服务器 74/74，0 漏洞；服务于 12:23:37 CST active，生产 PostgreSQL 17.11；提醒无真实 Webhook，日志如实为 disabled | 2026-08-26 12:22–12:24 CST / Codex |
| 公网冒烟 | `api-wall.zongtech.xyz/health`、Pages 首页、正式 Origin 预检 | **通过**；API `{"status":"ok"}`，首页 200，正式 Origin 返回带凭据 CORS；本轮无前端变更，未重复部署 Pages | 2026-08-26 12:24–12:25 CST / Codex |

3.1 应用提交已经部署；QQ/微信仍只能描述为官方接入文档与后续路线，不能描述为当前 provider。飞书/企微代码可用不代表生产已配置机器人；当前生产日志明确显示提醒禁用，只有学校创建真实群机器人并通过维护窗口注入 Secret 后才能改为启用。

### 15.3 3.2 后台消息提醒配置验收记录

本轮新增后台可视化配置、数据库加密存储、细粒度权限、热加载和安全测试能力，并同步发布后端与 Cloudflare Pages。**本轮没有执行压力、容量、长稳、渗透或真实机器人发送测试**；生产仍未保存任何真实 Webhook，页面显示“未配置”是当前真实状态。

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| 可在本机执行的后端回归 | 显式运行不加载 Sharp 的纯 JavaScript 测试集合 | **通过，56/56**；覆盖通知配置加密、write-only 读回、乐观并发、权限模板、provider、热加载 gate、测试限流与失败审计 | 2026-08-26 12:47 CST / Codex |
| 后端语法与格式 | 所有后端 JavaScript 逐个 `node --check`，并执行 `git diff --check` | **通过**；格式检查仅有 Windows LF/CRLF 转换提示，无空白错误 | 2026-08-26 12:48 CST / Codex |
| 依赖安全检查 | `npm audit --audit-level=high` | **通过，0 个已知漏洞** | 2026-08-26 12:48 CST / Codex |
| 本机完整原生测试/构建 | `npm --workspace backend test`、`npm run build` | **受本机策略阻断**；Windows Application Control 拒绝本机加载 Sharp/Rolldown 原生模块，并非断言或编译源码失败；完整结论以下方 GitHub Actions Ubuntu 门禁和生产 Linux 回归为准 | 2026-08-26 12:47–12:49 CST / Codex |
| GitHub 发布门禁 | 应用提交 `60ef5a370cf0bb660146fe1e89f1df6ec5726719`；Actions run `32932831975` | **通过**；原生 PostgreSQL、83/83 后端测试、前端生产构建、0 漏洞审计、语法与健康冒烟全部通过；前端构建 583 ms | 2026-08-26 12:55 CST / GitHub Actions |
| 生产备份 | `/www/backups/campuswall/20260826-130958-before-deploy` | **通过**；包含 PostgreSQL custom dump 与 restore-list 校验、运行文件、环境、systemd、Nginx、UFW、Origin 证书及 SHA-256 校验 | 2026-08-26 13:09 CST / Codex |
| 服务器回归与后端发布 | 生产 Linux 上执行 `npm ci`、完整后端测试、后端检查，再重启 `campuswall.service`；首次生成独立 `NOTIFICATION_MASTER_KEY` 并以 root:root 0600 保存 | **通过**；83/83、0 漏洞；服务自 13:11:20 CST 保持 active，提醒日志如实显示未配置/禁用；密钥内容未输出或写入仓库 | 2026-08-26 13:10–13:12 CST / Codex |
| Cloudflare Pages 发布 | 生产 Linux 构建同一应用提交，校验构建归档 SHA-256 后使用 Wrangler Direct Upload；deployment `https://07b579c4.guanlan-campus-wall.pages.dev` | **通过**；69 个文件发布、44 个复用，`AdminNotifications-DHRIYQAI.js` 10.02 kB；临时 OAuth token 已在远端粉碎并从本机临时目录删除 | 2026-08-26 13:12–13:17 CST / Codex |
| 公网接口冒烟 | `api-wall.zongtech.xyz/health`、Pages 首页、`/admin/notifications` SPA 深链、未登录配置 API、正式与恶意 Origin 预检 | **通过**；健康、首页和深链均为 200，未登录 API 为 401，正式 Origin 返回带凭据 CORS，恶意 Origin 不返回允许头 | 2026-08-26 13:18–13:20 CST / Codex |
| 生产浏览器验收 | 已登录超级管理员只读打开“管理后台 → 消息提醒”；桌面和 390×844 手机视口 DOM、截图、横向宽度与 console 检查 | **通过**；飞书/企业微信卡片、配置状态、禁用测试按钮、QQ/个人微信限制和文档链接均在线；390px 下 `scrollWidth` 384、无横向溢出，console 无 warning/error；未填写、保存或发送任何真实凭据/消息 | 2026-08-26 13:18–13:21 CST / Codex |

3.2 应用提交已经部署到后端和 Pages。配置入口为顶部“管理后台”进入后，在左侧选择“消息提醒”；超级管理员具备读取、修改与测试权限，普通管理员默认只有读取权限。真实启用前必须由学校在目标群创建飞书或企业微信机器人，再由有权账号在该页面粘贴 Webhook、保存并发送固定测试消息；不得把 Webhook 或签名密钥写入 Git、交接文档、截图或聊天。

### 15.4 3.3 生产守卫与上传/身份加固验收记录

本轮加固生产启动守卫、分片合并互斥、附件文件头校验、HMAC 访客 Cookie、公开资料/注册枚举收敛、改密限流和反馈/举报条数上限，并同步发布后端与 Cloudflare Pages。**本轮没有执行压力、容量、长稳或渗透测试。**

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| 可在本机执行的后端回归 | 不加载 Sharp 的守卫、访客令牌、文件头、权限与发布策略测试 | **通过，25/25** | 2026-08-26 16:12 CST / Cursor Agent |
| GitHub 发布门禁 | 应用提交 `403ec83582fc29b750bf8f9b2bfb7c8509419cbf`；Actions run `32946751789` | **通过**；原生 PostgreSQL、90/90 后端测试、前端生产构建、0 漏洞审计 | 2026-08-26 16:14 CST / GitHub Actions |
| 生产备份 | `/www/backups/campuswall/20260826-170740-before-deploy` | **通过**；PostgreSQL custom dump、运行文件、环境/systemd/Nginx/UFW、Origin 证书 | 2026-08-26 17:07 CST / Cursor Agent |
| 服务器回归与后端发布 | 快进到应用提交后 `npm ci`、完整后端测试、`npm --workspace backend run check`，再重启 `campuswall.service` | **通过**；服务器 90/90，0 漏洞；服务于 17:07:53 CST 进入 `active`，`127.0.0.1:5412/health` 正常；`NODE_ENV=production` | 2026-08-26 17:07–17:08 CST / Cursor Agent |
| Cloudflare Pages 发布 | 生产 Linux 构建同一提交后 Wrangler Direct Upload；deployment `https://475e810d.guanlan-campus-wall.pages.dev` | **通过**；113 个文件中上传 40 个、复用 73 个；临时 OAuth 配置已从源站删除 | 2026-08-26 17:08–17:10 CST / Cursor Agent |
| 公网接口冒烟 | `api-wall.zongtech.xyz/health`、Pages 首页与 `/wall` 深链、正式与恶意 Origin 预检、未登录会话 | **通过**；健康与页面 200，正式 Origin 返回带凭据 CORS，恶意 Origin 不返回允许头，未登录会话为未登录 | 2026-08-26 17:10–17:11 CST / Cursor Agent |

### 15.5 3.4 飞书登录与关闭对外注册验收记录

本轮关闭对外注册，前台改为飞书登录并按固定 `chat_id` 校验群成员，普通用户禁止密码登录，超级管理员可在用户与权限中创建后台账号。**本轮没有执行压力、容量、长稳或渗透测试**；完整飞书扫码登录仍需群成员在真实设备上完成。

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| GitHub 发布门禁 | 应用提交 `010c0ac4c951a8212accb844e7cb89014d41e5c7`；Actions run `32975303020` | **通过**；原生 PostgreSQL、109/109 后端测试、前端生产构建、0 漏洞审计 | 2026-08-26 21:37 CST / GitHub Actions |
| 生产备份 | `/www/backups/campuswall/20260826-214016-before-deploy` | **通过**；PostgreSQL custom dump、运行文件、环境/systemd/Nginx/UFW、Origin 证书 | 2026-08-26 21:40 CST / Cursor Agent |
| 服务器回归与后端发布 | 快进到应用提交后 `npm ci`、完整后端测试、`npm --workspace backend run check`，再重启 `campuswall.service` | **通过**；服务器 109/109，0 漏洞；服务于 21:40:29 CST 进入 `active`，`127.0.0.1:5412/health` 正常 | 2026-08-26 21:40 CST / Cursor Agent |
| Cloudflare Pages 发布 | 生产 Linux 构建同一提交后 Wrangler Direct Upload；deployment `https://56a2edd6.guanlan-campus-wall.pages.dev` | **通过**；113 个文件中上传 40 个、复用 73 个；临时 OAuth 配置已从源站删除 | 2026-08-26 21:41 CST / Cursor Agent |
| 公网接口冒烟 | `/health`、`POST /api/user/register`、`GET /api/user/feishu/start`、正式与恶意 Origin 预检、未登录会话 | **通过**；健康 ok，注册 404，飞书 start 302 到 `accounts.feishu.cn`，正式 Origin 返回带凭据 CORS，恶意 Origin 不返回允许头 | 2026-08-26 21:41–21:42 CST / Cursor Agent |
| 生产浏览器验收 | 正式域名 `/login`、点击飞书登录、`/admin/login`、未登录 `/lost-found`、首页 | **通过**；前台只剩飞书主按钮，授权页打开扫码登录；后台仍是用户名密码；失物招领未登录会回到 `/login` | 2026-08-26 21:42 CST / Cursor Agent |

### 15.6 3.5 待审用户名密码注册验收记录

本轮恢复对外用户名密码注册：新账号 `pending`，审核员在用户与权限中通过后才能登录；飞书登录仍立即进入。管理员文本日志写入失败不再把已成功的后台保存打成 500。**本轮没有执行压力、容量、长稳或渗透测试**。

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| GitHub 发布门禁 | 应用提交 `237ccb3917826d72179aae388ea5e5c311f111b6`；Actions run `32982524336` | **通过**；原生 PostgreSQL、111/111 后端测试、前端生产构建 | 2026-08-26 22:47 CST / GitHub Actions |
| 生产备份 | `/www/backups/campuswall/20260826-224937-before-deploy` | **通过**；PostgreSQL custom dump、运行文件、环境/systemd/Nginx/UFW、Origin 证书 | 2026-08-26 22:49 CST / Cursor Agent |
| 服务器回归与后端发布 | 快进到应用提交后 `npm ci`、完整后端测试、`npm --workspace backend run check`、`deploy/prepare-runtime.sh`，再重启 `campuswall.service` | **通过**；服务器 111/111；服务于 22:49:51 CST 进入 `active`，`127.0.0.1:5412/health` 正常 | 2026-08-26 22:49 CST / Cursor Agent |
| Cloudflare Pages 发布 | 生产 Linux 构建同一提交后 Wrangler Direct Upload；deployment `https://48caf7b6.guanlan-campus-wall.pages.dev` | **通过**；113 个文件中上传 41 个、复用 72 个；临时 OAuth 配置已从源站删除 | 2026-08-26 23:02 CST / Cursor Agent |
| 公网接口冒烟 | `/health`、`POST /api/user/register`、`GET /api/user/feishu/start` | **通过**；健康 ok，空注册体 400 用户名校验（不再 404），飞书 start 302 | 2026-08-26 23:04 CST / Cursor Agent |
| 生产浏览器验收 | 正式域名 `/login` 登录/注册 Tab | **通过**；飞书主按钮下方有「注册」，表单为提交注册审核，说明须后台通过后才能登录 | 2026-08-26 23:04 CST / Cursor Agent |

### 15.7 3.6 深色、失物招领浏览、匿名开关与邮箱/飞书绑定验收记录

本轮柔化深色主题并换上校徽；失物招领改为公开浏览、登录后填写；登录用户可关闭默认匿名；注册/主页可绑定验证邮箱；主页可连接飞书并尝试拉群；审核提醒增加可开关邮箱渠道。**本轮没有执行压力、容量、长稳或渗透测试。** Windows Application Control 会拦住本机 Git HTTPS、Sharp 与 Vite/rolldown，因此推送走 isomorphic-git，完整测试与前端构建走源站 Linux。

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| 本地后端测试 | `node --test test/emailNotification.test.js test/feishuAuth.test.js test/notificationProviderRegistry.test.js test/notificationSettingsStore.test.js test/moderationNotifier.test.js test/userStoreAuthPolicy.test.js test/userStorePermissions.test.js` | **通过（51）**；Windows 上完整 `npm --workspace backend test` 仍会被 Application Control 拦住 sharp 相关用例 | 2026-08-26 23:50 CST / Cursor Agent |
| GitHub 发布门禁 | 应用提交 `444a6bf9d0ec90f6d4b393b7f71ed5244647c685` | **源站 Linux 等价门禁通过**；该提交经 isomorphic-git 推送到 `schoolrepo/main` 后未生成 GitHub Actions workflow run。先前 `9d8afda` 的 run `32985237545` 长时间排队且 jobs 为空。源站执行 `npm ci`、完整后端测试与前端生产构建后才发布 | 2026-08-27 00:31 CST / Cursor Agent |
| 生产备份 | `/www/backups/campuswall/20260827-003137-before-deploy` | **通过**；PostgreSQL custom dump、运行文件、环境/systemd/Nginx/UFW、Origin 证书 | 2026-08-27 00:31 CST / Cursor Agent |
| 服务器回归与后端发布 | 快进 `9d8afda` → `444a6bf` 后 `npm ci`、完整后端测试、`npm --workspace backend run check`，再重启 `campuswall.service` | **通过**；服务器 117/117；服务于 00:31:51 CST 进入 `active`，`127.0.0.1:5412/health` 正常。当时生产 `backend.env` 未配置 `SMTP_HOST`/`SMTP_FROM`，验证信与审核邮件渠道不会真正发出 | 2026-08-27 00:31 CST / Cursor Agent |
| Cloudflare Pages 发布 | 生产 Linux 构建同一提交后 Wrangler Direct Upload；deployment `https://ba81a63d.guanlan-campus-wall.pages.dev` | **通过**；上传 42 个文件、复用 72 个；临时 OAuth 配置已从源站删除 | 2026-08-27 00:31 CST / Cursor Agent |
| 公网接口冒烟 | `/health`、未登录 `GET /api/user/lost-found`、`/school-badge.webp`、`/` `/wall` `/login` `/confessions` `/lost-found` `/me`、正式与恶意 Origin 预检 | **通过**；健康 ok；未登录失物招领 200 且 `success: true`；校徽 200 `image/webp`；页面均为 200；正式 Origin 返回带凭据 CORS，恶意 Origin 不返回允许头 | 2026-08-27 00:31 CST / Cursor Agent |
| 生产浏览器验收 | 正式域名 `/lost-found`、`/wall` 发帖弹窗、`/confessions`、`/login` 注册 Tab | **通过**；未登录可浏览失物招领，表单禁用并提示「浏览公开，填写需要登录」；动态/表白墙/登录均为单行主标题；游客发帖仅匿名；注册有选填邮箱。登录后关闭匿名、主页绑邮箱与飞书拉群未用真实账号走通 | 2026-08-27 00:40 CST / Cursor Agent |

### 15.8 Gmail SMTP 与验证链接源站

本轮在源站写入 SMTP（Gmail、587 STARTTLS），验证链接改为 API 源站，避免点开 Pages 域名无法完成绑定。密钥只在 `/etc/campuswall/backend.env`。本机 lark-cli 应用「ZONGRUICHD的飞书 CLI」与校园墙登录应用不是同一个，未覆盖生产 `FEISHU_*`。该 CLI 机器人当时不在任何群内，审核飞书提醒仍须在「管理后台 → 消息提醒」粘贴群自定义机器人 Webhook。**本轮没有执行压力、容量、长稳或渗透测试。**

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| 本地验证链接测试 | `node --test test/emailNotification.test.js` | **通过，4/4** | 2026-08-27 01:10 CST / Cursor Agent |
| 生产 SMTP | 更新 `/etc/campuswall/backend.env` 后重启 `campuswall.service`；源站对发信账号发出测试信 | **通过**；`SMTP_HOST`/`SMTP_FROM`/`SMTP_PASS` 均为 SET；服务 `active`，健康 ok；测试信发送成功 | 2026-08-27 01:10 CST / Cursor Agent |
| 验证链接代码与后端发布 | 应用提交 `e70ff0fbb3c9bd869841e56327b6bf88c2f26876`；备份 `/www/backups/campuswall/20260827-011522-before-deploy`；源站 `npm --workspace backend test` 后重启 | **通过**；118/118；服务于 2026-08-27 01:15 CST `active`，健康 ok。本轮无前端变更，未重复发布 Pages | 2026-08-27 01:15 CST / Cursor Agent |

### 15.9 密码注册 pending_email 类型推断修复

生产 `/login` 注册提交后 toast「注册失败 / 服务器内部错误」。源站日志为 `could not determine data type of parameter $5`：`UserStore.register` 的 INSERT 把 JS `null` 或文本绑到 `$5`（`pending_email`），再写 `CASE WHEN $5 IS NULL`，node-pg 无法让 PostgreSQL 推断该参数类型。INSERT 发生在发信之前，因此这次不是 SMTP。修复是给 `$5/$6/$7` 加 `::text`/`::boolean`，过期时间空分支写 `NULL::timestamptz`。**本轮没有执行压力、容量、长稳或渗透测试。** 无前端变更，不重复发布 Pages。

| 项目 | 命令/证据 | 状态 | 时间/执行人 |
| --- | --- | --- | --- |
| 本地相关测试 | `node --test test/userStoreAuthPolicy.test.js test/emailNotification.test.js` | **通过（16）** | 2026-08-27 01:50 CST / Cursor Agent |
| GitHub 发布门禁 | 应用提交 `a521da64f4bf444a3417459bffbe56e7747fd6b2`；Actions run `32996795138` | **通过**；job `verify` 约 27s | 2026-08-27 01:55 CST / Cursor Agent |
| 生产备份与后端发布 | 备份 `/www/backups/campuswall/20260827-015705-before-deploy`；源站快进后 `npm ci`、`npm --workspace backend test`（119/119）、`check`，再重启 `campuswall.service` | **通过**；服务于 01:57:20 CST `active`，健康 ok。本轮无前端变更，未重复发布 Pages | 2026-08-27 01:57 CST / Cursor Agent |
| 公网注册冒烟 | 带邮箱与不带邮箱的 `POST /api/user/register` 均为 201；登录页提交后切回登录 Tab（成功路径） | **通过**；此前 500 的用户名 `111` 未写入数据库，可重试。探测用 pending 账号已停用 | 2026-08-27 02:00 CST / Cursor Agent |

## 16. Git 工作流

1. 从最新 `schoolrepo/main` 开发；
2. 功能分支建议使用 `codex/<主题>`；
3. 提交前确认 `git status --short`，不要加入数据库、上传文件、`.env`、日志、备份或 `artifacts/`；
4. 测试通过后将目标提交推送到 GitHub `main`；
5. 等待该 `main` 提交对应的 GitHub Actions CI 全部通过；CI 未完成或失败时不得部署；
6. 生产服务器和 Cloudflare Pages 只部署该已通过 CI 的同一个 GitHub `main` 提交；
7. 记录上线前提交、上线后提交、备份目录、CI 结果、Pages deployment URL 和验证结果。

生产交付仓库只使用 `schoolrepo/main`。本机即使保留其他只读远端用于追溯，也不得把学校定制代码、生产文档或部署配置推送到该远端；发布前必须同时核对远端名称、目标 URL 和目标分支。

常用核对：

```powershell
git fetch schoolrepo main
git log --oneline --decorate -5
git status --short
git diff --check
```

当前本机通常在 `codex/*` 功能分支，而目标是远端 `schoolrepo/main`，因此确认快进关系后使用：

```powershell
git fetch schoolrepo main
git merge-base --is-ancestor schoolrepo/main HEAD
git push schoolrepo HEAD:main
```

不要误用 `git push schoolrepo main`，它会推送本地名为 `main` 的分支，而不一定是当前已测试的功能分支。若远端 `main` 不是当前 HEAD 的祖先，先停止发布并核对双方提交，不能强推覆盖。

## 17. 生产部署标准流程

生产拆成两条独立发布链：前端由维护者工作站构建并直接上传 Cloudflare Pages；后端代码由生产服务器快进到同一 Git 提交，再由 systemd 重启。不要在服务器运行 Vite、nodemon、PM2 cluster 或把 `frontend/dist` 接回 Nginx。发布记录必须同时写下 Git 提交、Pages deployment URL、服务器备份目录和验证结果。

数据库在本机、CI 和生产均以操作系统原生 PostgreSQL 服务运行；仓库不包含容器定义，npm 不负责数据库服务生命周期。生产继续使用系统 PostgreSQL、`campuswall.service` 和 Nginx，不得在普通 UI 发布中改变这条链路。删除本地辅助启动方式不会迁移、重建或停止生产数据库，也不需要变更 Cloudflare Pages、DNS、Origin Rule 或 Origin CA。

以下 Linux 命令按 Bash 编写。包含生产修改的代码块必须由具备 root 权限的运维人员执行并启用 `set -euo pipefail`；任何一步失败都停止，不要跳过备份、TLS 或健康检查。

### 17.0 一次性 Cloudflare 与源站基线

Cloudflare 配置必须同时满足下表。DNS、Pages 自定义域名和 Origin Rule 是外部状态，不会随 Git 自动恢复；每次交接都要在控制台实际核对。

| 配置 | 生产值 |
| --- | --- |
| Pages 项目 | `guanlan-campus-wall`，构建目录 `frontend/dist` |
| Pages 自定义域名 | `wall.zongtech.xyz` |
| 前端 DNS | CNAME `wall` → `guanlan-campus-wall.pages.dev`，由 Pages 自定义域名管理并走 Cloudflare 代理 |
| API DNS | A `api-wall` → `<源站 IPv4>`，必须保持 Proxied/橙云 |
| Origin Rule 名称 | 建议 `Campus Wall API to 8443` |
| Origin Rule 条件 | `(http.host eq "api-wall.zongtech.xyz" and cf.edge.server_port eq 443)` |
| Origin Rule 动作 | Destination port override = `8443` |
| Configuration Rule | `Campus Wall API strict TLS`；条件 `(http.host eq "api-wall.zongtech.xyz")`；SSL = `Strict` |
| 源站 Nginx | `api-wall.zongtech.xyz`，TLS 监听 `8443`，其余未知路径 404 |
| 源站 TLS | Cloudflare Origin CA，仅包含 `api-wall.zongtech.xyz`，私钥留在源站 |

`wall.zongtech.xyz` 还必须在 Pages 项目的 Custom domains 中显示 Active；只有 DNS 记录而没有绑定 Pages 项目，不算完成。当前区域全局 SSL/TLS 模式为 `Full`，不得为本项目直接改动这个区域级设置。生产使用 Configuration Rule `Campus Wall API strict TLS` 只对 `api-wall.zongtech.xyz` 设为 `Strict`，从而校验 Origin CA 证书且不影响同一区域其他主机。

API 主机名必须是连字符形式 `api-wall.zongtech.xyz`。不要创建、回填或在前端变量中使用 `api.wall.zongtech.xyz`；该嵌套主机名不在当前 Free 区域 Universal SSL 的一级通配符覆盖范围内，会在请求到达 Origin Rule 之前就造成边缘证书不匹配。

源站 443 已由同机既有服务占用，所以 Nginx 只在 8443 接收本项目 HTTPS。安装 Origin CA 证书时在源站生成并保留私钥，只把 CSR 提交给 Cloudflare；仓库、聊天和运维截图中都不得出现私钥：

```bash
set -euo pipefail
install -d -o root -g root -m 0700 /etc/campuswall/tls
install -o root -g root -m 0644 <Cloudflare-Origin-CA-证书文件> \
  /etc/campuswall/tls/api-wall.zongtech.xyz.pem
install -o root -g root -m 0600 <仅存在于源站的私钥文件> \
  /etc/campuswall/tls/api-wall.zongtech.xyz.key
openssl x509 -in /etc/campuswall/tls/api-wall.zongtech.xyz.pem \
  -noout -dates -subject -ext subjectAltName
openssl x509 -in /etc/campuswall/tls/api-wall.zongtech.xyz.pem -pubkey -noout \
  | openssl sha256
openssl pkey -in /etc/campuswall/tls/api-wall.zongtech.xyz.key -pubout \
  | openssl sha256
```

最后两条摘要必须完全相同，SAN 必须包含精确主机名。证书可为 0644，但私钥必须为 0600。

安装 Nginx 和真实 IP 基线：

```bash
set -euo pipefail
cd /www/wwwroot/campuswall-react
install -o root -g root -m 0644 deploy/cloudflare-realip.conf \
  /etc/campuswall/cloudflare-realip.conf
install -o root -g root -m 0644 deploy/nginx-campuswall-api.conf \
  /www/server/panel/vhost/nginx/api-wall.zongtech.xyz.conf
install -o root -g root -m 0644 deploy/nginx-campuswall-legacy-redirect.conf \
  /www/server/panel/vhost/nginx/160.236.110.133.conf
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
```

UFW 只允许 Cloudflare 官方网段访问源站 8443；`5412/5432` 继续拒绝公网。初次建规则时以仓库中经过核对的 real-IP 文件作为同一来源：

```bash
set -euo pipefail
ufw status verbose
awk '/^set_real_ip_from / { gsub(/;/, "", $2); print $2 }' \
  /etc/campuswall/cloudflare-realip.conf |
while IFS= read -r cf_cidr; do
  ufw allow proto tcp from "$cf_cidr" to any port 8443 \
    comment 'Cloudflare to Campus Wall API'
done
ufw status numbered
```

Cloudflare 可能调整网段。维护时分别从 `https://www.cloudflare.com/ips-v4` 和 `https://www.cloudflare.com/ips-v6` 获取最新列表，先审查差异，再同步更新 `deploy/cloudflare-realip.conf`、服务器 include 与 UFW：先增加新网段并验证，最后按编号逐条删除已废弃规则。不要写自动脚本直接清空或重建整套 UFW，也不要用 `ufw allow 8443/tcp` 向全网放行。

Cloudflare 外部配置变更前应以官方文档复核当前行为：[Pages 自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)、[Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)、[Origin Rules](https://developers.cloudflare.com/rules/origin-rules/)、[网络端口](https://developers.cloudflare.com/fundamentals/reference/network-ports/) 与 [Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)。网段以 Cloudflare 官方 IPv4/IPv6 列表为唯一来源。

### 17.1 上线前检查与备份

服务器先做只读检查：

```bash
set -euo pipefail
cd /www/wwwroot/campuswall-react
test "$(git branch --show-current)" = "main"
git status --short
test -z "$(git status --porcelain)"
git rev-parse HEAD
node --version
timedatectl show -p Timezone
systemctl is-active campuswall.service
curl -fsS http://127.0.0.1:5412/health
/www/server/nginx/sbin/nginx -t
df -h /www/wwwroot /www/backups
```

工作树不干净时先识别文件所有者和用途，不要执行 `git reset --hard`。建立 root-only 上线备份：

```bash
(
set -euo pipefail
umask 077
cd /www/wwwroot/campuswall-react
backup_dir="/www/backups/campuswall/$(date +%Y%m%d-%H%M%S)-before-deploy"
case "$backup_dir" in
  /www/backups/campuswall/*-before-deploy) ;;
  *) printf 'invalid backup path\n'; exit 1 ;;
esac
install -d -m 0700 "$backup_dir"
git rev-parse HEAD > "$backup_dir/previous-commit.txt"
runuser -u postgres -- pg_dump -Fc campus_wall > "$backup_dir/campus_wall.dump"
runuser -u postgres -- pg_restore -l < "$backup_dir/campus_wall.dump" >/dev/null
install -m 0600 /etc/campuswall/backend.env "$backup_dir/backend.env"
install -m 0600 /etc/campuswall/tls/api-wall.zongtech.xyz.pem "$backup_dir/origin.pem"
install -m 0600 /etc/campuswall/tls/api-wall.zongtech.xyz.key "$backup_dir/origin.key"
systemctl cat campuswall.service > "$backup_dir/campuswall.service.effective.txt"
/www/server/nginx/sbin/nginx -T > "$backup_dir/nginx.effective.txt" 2>&1
ufw status numbered > "$backup_dir/ufw.status.txt"
tar --exclude='backend/static/chunks' --exclude='backend/static/chunks/*' \
  -czf "$backup_dir/runtime-files.tar.gz" \
  backend/static backend/help backend/logs \
  backend/admin_log.json backend/manage_message.json
sha256sum "$backup_dir/campus_wall.dump" "$backup_dir/runtime-files.tar.gz" \
  > "$backup_dir/SHA256SUMS"
printf 'backup_dir=%s\n' "$backup_dir"
)
```

备份块必须保留外层子 shell `(...)`：`umask 077` 只应影响 root-only 备份，不能泄漏到后续 `git merge` 或 `npm ci`。否则新检出的源码和依赖可能变成 `0600/0700 root:root`，运行用户 `campuswall` 会因 `EACCES` 无法读取并导致服务启动失败。若某个兼容 JSON 尚不存在，应先确认代码是否允许缺失，再从 tar 参数中移除该精确路径；不要用宽泛通配符掩盖错误。Origin 私钥备份必须加密后异机保存，不能进入普通工单附件。

### 17.2 后端代码与配置发布

服务器只快进 GitHub `main`，不在服务器构建或发布前端：

```bash
set -euo pipefail
umask 022
cd /www/wwwroot/campuswall-react
git fetch origin main
git merge --ff-only origin/main
target_commit="$(git rev-parse origin/main)"
test "$(git rev-parse HEAD)" = "$target_commit"
npm ci
runuser -u campuswall -- test -r backend/src/config.js
runuser -u campuswall -- test -r node_modules/pg/package.json
npm --workspace backend test
npm --workspace backend run check
```

用受控编辑器修改 `/etc/campuswall/backend.env`，不要 `source` 该文件（Webhook 或展示文案可能含 shell 特殊字符）。保留真实 `SITE_LAUNCHED_AT`，并确认至少包含：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=5412
ALLOWED_ORIGINS=https://wall.zongtech.xyz
PUBLIC_SITE_URL=https://wall.zongtech.xyz
PUBLIC_API_URL=https://api-wall.zongtech.xyz
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=Lax
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_LOGIN_CHAT_ID=
FEISHU_REDIRECT_URI=https://api-wall.zongtech.xyz/api/user/feishu/callback
```

环境文件仍须 `root:root 600`。若部署资产变化，按 17.0 节重新安装 Nginx/real-IP 文件，再执行：

```bash
set -euo pipefail
umask 022
cd /www/wwwroot/campuswall-react
target_commit="$(git rev-parse origin/main)"
chown root:root /etc/campuswall/backend.env
chmod 0600 /etc/campuswall/backend.env
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
systemctl restart campuswall.service
for attempt in $(seq 1 20); do
  curl -fsS http://127.0.0.1:5412/health >/dev/null && break
  test "$attempt" -lt 20
  sleep 1
done
systemctl is-active campuswall.service
journalctl -u campuswall.service --since '5 minutes ago' --no-pager
test "$(git rev-parse HEAD)" = "$target_commit"
git rev-parse HEAD
```

### 17.3 Cloudflare Pages 前端发布

Pages 发布应从已测试、干净且与目标 `main` 相同的维护者工作区执行。Wrangler 登录凭据由本机安全存储管理，不写入仓库：

```powershell
git status --short
git fetch schoolrepo main
$localSha = git rev-parse HEAD
$remoteSha = git rev-parse schoolrepo/main
if ($localSha -ne $remoteSha) { throw "当前 HEAD 与 schoolrepo/main 不一致，停止 Pages 发布" }
# 在 GitHub Actions 页面或 gh CLI 确认该 $remoteSha 的 CI 已全部通过
npm ci
npm --workspace backend test
npm --workspace backend run check
npm run build
npx wrangler whoami
npm run pages:deploy
```

`npm run pages:deploy` 会再次构建并把 `frontend/dist` 直接上传到 Pages 项目 `guanlan-campus-wall` 的 production branch `main`。保存命令返回的不可变 deployment URL，同时检查稳定地址 `https://guanlan-campus-wall.pages.dev` 和自定义域名。不要把 `.wrangler/`、OAuth 数据或构建临时文件提交到 Git。

### 17.4 DNS、Origin Rule 与端到端验证

上线顺序是：Origin 证书与 Nginx/UFW → API 橙云 DNS → Origin Rule → 后端安全环境变量 → Pages 部署和自定义域名。切换完成后至少验证：

```powershell
Resolve-DnsName wall.zongtech.xyz
Resolve-DnsName api-wall.zongtech.xyz
curl.exe -fsSI https://wall.zongtech.xyz/
curl.exe -fsSI https://wall.zongtech.xyz/wall
curl.exe -fsS https://api-wall.zongtech.xyz/health
curl.exe -i -X OPTIONS https://api-wall.zongtech.xyz/api/user/session `
  -H "Origin: https://wall.zongtech.xyz" `
  -H "Access-Control-Request-Method: GET"
```

SPA 深链接 `/wall` 必须返回页面而不是 Pages 404；API 健康检查必须经过正式域名成功。预检响应必须只允许正式 Origin，实际登录/注册还要在浏览器验证 Cookie、刷新保持登录、后台入口、发帖/上传和失物招领。再用不受信任 Origin 做一遍预检，确认不会返回可凭据访问的允许头。

最后核对 Cloudflare Pages 自定义域名为 Active、API DNS 为 Proxied、Origin Rule 命中条件和目标端口没有被误改；服务器侧确认 Nginx access log 中客户端 IP 已从 `CF-Connecting-IP` 正确恢复。只有 Pages、API、CORS/Cookie、服务日志和主要业务回归全部通过，才算发布完成。

### 17.5 3.0 数据与兼容检查

3.0 启动时会执行加法式数据库初始化：为 `users` 补 `permission_version`，创建 `user_permission_overrides` 与索引，并清理 reviewer/super_admin 的非法覆盖。上线前的 `pg_dump -Fc` 是硬门槛；服务首次启动后只读核对：

```bash
runuser -u postgres -- psql -d campus_wall -c "\d+ users"
runuser -u postgres -- psql -d campus_wall -c "\d+ user_permission_overrides"
runuser -u postgres -- psql -d campus_wall -c "SELECT role, count(*) FROM users GROUP BY role ORDER BY role"
runuser -u postgres -- psql -d campus_wall -c "SELECT effect, count(*) FROM user_permission_overrides GROUP BY effect ORDER BY effect"
```

不要在没有维护窗口时手工执行破坏性 schema 修改。公告首次读取会把旧 `notice.json` 补全为新字段并可能改写文件，因此上线前运行文件备份同样是硬门槛；部署后核对草稿/定时/归档不会从 `/api/notice` 泄漏。模块 registry、主题与 Three.js 主要是代码/浏览器状态，不需要生产数据迁移。QQ/微信没有部署变量或 provider，不能为了“补配置”向生产注入虚构环境项。

## 18. 回滚

### 18.1 仅前端异常

服务器上的 `frontend/dist` 已不参与正式流量，移动它不会回滚 Pages。先从发布记录确定最后一个已验证 Git 提交，在独立临时 worktree 中构建并重新上传该提交：

```powershell
git fetch schoolrepo main
git worktree add "<独立临时目录>" "<已验证提交哈希>"
Set-Location "<独立临时目录>"
npm ci
npm --workspace backend test
npm --workspace backend run check
npm run build
npx wrangler whoami
npm run pages:deploy
```

保存新的 deployment URL 并重复 17.4 节验证。该操作只恢复线上前端，不改变 GitHub `main`；故障稳定后仍应在正常功能分支对错误提交执行 `git revert`，测试并推送，再用新提交重新部署，避免长期让线上内容与 `main` 不一致。不要为了前端故障修改 API DNS、Origin Rule 或服务器 Nginx。

### 18.2 后端代码异常

先读取 `$backup_dir/previous-commit.txt`，确认目标提交后再创建回滚分支或部署该提交。不要用 `git reset --hard` 覆盖不明运行文件。推荐在本地对错误提交做 `git revert`，测试后推送 `main`，再按标准流程部署。后端回滚不会自动回滚 Pages；如果前后端 API 契约不兼容，必须把两边恢复到同一兼容版本。

紧急情况下可在生产目录检出已确认提交并重启：

```bash
set -euo pipefail
umask 022
cd /www/wwwroot/campuswall-react
backup_dir="/www/backups/campuswall/<本次实际备份目录>"
: "${backup_dir:?backup_dir is required}"
case "$(readlink -m "$backup_dir")" in
  /www/backups/campuswall/*) ;;
  *) printf 'invalid backup path\n'; exit 1 ;;
esac
previous_commit="$(cat "$backup_dir/previous-commit.txt")"
git rev-parse --verify "${previous_commit}^{commit}" >/dev/null
test -z "$(git status --porcelain)"
git switch --detach "$previous_commit"
npm ci
npm --workspace backend test
npm --workspace backend run check
systemctl restart campuswall.service
curl -fsS http://127.0.0.1:5412/health
```

这一步只恢复后端代码与依赖。若错误发布还修改了 `/etc/campuswall/backend.env`、Nginx、Origin 证书或 UFW，应从精确的 root-only 备份逐项比对后恢复，不能覆盖整份配置来碰运气。若错误发布含不兼容的数据变更，还必须按下一节评估数据库恢复，不能只回滚代码。恢复服务后应尽快通过正常 Git revert 提交让生产重新回到 `main`，避免长期处于 detached HEAD。

3.0 的权限表/列是加法式且旧版本不会主动读取，代码回滚时默认**保留** `users.permission_version` 与 `user_permission_overrides`，不要为了回滚应用立即 `DROP TABLE/COLUMN`。若旧版本再次上线，它会按旧角色逻辑运行，个人覆盖将暂时不生效，这是降级安全风险；应优先修复并恢复 3.0，而不是长期停留在旧授权模型。确需数据库时间点恢复时，必须连同 3.0 上线后的用户、权限及其他业务写入一起评估，不能只从 dump 中抽回单表造成账号版本不一致。

公告旧记录可能已被规范化写回，但新字段对旧读取兼容；通常保留规范化后的 JSON。只有文件损坏或业务数据错误时才从上线前 `runtime-files.tar.gz` 精确恢复 `backend/static/notice.json`，恢复会丢失上线后的合法公告写入，必须由业务负责人确认。前端主题偏好保存在用户浏览器，无服务器回滚；回滚前端后遗留 `theme-palette` localStorage 不会破坏旧页面。

### 18.3 数据异常

数据恢复会覆盖或合并生产数据，执行前必须停写、再做一次现状备份，并确认恢复时间点。自定义格式备份示例：

```bash
(
set -euo pipefail
umask 077
cd /www/wwwroot/campuswall-react
backup_dir="/www/backups/campuswall/<确认要恢复的实际备份目录>"
: "${backup_dir:?backup_dir is required}"
case "$(readlink -m "$backup_dir")" in
  /www/backups/campuswall/*) ;;
  *) printf 'invalid backup path\n'; exit 1 ;;
esac
test -s "$backup_dir/campus_wall.dump"
runuser -u postgres -- pg_restore -l < "$backup_dir/campus_wall.dump" >/dev/null
systemctl stop campuswall.service
pre_restore_dir="/www/backups/campuswall/$(date +%Y%m%d-%H%M%S)-pre-restore"
case "$(readlink -m "$pre_restore_dir")" in
  /www/backups/campuswall/*-pre-restore) ;;
  *) printf 'invalid pre-restore directory\n'; exit 1 ;;
esac
install -d -m 0700 "$pre_restore_dir"
pre_restore_dump="$pre_restore_dir/campus_wall.dump"
runuser -u postgres -- pg_dump -Fc campus_wall > "$pre_restore_dump"
test -s "$pre_restore_dump"
chmod 0600 "$pre_restore_dump"
runuser -u postgres -- pg_restore -l < "$pre_restore_dump" >/dev/null
runuser -u postgres -- pg_restore --clean --if-exists --exit-on-error \
  --single-transaction -d campus_wall \
  < "$backup_dir/campus_wall.dump"
runuser -u postgres -- psql -d campus_wall -c \
  "SELECT schemaname, tablename, tableowner FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
systemctl start campuswall.service
curl -fsS http://127.0.0.1:5412/health
)
```

root-only 备份目录无法由 `postgres` 直接遍历，因此恢复由 root shell 打开文件，再通过标准输入交给 `pg_restore`。同机恢复不使用 `--no-owner`，以保留 dump 中的对象所有者；若跨服务器角色名称不同，必须先设计并验证 `--role`/授权方案。严格模式下，停服后的任一失败都会让服务保持停止，这是为了避免用部分恢复的数据继续运行；排查并确认数据库一致后再人工启动，不得盲目执行 `systemctl start`。不要在没有确认的情况下恢复数据库或覆盖上传目录。

## 19. 备份与恢复策略

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
- `/etc/campuswall/tls/api-wall.zongtech.xyz.pem` 与 `.key`（私钥只进入加密、root-only 备份）；
- 当前 Git 提交号、Nginx/systemd/UFW 实际配置；
- Pages 项目、自定义域名、两条 DNS 记录、Origin Rule 表达式/动作与区域 SSL 模式的脱敏导出或人工记录。

建议周期：数据库每日、运行文件每日增量/每周完整、每次上线前完整备份。至少保留一个异机加密副本，并定期做恢复演练；只有成功恢复过的备份才可信。

不要把 `backend/static/chunks` 作为必要备份；它是临时分片。不要从 GitHub 恢复数据库、头像、上传、举报、反馈或日志，因为这些数据本来就不在仓库中。

## 20. 账号与日常运营

### 20.1 创建或恢复最高管理员

生产变量只由 systemd 的 `EnvironmentFile` 注入，不能直接运行裸 `npm run admin:reset-password`：普通 shell 不会自动读取 `/etc/campuswall/backend.env`，可能连接默认或错误数据库。使用一次性 transient service，并在提示中输入目标用户名和隐藏的新密码：

```bash
set -euo pipefail
read -r -p '要创建或恢复的超级管理员用户名：' admin_username
test -n "$admin_username"
systemd-run --wait --pty --collect --service-type=exec \
  --uid=campuswall --gid=campuswall \
  -p WorkingDirectory=/www/wwwroot/campuswall-react/backend \
  -p EnvironmentFile=/etc/campuswall/backend.env \
  -p Environment=NODE_ENV=production \
  -p NoNewPrivileges=yes -p UMask=0027 \
  /usr/local/lib/campuswall/node scripts/reset-admin-password.js "$admin_username"
```

命令在终端交互读取新密码，可启用现有账号或创建恢复用超级管理员，并递增旧账号的会话版本。不要 `source /etc/campuswall/backend.env`（Webhook 等值可能含 shell 特殊字符），也不要把密码放在环境变量、命令参数、脚本或文档中。执行后立刻用后台登录验证，再检查系统仍至少保留一个启用的超级管理员。

当前没有用户自助“忘记密码”流程；登录页只会引导到帮助。普通用户密码由有权限的管理员在“用户与权限”中重置，最高管理员恢复使用上述命令，所有重置都应通过独立渠道通知本人并要求使用强唯一密码。

### 20.2 分配角色与个人权限

超级管理员登录后从顶部后台入口进入“用户与权限”，选择用户设置角色或打开个人权限编辑器。角色变化会清空个人覆盖并撤销旧会话；保存/恢复权限必须填写原因、确认高风险操作并以页面读取的 `permission_version` 提交。遇到 409 先刷新再重新判断，不能覆盖另一位管理员的修改。

reviewer 与 super_admin 的权限面板只读；普通 user 与 admin 可在“继承/允许/拒绝”三态间调整，deny 优先。超级管理员不能改自己的角色或权限，审核员和管理员也不能分配角色/个人权限。完成后用目标账号重新登录，并分别验证顶部入口、首个有权页面、一个获权动作和一个明确拒绝的动作；最后从 `/admin/audit` 复核原因与前后差异。

### 20.3 审核员操作

审核员登录前台账号后：

1. 顶部导航出现后台入口；
2. 进入 `/admin` 仪表盘，分别看到帖子审核和表白墙审核的待审计数与入口；
3. 可在 `/admin/wall` 与 `/admin/confessions` 查看全部实际待审内容，包括被管理端设置 `review_hold` 后退回的免审类别，不需要手工输入地址；
4. 查看清晰的内容、附件、标签、投票、提交时间和审核状态；
5. 通过或退回其他人提交的内容；
6. 可处理自己发布的内容；系统仍记录审核账号、时间和结果；
7. 可从后台侧栏进入“公告管理”，发布、编辑、定时、归档和恢复主页公告；
8. 可从后台侧栏进入“用户与权限”，筛选待审注册并通过或拒绝用户名密码注册。默认不能改资料、禁言、重置密码或分配角色。

审核员除通用仪表盘、帖子审核、表白墙审核、公告管理与用户管理（注册审核/停用普通用户）外，不应看见设置、举报、反馈、日志或回收站等管理模块。

## 21. 监控与日志

常用命令：

```bash
systemctl status campuswall.service --no-pager
journalctl -u campuswall.service -n 200 --no-pager
journalctl -u campuswall.service --since "1 hour ago" --no-pager
curl -fsS http://127.0.0.1:5412/health
/www/server/nginx/sbin/nginx -t
curl -fsS https://api-wall.zongtech.xyz/health
curl -fsSI https://wall.zongtech.xyz/
tail -n 200 /www/wwwlogs/campuswall-api-error.log
tail -n 200 /www/wwwlogs/campuswall-api-access.log
tail -n 200 /www/wwwroot/campuswall-react/backend/logs/info.log
df -h
free -h
sudo -u postgres psql -d campus_wall -c "SELECT 1;"
```

后台错误日志接口优先读取 Express 实际写入的 `backend/logs/info.log`，仅在该文件不存在时兼容旧 `backend/error.log`。管理员日志、操作审计和错误日志页面都支持 CSV 导出：管理员/错误日志只展示并导出最近最多 1000 行中的当前搜索结果，页面必须明确这一范围；操作审计按当前搜索与对象筛选逐页读取全部匹配记录，并用首次查询返回的 `snapshot_id` 固定导出上界，避免导出期间新增事件导致重复或遗漏。三个敏感读取接口都返回 `private, no-store`。CSV 使用 UTF-8 BOM 以兼容常见表格软件，并对以 `= + - @` 开头的单元格做公式注入防护。导出不会扩大查看权限，也不能替代服务端备份、保留和轮转；对外分享前仍须脱敏。

重点告警信号：

- systemd 反复重启或健康检查失败；
- PostgreSQL 连接失败、磁盘空间接近下限；
- 头像/上传频繁返回 429、400 或 Sharp 解码错误；
- 审核通知 outbox 大量重试或持续失败；
- Pages 深链接 404、Cloudflare 5xx、API 请求体过大或 Origin Rule 回源失败；
- 待审内容出现在公开接口；
- 最后一位超级管理员被停用或没有可登录的审核员。

日志、数据库查询结果和截图可能含用户信息，对外分享前必须脱敏。

## 22. 常见故障

### 页面刷新后 404

正式页面由 Cloudflare Pages 托管，不再检查源站 Nginx 的 `try_files`。先确认 `https://guanlan-campus-wall.pages.dev/<同一路径>` 是否正常、Pages production deployment 是否来自预期提交、项目中没有把自定义 `404.html` 误当 SPA fallback，再重新部署并检查自定义域名状态。

### API 502

依次检查 `campuswall.service`、`127.0.0.1:5412/health`、systemd 日志、Nginx 8443 vhost 和 `proxy_pass`。若源站本机健康而公网失败，继续检查 API 橙云 DNS、Origin Rule 和 UFW Cloudflare 网段。

### Cloudflare 返回 521、522、525 或 526

确认 `api-wall` 仍为 Proxied、Origin Rule 精确匹配主机名和边缘 443 并覆盖到 8443、UFW 已允许当前 Cloudflare 网段、Nginx 正在监听 8443。525/526 还要检查区域 SSL 模式、Origin CA 证书有效期/SAN、证书与私钥摘要是否匹配；不要通过改成 Flexible 或关闭证书校验长期绕过。

### 登录后刷新变成未登录

检查站点是否 HTTPS、`SESSION_COOKIE_SECURE`、`SESSION_COOKIE_SAMESITE`、`ALLOWED_ORIGINS`、反代的 `X-Forwarded-Proto` 和浏览器 Cookie。

### 登录时报 `Invalid request origin`

将实际前端来源（协议、域名、端口必须完全一致）加入 `ALLOWED_ORIGINS`，重启后端。不要用 `*` 配合凭据请求。

### 上传失败或 Nginx 413

先辨认错误响应来自 Cloudflare、Nginx 还是 Express，再检查对应层。源站侧同时检查 Nginx `client_max_body_size`、后端大小限制、磁盘总量/剩余空间限制、上传次数/字节/并发限流和目录权限。

### Sharp 在 Linux 启动失败

使用 Node 22.12+ 的当前 LTS，在服务器目标系统重新执行 `npm ci`，不要复制 Windows `node_modules`。确认 `sharp` 原生依赖与服务器架构匹配。

### 头像仍显示旧图

接口使用重新验证缓存。先确认用户记录中的 `avatar_file` 已更新、文件存在于 `backend/static/avatars`，再检查浏览器请求是否返回新 ETag/内容；不要通过永久 immutable 规则缓存头像接口。

### 获权账号看不到后台入口

确认账号状态启用并重新登录，再检查 `/api/user/session` 是否返回非空 `capabilities`。入口不再看角色名；普通 user 获权后也应显示，admin 被 deny 到没有任何 capability 后应隐藏。前端异常时检查 `UserContext`/`Layout`，但后端仍必须独立拒绝无权接口。

### 飞书登录失败或一直回到登录页

先看 `/login?feishu_error=`：`not_in_group` 表示用户不在 `FEISHU_LOGIN_CHAT_ID` 群内或应用机器人已退群；`not_configured` 表示服务器未配齐 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_LOGIN_CHAT_ID` / `FEISHU_REDIRECT_URI`；`invalid_state` 常见于 Cookie 的 SameSite 被改成 Strict、回调域名与开放平台不一致。不要把审核提醒 Webhook 填进登录变量。完整步骤见 `docs/FEISHU_LOGIN.md`。

### 点击顶部后台入口又要求登录

有效 `user_session` 或 `admin_session` 都应能通过 `GET /api/admin/verify`。若跳到 `/admin/login`，先查看 verify 是否因 Cookie 域/SameSite/Secure、账号停用、`session_version` 变化或能力已被收回而失败；不要直接绕过 `ProtectedRoute`。用户也可在 `/admin/login` 建立独立后台 Cookie，但该登录会清理前台 Cookie，返回个人中心时可能需要重新登录。

### 密码注册 toast「服务器内部错误」

若 `backend/logs/info.log` 出现 `could not determine data type of parameter $5` 且栈在 `UserStore.register`，是 `pending_email` 绑定 `null` 时 PostgreSQL 无法推断类型，不是 SMTP。确认生产代码已含 `$5::text` / `$6::boolean` / `$7::text` 与 `NULL::timestamptz` 后再试；发信失败应只影响 `email_queued`，不应让整次注册 500。

### 审核通知没有发送

先在“管理后台 → 消息提醒”确认渠道为“发送中”，用固定测试消息区分凭据/网络问题与 outbox 问题；旧环境变量部署再确认 `MODERATION_NOTIFY_ENABLED=true` 并已重启。随后检查服务器可访问机器人官方域名、systemd 脱敏日志和 `moderation_notification_outbox` 状态。不要通过关闭审核或在发帖请求中同步调用 Webhook 来“修复”。

## 23. 安全检查表

- [ ] 生产 `SECRET_KEY` 与数据库密码不是示例值；
- [ ] 飞书登录 `FEISHU_APP_SECRET` 已在开放平台轮换（若曾出现在聊天中）且未进入 Git/`VITE_*`；
- [ ] 生产 `NOTIFICATION_MASTER_KEY` 是独立长随机值且未进入 Git/截图；
- [ ] `/etc/campuswall/backend.env` 为 `root:root 600`；
- [ ] Git 中不存在 `.env`、数据库、上传、头像、日志或备份；
- [ ] `ALLOWED_ORIGINS` 只包含真实来源；
- [ ] HTTPS 下启用 `SESSION_COOKIE_SECURE=true`；
- [ ] PostgreSQL 和 Node 后端端口未向公网开放；
- [ ] `api-wall.zongtech.xyz` 保持橙云代理，`Campus Wall API strict TLS` Configuration Rule 以精确主机条件设置 SSL `Strict`；
- [ ] Origin Rule 同时匹配 `api-wall.zongtech.xyz` 与边缘 443，且只覆盖目标端口 8443；
- [ ] DNS、前端变量、证书 SAN 和 Nginx 中均不存在旧嵌套名 `api.wall.zongtech.xyz`；
- [ ] 源站 8443 仅允许 Cloudflare 官方 IPv4/IPv6 网段，UFW 与 real-IP include 使用同一份已核对列表；
- [ ] Origin CA 证书 SAN/有效期正确，私钥为 `root:root 600` 且从未进入 Git/聊天；
- [ ] Pages 自定义域名为 Active，生产构建只含公开 `VITE_*` 配置；
- [ ] Nginx 未直接公开受保护运行目录；
- [ ] 所有写接口均有来源校验、鉴权或对应限流；
- [ ] 后端按动作级 capability 再次鉴权，不能仅依赖角色、旧粗权限或前端隐藏；
- [ ] 权限不变量正确：deny 最终优先；reviewer/super_admin 覆盖锁定；根能力不可下放；禁止自己；至少一名启用超级管理员；角色变化清覆盖；权限变化撤销会话；
- [ ] 审核矩阵正确：游客/无免审能力账号的普通动态与表白便签初始待审；具备 `content.publish.bypass_review` 的账号免审；所有登录用户的失物招领初始免审；任意内容被明确退回后带 `review_hold` 入队且作者编辑不能自行公开；帖子/表白墙只做展示分流，所有 reviewer 完全同权；
- [ ] 分类边界正确：结构化 `lost_found` 优先进入帖子侧；其余内容仅精确标签 `表白` 进入表白墙侧；标签编辑可以换页但不能清除审核锁；
- [ ] 学校已书面接受审核员可自审全部帖子、可直接维护公告且审核员本人看不到审计的高信任模型；审核员人数最小化、使用强唯一密码，并由管理员定期复核审计；
- [ ] 公告和反馈/举报 JSON 已纳入备份，服务账号只有必要写权限；
- [ ] 公告正文始终按纯文本渲染，遗留 `innerHTML` 页面没有重新启用；
- [ ] 上传同时受扩展名与文件头类型、大小、字节、并发、磁盘、路径限制，以及分片合并互斥；
- [ ] 机器人 Webhook 不在前端或日志中泄露，且只接受官方 HTTPS 目标；QQ/微信未实现状态没有被误报为已上线；
- [ ] 备份已加密、可恢复且存在异机副本。

## 24. 已知限制与后续建议

- Cloudflare Pages、DNS、Origin Rule、区域 SSL 和 UFW 是 Git 之外的关键状态，目前没有 IaC 自动重建；必须保留脱敏变更记录并定期人工核对；
- Origin Rule 只重写边缘 443；若未来需要阻止用户显式访问 Cloudflare 支持的其他 HTTPS 端口，应在评估现有业务后增加精确 WAF 规则，不能把当前 Origin Rule 扩成匹配所有端口；
- API Origin CA 证书只适用于橙云回源；任何 DNS-only 故障切换都必须先更换为浏览器信任的公开证书，并重新评估源站暴露和防火墙；
- 生产分析脚本目前会连接 Umami；在面向未成年学生正式开放前，应确认学校的隐私告知、数据范围与是否继续启用；
- 机器人提醒需要学校自行创建飞书或企业微信群机器人并在服务器注入密钥；QQ 与微信尚未实现，只能按 `docs/NOTIFICATION_INTEGRATION.md` 的官方路线新增，禁止个人号逆向/Hook；
- Three.js 表白墙构建分包较大；页面已路由懒加载，后续应继续优化 Three.js vendor/场景的按需加载与移动端降级；
- 表白墙的 280 字和强制匿名目前只由专用前端页面执行，通用发帖 API 仍使用全站正文上限，也可直接提交 `#表白` 且关闭匿名；若这是产品安全不变量，必须在后端按内容类型强制并补绕过测试；
- 失物招领页面与 API 的字段校验不完全一致：页面要求地点并使用较短上限，后端允许空地点且上限更宽；应统一后端契约、前端提示和测试，修复前不能把页面限制当作服务端安全保证；
- 主题三态和五种强调色只保存在当前浏览器，不与账号同步；清站点数据或换设备会恢复默认，若以后做云同步需明确隐私、版本合并和未登录回退；
- 前台与后台仍使用两个 Cookie，但后端会统一解析任一有效会话并按 capability 进入后台；这不是完整 OAuth/SSO。修改登录/退出流程必须继续保证 `session_version` 对两类会话即时生效；
- 用户名后端按 Unicode code point 计算 2–24 字符，注册页的 `maxLength=24` 按 UTF-16 code unit 截断；含非 BMP 字母时前端可能比后端更早截断，后续应统一计数和提示；
- 公告已有草稿、定时发布、归档恢复和提醒修订，JSON 写入已改为临时文件替换，但仍是单进程、无文件锁、无乐观锁、无版本历史；并发最后写入胜出。应优先迁移到 PostgreSQL 事务存储并保留文件备份；
- 当前细粒度权限没有 WebAuthn/TOTP step-up；高危分配虽有超级管理员限制、禁止自己、原因、确认、版本和审计，仍应把二次验证列为后续安全增强；
- 话题目录当前从进程内全部消息聚合真实标签；单实例与当前规模可用，但大规模时应迁移到 PostgreSQL 聚合/物化统计并保留公开过滤，不能用缓存泄露待审或失物招领；
- 模块 registry 是同仓编译期机制加服务端允许清单，不是可上传代码的运行时插件系统；远端 manifest 永远不能携带脚本或 import URL；
- 反馈、举报和兼容管理员日志同样是非事务 JSON，但写入已改为临时文件替换，并受条数上限约束。举报归档会先改待处理文件再写已处理文件，故障窗口可能丢记录；这些文件缺统一保留/轮转策略且 `admin_log.json` 会持续增长，应定期备份并迁移到 PostgreSQL 事务存储；
- 遗留静态公告脚本使用 `innerHTML`，若旧 HTML 被重新启用可能产生存储型 XSS；正式删除旧入口或改为文本节点前不得恢复引用；
- 当前图标子集仍缺少已被 JSX 引用的若干图标（包括 `chat-left-dots`、`clipboard-check`、`collection`、`file-earmark-ruled`、`info-circle`、`megaphone-fill`、`patch-check-fill`、`person-gear`、`play-btn`、`search-heart`），相关页面可能出现空白图标；应补齐本地 subset 或替换为已有图标，并增加构建期引用扫描；
- 前端目前没有单测、E2E 或自动化无障碍测试，关键响应式、主题、Modal、Three.js 降级和角色导航主要依赖第 15 节人工矩阵；
- 朋友圈式动态和发布器目前也没有自动化视觉/E2E 覆盖；1/2/3/4/5–9/>9 媒体网格、20 文件上限、对象 URL 释放、完整预览索引、草稿不持久化附件、窄屏/软键盘与键盘焦点都依赖第 15 节人工矩阵，后续应优先补充可重复测试；
- 可增加定期扫描无数据库引用头像的维护任务，处理进程崩溃留下的极少量孤儿文件；
- 评论当前是发布后管理，不是先审后发；如学校要求评论也先审，需按第 8 节完整扩展；
- 应为备份增加自动化、保留策略、异机复制和恢复演练记录；
- 应增加 HTTPS、外部可用性、磁盘、数据库和 outbox 积压监控。
- 本轮没有执行压力、容量、长稳或渗透测试；不能据此承诺并发上限或 SLA，性能结论必须由独立、脱敏且经授权的测试计划提供。

## 25. 最终交接清单

- [ ] 接手人已获得 GitHub 仓库权限；
- [ ] 接手人已通过密码管理器获得服务器/宝塔凭据；
- [ ] 接手人知道生产目录、systemd 服务和环境文件位置；
- [ ] 接手人拥有 Cloudflare Pages/DNS/Rules 的最小必要权限，能找到项目 `guanlan-campus-wall`；
- [ ] 接手人能解释 `wall.zongtech.xyz` → Pages 与 `api-wall.zongtech.xyz` → Cloudflare → 8443 → Nginx → 5412 两条链路；
- [ ] 接手人已核对 DNS 橙云、Pages Custom domain、Origin Rule 精确表达式、API 专用 Strict Configuration Rule 和 UFW Cloudflare-only 规则；
- [ ] 接手人知道 Origin CA 证书/私钥路径，且确认私钥未进入 Git；
- [ ] 接手人能在本地 1145 端口启动前端并运行后端测试；
- [ ] 接手人已安装并能通过操作系统服务管理器启动 PostgreSQL，理解 `dev:local` 只等待数据库而不管理服务；
- [ ] 接手人能完成一次无变更构建和健康检查；
- [ ] 接手人确认 `SITE_LAUNCHED_AT` 是真实首次上线时间，普通部署不会重置；
- [ ] 接手人理解四种角色及“所有审核员完全同权”的规则；
- [ ] 接手人能解释角色默认 + allow/deny（deny 优先）、三态编辑器、依赖、`permission_version`、会话撤销和 reviewer/super_admin 锁定；
- [ ] 接手人能使用万级用户管理的服务端筛选、排序、分页与操作菜单，知道角色/状态标签不能拆字，并了解首次补索引与高偏移分页的维护边界；
- [ ] 接手人理解前台/后台双 Cookie 的统一解析；能让获权普通 user 从顶部进入后台，并确认无权页面/API 被拒绝；
- [ ] 接手人已按 `notice.read/create/update/delete` 验证公告只读/创建/编辑/归档，并验证草稿、定时、优先级、提醒修订和恢复；
- [ ] 接手人能使用真实标签话题目录，理解精确标签与失物招领「浏览公开、填写须登录」边界；
- [ ] 接手人能从 ThemePicker 切换 system/light/dark 与五种强调色，并理解设置只存本机；
- [ ] 接手人读过 `docs/MODULE_DEVELOPMENT.md`，能用 registry、manifest、版本化 API 和 capability 新增板块；
- [ ] 接手人读过 `docs/NOTIFICATION_INTEGRATION.md`，知道飞书/企业微信/审核邮箱已实现而 QQ/微信未实现；
- [ ] 接手人读过 `docs/FEISHU_LOGIN.md`，知道前台飞书登录与审核 Webhook 不是同一套应用，且进群校验用 `chat_id` 而不是群名；
- [ ] 接手人知道公告、反馈、举报、管理员日志和上传等运行文件不是 Git 数据；
- [ ] 接手人已验证浅色、深色、跟随系统、五种强调色、手机 safe-area、reduced-motion、Three.js 波纹/暂停/降级和失物招领浏览/填写边界；
- [ ] 接手人已按 1/2/3/4/5–9/>9 规则验证动态媒体网格，并完成发布器 20 文件、完整预览、草稿、移动端和键盘无障碍回归；
- [ ] 接手人能分别执行 Pages 与后端发布，记录 deployment URL/提交，并能独立回滚其中一侧；
- [ ] 接手人已做一次数据库和运行文件恢复演练；
- [ ] 接手人知道如何轮换管理员密码、数据库密码、`SECRET_KEY`、飞书登录 App Secret 与机器人密钥；
- [ ] GitHub、本机和生产服务器上的 `HANDOFF.md` 来自同一 `main` 提交。

## 26. 文档维护与变更记录

出现以下任一变化时，同一提交必须更新本文档：角色/权限映射、审核状态机、公开性规则、API 契约、数据库表、权威 JSON、上传目录、环境变量、域名/端口、systemd/Nginx、备份恢复、通知渠道、真实上线时间或主要前端交互。仅改文案或样式时，如果会改变运营方法、可访问性或验收口径，也要更新对应章节。

维护步骤：

1. 从 `main` 最新代码重新核对路由、`roles.js`、数据 store、部署资产和 `.env.example`，不要只复制旧文档；
2. 使用脱敏值和占位路径，确认文档不含密码、Webhook、Cookie、私钥、生产用户内容或数据库转储；
3. 执行测试、构建、`git diff --check`，并人工检查 Markdown 标题、表格、代码围栏和复制命令；
4. 只显式暂存 `HANDOFF.md` 与本次确需更新的文档，确认没有把运行数据、日志、备份或 `artifacts/` 带入提交；
5. 推送 GitHub `main` 后，以快进方式同步生产仓库；纯文档提交不需要重启服务，但仍要核对提交哈希和公网健康；
6. 确认本机、GitHub 和生产仓库三份文件来自同一提交，并在交接记录中写下验证时间和人员。

变更记录：

- `3.6`（2026-08-26）：深色改为 grouped 抬升底与轻阴影；校徽替换 favicon 与顶栏图标；删除动态/表白墙双行标题，后续新功能只用单行主标题。失物招领公开浏览、填写必须登录并以实名身份发布。登录用户可关闭默认匿名。用户名注册可选邮箱，主页可验证邮箱、开关邮件通知并连接飞书账户（绑定后尝试拉进登录校验群）。审核提醒新增可开关邮箱渠道，SMTP 只进服务器环境。验证链接走 API 源站。密码注册 INSERT 为 `pending_email` 等参数加 PostgreSQL 类型转换，避免 node-pg 对 `null` 无法推断类型导致 500。
- `3.5`（2026-08-26）：恢复用户名密码注册，新账号 `pending`，须审核员在用户与权限中通过后才能登录；飞书登录仍立即进入。拒绝注册会停用该用户名。管理员文本日志写入失败不再让后台保存返回 500。
- `3.4`（2026-08-26）：关闭对外注册；前台默认飞书登录，服务端按固定 `chat_id` 校验群成员；普通用户禁止密码登录；超级管理员可在用户与权限中创建后台账号。App Secret / chat_id 只进服务器环境变量。
- `3.3`（2026-08-26）：收紧生产类环境启动守卫（占位 `SECRET_KEY`、默认库密码含 `DATABASE_URL` 内嵌、`PGSSL_REJECT_UNAUTHORIZED`）；分片合并加互斥锁并按文件头校验类型，ffmpeg 失败拒收；游客互动 Cookie 改为 HMAC 签名；公开资料不再暴露停用状态，注册冲突不再返回可枚举错误码；改密按账号限流；反馈/举报 JSON 增加条数上限与原子替换写。
- `3.2`（2026-08-26）：新增独立“消息提醒”后台页面与侧栏入口，飞书/企业微信可分别启停、write-only 保存/清除凭据并发送固定测试；新增三项细粒度 capability、测试限流和成功/失败脱敏审计。通知配置按 provider 使用 AES-256-GCM 存入 `platform_settings`，环境变量仅作无数据库记录时的回退；worker 支持等待在途发送后动态热加载，无需重启。QQ/个人微信在 UI 中只显示官方限制与文档链接，不提供假配置表单。
- `3.1`（2026-08-26）：把审核提醒的飞书、企业微信实现拆为显式 provider registry 与独立适配器，公共 worker 保留 outbox 调度、超时、限流、重试和回执；重复/残缺适配器在启动时 fail fast，未知 provider 在发起网络请求前 fail closed。新增 provider 静态脱敏 manifest 与定向测试，覆盖真实 dispatcher 接线、429、非法 JSON、超时和未知通道；QQ/微信仍未注册，接入前必须先迁移 `target_id`。
- `3.0`（2026-08-26）：新增角色默认 + 逐用户 allow/deny 的动作级权限体系、三态权限编辑器、`permission_version` 乐观锁、会话即时失效与审计；保留旧粗权限 bundle 兼容并锁定 reviewer/super_admin。`/p` 改为真实公开标签聚合目录；Three.js 表白便签爱心加入实例拾取、精选轮播、波纹突出、离屏暂停与降级；主题增加跟随系统和五种强调色。公告升级为标题/摘要/正文/优先级/草稿/定时/归档恢复/提醒修订及细权限 UI。新增前后端模块 registry、`GET /api/modules` 与 `docs/MODULE_DEVELOPMENT.md`；加固审核提醒 outbox，并以 `docs/NOTIFICATION_INTEGRATION.md` 完整说明飞书/企业微信现状和 QQ/微信官方后续路线。明确继续使用原生 PostgreSQL、Nginx/systemd 与 Pages，不使用 Docker；本轮不包含压力测试，最终测试/部署结果必须在 15.1 节据实补录。
- `2.4`（2026-08-26）：动态图片预览改为微信式沉浸灯箱并补键盘/滑动/保存/失败降级；新帖子图片统一服务端 WebP 压缩并删除原图；修复小头像被 multipart 限制误拒；用户管理升级为面向 10,000+ 账号的数据库分页、前缀搜索、索引、统计、排序与无横向滚动卡片，角色/状态标签强制单行；后台三类日志支持安全 CSV 导出并统一错误日志读取路径；清理动态、表白墙与个人资料的冗余视觉信息；GitHub Actions 增加完整后端自动化测试门禁；生产备份改为隔离 `umask 077` 的子 shell，并在代码/依赖发布前显式恢复 `umask 022` 与服务账号可读性检查。
- `2.3`（2026-08-26）：校园动态改为朋友圈式信息层级与 SwiftUI 视觉组合，明确 1/2/3/4/5–9/>9 媒体规则、20 文件发布器、完整预览、草稿、移动端/主题/无障碍验收；本地与 CI 统一使用操作系统原生 PostgreSQL，删除仓库中的容器化数据库启动链路，并确认生产仍为 Pages + Nginx/systemd + 原生 PostgreSQL。
- `2.2`（2026-08-26）：后台审核拆为 `/admin/wall` 普通帖子与 `/admin/confessions` 表白墙两个展示队列；保留统一 `review_posts` 权限，补齐精确标签/失物招领分类、机器人深链、全站计数和响应式/无障碍验收口径。
- `2.1`（2026-08-25）：前端迁移到 Cloudflare Pages 与 `wall.zongtech.xyz`；补齐独立 API 域名、Origin CA、Nginx 8443、精确 Origin Rule、Cloudflare-only UFW、双发布链、端到端验证与独立回滚流程。
- `2.0`（2026-08-25）：按当前 React/PostgreSQL/systemd 生产实现重写；补齐统一账号与四角色权限、审核员全局同权、公告系统、机器人提醒、头像处理、Apple/SwiftUI 前端、表白便签、失物招领、真实上线时间、安全部署/回滚及已知限制。
- `1.x`：早期开发阶段说明，已被本版取代；历史部署资料仅供追溯，不能覆盖当前代码与部署资产。
