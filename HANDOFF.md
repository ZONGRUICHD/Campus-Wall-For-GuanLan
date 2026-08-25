# 龙华区观澜中学校园墙——项目交接文档

> - 最后更新：2026-08-25
> - 文档版本：2.0
> - 适用分支：`main`
> - 代码仓库：<https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan>
> - 学校名称：龙华区观澜中学
> - 最近一次功能基线：`809285f`（管理员公告系统）

本文档用于开发、审核、运维和应急接管。它说明当前产品规则、代码结构、账号权限、审核流程、数据位置、本地运行、生产部署、备份恢复和常见故障。功能细节以 `main` 分支代码为最终事实来源；本文件应在每次改变架构、权限、数据结构或部署方式时同步更新。

## 1. 交接原则与敏感信息

以下信息绝不能写入 Git、工单、截图或公开聊天：

- SSH 密码、私钥和宝塔面板密码；
- `SECRET_KEY`、数据库密码、Cookie 或会话值；
- 飞书/企业微信群机器人 Webhook 与签名 Secret；
- 学生个人信息、未公开内容、举报/反馈正文和生产日志原文；
- 生产数据库、头像和上传文件的未加密备份。

服务器地址、账号、密码和第三方机器人密钥应通过独立密码管理器交接。仓库只保留变量名、路径、操作命令和脱敏示例。发现凭据曾被提交到 Git 时，不能只删除文件，必须立即轮换该凭据并检查历史记录。

接手人在取得权限后的第一天应完成：验证 SSH 密钥登录、轮换任何曾通过聊天或临时渠道传递的密码、检查生产环境文件权限、确认至少两位可登录的管理角色、执行一次只读备份校验，并记录操作人和时间。不要在尚未验证新凭据可用前关闭旧登录方式。

## 2. 当前环境与来源

| 环境 | 位置 | 用途 |
| --- | --- | --- |
| 本机工作区 | `<本机工作区>\campuswall-react` | 开发、测试、构建与提交；实际绝对路径由接手人自行记录，不写入公开仓库 |
| GitHub | `ZONGRUICHD/Campus-Wall-For-GuanLan` 的 `main` | 唯一代码交付分支 |
| 生产项目目录 | `/www/wwwroot/campuswall-react` | 服务器当前检出的代码 |
| 前端静态目录 | `/www/wwwroot/campuswall-react/frontend/dist` | Nginx 对外托管的构建产物 |
| 后端工作目录 | `/www/wwwroot/campuswall-react/backend` | Node/Express 服务工作目录 |
| 后端环境文件 | `/etc/campuswall/backend.env` | 生产变量与密钥，权限必须为 `root:root 600` |
| systemd 服务 | `campuswall.service` | 后端常驻与自动重启 |
| 后端监听 | `127.0.0.1:5412` | 只允许 Nginx/本机访问 |
| PostgreSQL 数据库 | `campus_wall` | 账号、留言、权限、通知、审计等结构化数据 |
| 生产备份根目录 | `/www/backups/campuswall` | 每次上线前和定期备份 |

当前仓库中的生产基线：

- 公网入口：`http://160.236.110.133/`；当前仍是 HTTP，绑定正式域名并启用 HTTPS 前不能设置只适用于 HTTPS 的访问假设；
- 真实上线起点：`2026-08-25T01:48:50+08:00`，由 `SITE_LAUNCHED_AT` 提供；这是首次验证公网 HTTP 200 的时间，不得在普通重启或发布时重置；
- 服务器时区应保持 `Asia/Shanghai`（用 `timedatectl` 核对）；公告、反馈等 JSON 的无时区时间字符串直接使用服务器本地时间，时区错误会造成展示和排序歧义；
- 生产 Git 远端应指向 `ZONGRUICHD/Campus-Wall-For-GuanLan`，部署来源只允许 `origin/main` 的快进提交；
- 最新实际状态必须以生产机上的 `git rev-parse HEAD`、`systemctl status campuswall.service` 和 `/health` 为准，不能只凭本文档日期判断。

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

生产 systemd 服务以 `campuswall:campuswall` 身份运行，不以 root 运行。由于宝塔安装的 Node 可能位于受 `ProtectHome=true` 保护的目录，`deploy/prepare-runtime.sh` 会把经过确认的 Node 可执行文件复制到 `/usr/local/lib/campuswall/node`。服务同时启用 `NoNewPrivileges`、`ProtectSystem=full`、空 capability 集、1536 MiB 内存上限和 45 秒停止超时；修改运行目录或上传目录时必须同步确认服务账号可写权限。

## 4. 技术栈

- 前端：React 19、React Router 7、Vite 8、Tailwind CSS 4、Three.js、Bootstrap Icons、DOMPurify；
- 后端：Node.js 22.12+（推荐当前 LTS）、Express 4、`pg`、`multer`、`sharp`、`cookie-parser`、`compression`、`express-rate-limit`；
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
│   │   └── noticeStore.js          # 公告 ID 迁移、公开脱敏和排序
│   ├── scripts/                    # 数据迁移、数据库等待、管理员恢复
│   ├── test/                       # Node 内置测试
│   ├── static/                     # 上传、缩略图、头像等运行数据
│   ├── help/                       # 当前反馈/举报 JSON 运行数据
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

`README_BAOTA_DEPLOY.md` 保留了早期宝塔/PM2 部署背景，只能作为历史参考；当前生产的权威部署资产是 `deploy/campuswall.service`、`deploy/nginx-campuswall.conf`、`deploy/prepare-runtime.sh` 和本文档。若旧文档与这些文件冲突，以当前代码和 systemd 流程为准。

## 6. 产品功能与重要边界

- 游客可以匿名发布普通校园墙内容，无需学号验证；
- 用户可用任意合规用户名与密码注册；
- 所有新帖子都先进入统一待审核队列，审核通过前不公开；
- 表白墙使用 Three.js 粉色爱心场景，爱心粒子以便签形式呈现；
- 首页持续展示最近发布或编辑的校园公告；审核员、管理员和超级管理员均可发布、编辑或收回；
- 失物招领必须登录后才能查看和发布，仍走统一审核流程；
- 登录用户可维护昵称、头像、简介，查看自己的帖子、评论、收藏和通知；
- 管理角色也能发帖；所有审核员可审核全局队列中的全部内容，包括自己提交的帖子；
- 反馈与举报只在后台处理，前台不提供公开进度查询。

主要前端路由：

| 路由 | 页面 | 访问条件 |
| --- | --- | --- |
| `/` | 首页、真实上线时长、校园公告、常用入口 | 公开 |
| `/wall` | 校园动态与发布入口 | 浏览公开；发帖总开关开启时游客和用户都可发，当前不能单独关闭游客发帖 |
| `/wall/message/:id` | 帖子详情 | 仅公开状态可由游客读取；失物招领另受登录限制 |
| `/confessions` | Three.js 表白墙便签 | 公开浏览，发布仍进入统一审核 |
| `/lost-found` | 失物招领 | 必须登录，前后端都要校验 |
| `/p`、`/p/:tag` | 话题/分区 | 公开内容可见 |
| `/help`、`/help/form` | 帮助与反馈 | 公开，提交受来源与限流保护 |
| `/rules` | 社区公约 | 公开 |
| `/login` | 注册与登录 | 公开 |
| `/me` 及 `/me/*` | 个人资料、帖子、评论、收藏、通知 | 必须登录 |
| `/user/:id` | 公开用户主页 | 公开字段与公开帖子 |
| `/admin/login` | 后台登录 | 仅管理角色能成功建立后台会话 |
| `/admin` | 后台概览 | `reviewer/admin/super_admin` |
| `/admin/wall` | 全局帖子审核 | `review_posts` 或 `manage_wall_message` |
| `/admin/notice` | 公告管理 | `notice` |
| `/admin/users` | 用户与角色 | `manage_users` 或 `manage_roles` |
| `/admin/comments`、`/admin/trash` | 评论与回收站 | `manage_wall_message` |
| `/admin/settings` | 平台设置 | `manage_settings` |
| `/admin/feedback`、`/admin/report` | 反馈与举报 | 对应查看/处理权限 |
| `/admin/log`、`/admin/audit`、`/admin/error_log` | 日志与审计 | 对应日志权限 |

前端路由守卫只负责导航体验。接口能否访问必须以 Express 的登录、可信来源和权限检查为准；新增后台页面时要同时增加前端守卫、后台菜单和后端权限，不能只完成其中一层。

### 6.1 前端视觉、主题与动效

- 视觉基线是 Apple/SwiftUI 风格，而不是对 Apple 官网组件逐像素复制。权威设计变量在 `frontend/src/apple-design-tokens.css`，`frontend/src/styles.css` 只建立应用语义变量和页面样式；新增颜色、圆角、字号、间距前优先复用已有 token；
- 字体栈优先系统字体、SF Pro 与苹方；界面采用克制阴影、细分隔线、圆角卡片、半透明导航和蓝色主操作。浅色与深色必须分别验收，不能通过在浅色页面中固定黑色区域来伪造深色主题；
- 主题偏好保存在 localStorage 的 `theme-preference`，底层支持 `system/light/dark`。首次或键值为 `system` 时跟随系统；点击主题按钮后会切换到明确的浅色或深色并持久化，当前界面没有“恢复跟随系统”按钮，需要在控制台执行 `localStorage.removeItem('theme-preference')` 后刷新；解析后的主题写入 `<html data-theme>`；
- 所有页面组件已经通过 `React.lazy` 按路由拆分。页面路径变化时由 `.route-transition` 提供轻量进入动效，路由切换同时回到页面顶部；
- CSS 和 Three.js 场景都尊重 `prefers-reduced-motion`，毛玻璃降级尊重 `prefers-reduced-transparency`，高对比偏好使用 `prefers-contrast: more`。新增动效必须是非阻塞、可中断的辅助反馈，不能影响点击、键盘焦点或阅读；
- 响应式基线：不宽于 1080px 时启用底部五栏导航（首页、动态、表白、失物、我的）；不宽于 768px 时后台侧栏折叠、共享 Modal 呈底部 sheet；不宽于 520px 时失物字段单列；不宽于 360px 时品牌和发帖文案进一步收缩。布局已处理 iOS safe-area；新增固定按钮、sheet 或底部表单时必须继续加上 `env(safe-area-inset-*)`，并在窄屏、横屏及软键盘弹出场景验收；
- 共享 `Modal.jsx` 通过 Portal 挂到 `document.body`，负责背景锁滚动、焦点圈闭、Escape/遮罩关闭、关闭后恢复原焦点。新增弹层优先复用它；当前没有禁用 Escape/遮罩关闭的配置，如果业务不允许这种关闭方式，必须先扩展 Modal API，并继续保留可见关闭按钮与焦点管理；
- `styles.css` 是长期演进的层叠文件：前部有基础主题/Modal/media，约 3087 行后是当前 SwiftUI 覆盖，底部导航与路由动效在后半部，表白墙新版样式位于更后。后定义的同名 selector 会覆盖前文，仅修改早期规则可能看似无效；`mobile-menu-toggle/mobile-nav-drawer` 等规则目前没有 JSX 引用，清理前先用 `rg` 和浏览器回归确认；
- 图标来自本地 Bootstrap Icons 子集，不依赖外网字体。新增图标后必须同步子集文件并在生产构建中确认显示，避免再次出现空方框。

### 6.2 表白墙

- `/confessions` 公开可访问和匿名提交；当前专用页面限制便签最多 280 字，并提交固定 `#表白`、`anonymous=true`，进入与普通帖子相同的全局审核队列；
- 页面一次读取最近 72 条表白数据，但只展示 `moderation_status=visible`、`review_status=approved` 且正文非空的记录。待审、下架、删除内容不得进入 Three.js 场景；
- Three.js 爱心中的每个粒子都是可点击便签；点击后打开可读模态框，并可跳到对应动态详情。Canvas 不可用或窄屏时仍应保留可操作的便签列表/降级体验；
- 每次进入/挂载表白墙时从当前便签中随机选取 3–5 条（不足 3 条时全选），本次停留期间集合保持稳定；精选集合按发布时间从旧到新轮播，每 4 秒突出下一条。鼠标悬停爱心、打开便签、页面进入后台、系统要求减少动态或不足两条时暂停；
- 表白墙没有实时推送，发布成功只返回审核回执；审核通过后用户需要刷新或重新进入页面。调整抓取数量、轮播顺序或随机算法时必须保留“按时间播放”和 reduced-motion 语义。

### 6.3 失物招领

- `/lost-found` 的页面路由和 `/api/user/lost-found*` 接口都要求普通用户会话；不能只依赖前端跳转保护。未登录访问会携带原目标跳转 `/login`，成功登录/注册后返回原页面；
- 启事分“寻物”和“招领”。当前页面约束为：物品名必填且最多 60 字、地点必填且最多 80 字，时间最多 60 字、公开联系方式最多 80 字、说明最多 500 字；联系方式可留空并通过评论沟通，页面应提醒用户保留未公开核验特征；
- 后端最终约束目前更宽：只强制合法 `kind` 和非空物品名，物品/地点/时间/联系/说明上限分别为 100/120/80/160/2000，地点在 API 层可为空。后端会忽略客户端拼接的正文和标签，依据结构化字段重新生成可读正文、`lost_found` 数据与标签；因此后端是数据权威，但地点必填和较短上限目前还不是安全边界；
- 提交后的结构化 `lost_found` 字段、可读正文和 `失物招领/寻物启事或招领启事/状态` 标签仍固定进入统一待审队列；
- 列表每页 24 条，支持全部、寻物、招领和已找回筛选。当前勾选“已找回”会发布一条新的状态启事，不是就地修改旧启事；以后若实现真正闭环，应增加原帖所有权校验和状态更新 API；
- 联系方式属于面向已登录用户展示的数据，仍需遵守学校隐私规范；不要填写身份证号、家庭地址等敏感信息。当前专用失物表单不支持附件；以后增加附件时必须沿用登录鉴权的静态文件链路，不能让 Nginx 直接公开。

### 6.4 登录回跳与角色导航

- 普通登录页同时提供登录和注册，可按后台平台设置加载人机验证。注册成功立即建立会话；受保护页面跳转登录时保留 `pathname/search/hash`，成功后回到原目标，默认目标为 `/me`；
- 验证码 provider 只支持 Cloudflare Turnstile、Google reCAPTCHA 或关闭；前两者会动态加载第三方脚本并随主题重建。验证码配置请求或外部脚本加载失败时登录/注册会被阻断，应先修配置/网络，不能通过绕过后端验证临时放行；
- `reviewer/admin/super_admin` 登录前台后，顶部会直接出现后台按钮，无需手工输入 `/admin`。审核员按钮文案为“运营后台”，目标为 `/admin/wall`；管理员与超级管理员显示“管理后台”，目标为 `/admin`；
- 顶部入口不是单点登录：它依据 `user_session` 展示，但后台受保护页面仍要求独立的 `admin_session`。没有后台会话时点击入口会跳 `/admin/login` 完成二次登录；后台登录成功后当前实现会清理 `user_session`，回到前台时需要重新登录才能恢复个人账号态和顶部后台按钮；
- 后台侧栏按后端返回权限过滤。审核员除通用仪表盘外只看到帖子审核与公告管理，管理员/超级管理员再看到各自获权模块；顶部按钮和隐藏菜单都不是授权边界，后台每个请求仍要校验 `admin_session` 与权限；
- 普通用户和游客不显示后台按钮；手机顶部空间不足时按钮使用短文案，但入口与权限规则不变。

### 6.5 真实上线时长

- 首页运行时长不从构建日期、Git 提交或浏览器本地时间起算。后端公开配置返回 `site_launched_at` 与 `server_time`；`Home.jsx` 先计算客户端相对服务器的时钟偏移，再从真实上线起点每秒更新天/时/分/秒；
- 权威值是生产 `/etc/campuswall/backend.env` 的 `SITE_LAUNCHED_AT=2026-08-25T01:48:50+08:00`。服务重启、普通发布、数据库恢复、换域名和文档更新都不能重置；
- `Home.jsx` 的辅助 tooltip 和 `PlatformContext.jsx` 的故障 fallback 当前也含同一基准时间。若经证据确认上线时间需要更正，应在同一代码提交同步这两处、`backend/.env.example` 与本文档；部署变更窗口再通过服务器/密码管理渠道单独更新不入 Git 的生产环境文件，并记录服务器时间偏移验收，避免数字正确而说明文字错误。

## 7. 统一账号、角色与权限

PostgreSQL `users` 表是普通登录和后台登录的唯一账号源。旧 `backend/managers.json` 只作为一次性迁移输入，不再是运行时权限数据库。

注册与登录规则：

- 用户名先做 NFKC 规范化和首尾空格清理，长度 2–24 个 Unicode 字符；
- 只允许中文/其他 Unicode 字母、数字、点、下划线和短横线；
- 唯一性使用小写 `username_key` 判断，因此大小写不同不能注册成两个账号；
- 密码长度 8–128 个 JavaScript 字符，数据库只保存随机盐与 `scrypt` 哈希；
- 新注册账号固定为 `user`，不能通过请求字段自行指定高权限角色；
- 普通登录和后台登录查询同一条用户记录；后台登录会额外要求角色属于管理角色。

| 角色 | 前台功能 | 后台入口 | 权限边界 |
| --- | --- | --- | --- |
| `user` | 注册用户功能 | 无 | 不能审核、管理或分配角色 |
| `reviewer` | 可正常发帖 | 有，顶部导航直接显示 | 所有审核员完全相同；可审核统一队列中的全部内容并管理主页公告；不能管理用户、设置或角色 |
| `admin` | 可正常发帖 | 有 | 内容、普通 `user` 状态、公告、反馈、举报、日志和设置管理；不能操作管理角色账号或分配角色 |
| `super_admin` | 可正常发帖 | 有 | 全部权限，包括把用户设为 `user/reviewer/admin/super_admin` |

权限名与主要用途：

| 权限 | 用途 | 默认角色 |
| --- | --- | --- |
| `review_posts` | 审核全部待审内容 | reviewer、super_admin |
| `manage_wall_message` | 内容、评论、回收站管理 | admin、super_admin |
| `notice` | 发布、编辑、收回公告 | reviewer、admin、super_admin |
| `view_user_log` | 反馈工单 | admin、super_admin |
| `view_report` | 内容举报 | admin、super_admin |
| `view_log` | 错误日志 | admin、super_admin |
| `view_admin_log` | 管理日志与结构化审计 | admin、super_admin |
| `manage_settings` | 社区与验证码设置 | admin、super_admin |
| `manage_users` | 普通用户状态管理 | admin、super_admin |
| `manage_roles` | 分配任意角色 | 仅 super_admin |

`manage_admins` 仅用于兼容旧入口，不应作为新功能的授权依据。具体映射以 `backend/src/services/roles.js` 为唯一代码事实来源。

权限规则：

1. 审核员不存在分组、负责范围、单独授权或上下级关系；新增审核员自动获得与现有审核员完全相同的审核权限。
2. 审核队列是全局队列，不按审核员、作者、标签、普通动态、表白或失物招领拆分访问权限。
3. `reviewer` 可以审核全部待审帖子，包括自己提交的内容；该口径对单条和批量审核一致，操作仍写入审计。
4. `admin` 不等于 `super_admin`；只有超级管理员能改变角色。
5. 系统禁止修改自己的角色，并保证至少保留一个启用的超级管理员。
6. 角色改变、停用、改密和重置密码会递增 `session_version`，旧前台/后台会话立即失效。
7. 前端隐藏菜单只是界面优化；真正的权限边界必须由后端接口再次检查。

后台入口：审核员、管理员、超级管理员建立前台会话后，顶部导航直接显示后台入口；普通用户和游客不显示。入口省去了手工输入地址，但不替代后台登录：直接访问后台仍会校验独立 `admin_session` 和具体权限。

会话规则：

- 前台 Cookie 为 `user_session`，后台 Cookie 为 `admin_session`；两者都是 HttpOnly 签名会话；
- 管理角色可被统一账号解析，但后台接口仍必须使用 `requireAdmin` 并检查具体权限；
- Cookie 的 SameSite、Secure 和寿命由环境变量控制，默认寿命 7 天；
- 登录另一入口时会清理不再使用的会话 Cookie，避免角色界面混淆；
- `session_version` 不匹配、账号停用、角色变更或签名无效时，会话应视为失效；
- 更换 `SECRET_KEY` 会让全部现有会话立即失效，也会影响用该密钥保护的验证码 Secret；轮换前需安排重新登录并重新保存相关密钥。

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
           └─ 退回待审 → pending + pending，保持非公开并写入审计
```

必须保持的不变量：

- 新帖子不能绕过 `pending` 状态；
- 待审核、已下架、已删除内容不能从公开列表、详情、热门、分区、收藏或互动接口泄漏；
- 待审核附件也不能通过猜测文件名访问；
- 单条审核和批量审核都必须使用相同的全局审核权限，不得因发布者或内容类别缩小某位审核员的范围；
- 审核结果必须记录操作账号与时间，以便在允许审核自己内容的前提下保留追溯能力；
- 当前“退回待审”不采集退回理由，也没有独立 `rejected` 状态；如增加理由字段，必须同时扩展数据库、API、审核界面、用户通知和审计；
- 失物招领、表白等类别仍属于统一待审内容，不能形成审核盲区；
- 审核和管理写操作要进入结构化审计记录。

评论当前属于发布后管理对象，管理员可隐藏、恢复或移入回收站；若未来增加“评论先审后发”，必须同步扩展数据状态、公开过滤、审核队列、通知和测试，不能只增加一个前端按钮。

## 9. 管理员公告系统

公告不是帖子类型，也不进入帖子审核队列。它由具备 `notice` 权限的审核员、管理员或超级管理员直接维护，发布后供首页公开读取。三类角色的公告权限完全相同，普通用户没有任何公告写权限。

### 9.1 数据源与记录结构

当前公告的唯一权威存储是 `backend/static/notice.json`，不是 PostgreSQL。典型记录：

```json
{
  "id": "稳定的随机 ID",
  "timestamp": "2026-08-25 20:00:00",
  "user": "审核员 <用户名>",
  "author_role": "reviewer",
  "content": "公告纯文本",
  "updated_at": "2026-08-25 20:30:00",
  "updated_by": "管理员 <用户名>",
  "updated_by_role": "admin"
}
```

- `id` 是编辑、收回和前端已读状态的稳定标识；
- `timestamp` 是首次发布时间，`updated_at` 是最近编辑时间；
- `user/author_role/updated_by/updated_by_role` 只用于后台追溯，公开接口会删除；
- `content` 按纯文本处理，首页用 `white-space: pre-wrap` 保留换行，不执行公告中的 HTML；
- 公告长度上限来自后端 `MAX_TEXT_LENGTH`，后台 GET 同时返回 `max_length` 给前端，不能在新页面再次写死一个不同上限。

旧公告可能没有 `id` 或出现重复 ID。管理端第一次 GET 或任一写接口调用 `readNotices({ ensureIds: true })` 时，会为缺失/空白/重复项补充新 ID 并原地写回 JSON；公开 GET 不会触发这次迁移。部署和首次打开公告后台前必须先备份 `notice.json`，并确认服务账号有写权限。编辑/删除接口目前仍接受数字数组索引作为旧客户端兼容回退，但它不稳定且已废弃，新代码只能使用稳定公告 ID；未来移除回退前要确认没有旧客户端调用。ID 补齐属于文件规范化，不生成公告操作审计事件。

### 9.2 API 契约

| 方法与路径 | 访问条件 | 行为 |
| --- | --- | --- |
| `GET /api/notice` | 公开 | 去除操作者字段；按最近发布或编辑时间倒序；`Cache-Control: no-store` |
| `POST /api/notice` | 公开兼容入口 | 只为旧静态客户端保留；返回原始存储顺序，旧客户端会自行 `reverse()`；新代码不得使用 |
| `GET /api/admin/notice` | `notice` | 返回后台完整记录和 `max_length`，并完成旧 ID 迁移 |
| `POST /api/admin/notice` | `notice` + 可信来源 | 发布公告，返回 201 和新记录 |
| `PUT /api/admin/notice/:noticeId` | `notice` + 可信来源 | 编辑正文并写入编辑人/时间 |
| `DELETE /api/admin/notice/:noticeId` | `notice` + 可信来源 | 收回公告并从当前 JSON 中删除 |

`GET` 与兼容 `POST` 的排序契约不同是有意设计；合并接口或随意反转顺序会让旧缓存页面把最新公告显示到最后。相关回归测试位于 `backend/test/noticeStore.test.js`。

公告没有作者所有权限制，也不需要二次审批。管理页把当前 JSON 存储数组反转展示，在正常只追加发布的情况下等价于新发布优先，但不会重新解析 `timestamp` 做排序；公开首页则按“编辑时间优先，否则发布时间”排序。当前收回是硬删除，没有后台撤销、草稿、定时发布、自动过期或版本历史，误删恢复只能依赖 `notice.json` 备份。

### 9.3 首页展示与已读规则

- 没有公告时，首页不渲染空公告卡片；
- 有公告时，首页常驻显示最近发布或编辑的一条，以及当前公告总数；
- 用户点击卡片可查看所有仍在展示的公告；
- 最新活动公告尚未读时自动打开公告弹层；
- 已读键为 `campuswall:notice:seen:<id>:<updated_at 或 timestamp>`，保存在当前浏览器 localStorage；
- 新公告或任意旧公告被编辑后会得到新的活动顺序/修订键，因此会再次提醒；
- 已读状态不是账号数据，不跨浏览器同步；清理站点数据后会重新提示；
- localStorage 不可用时不会自动打开未读弹层，但常驻公告卡仍可查看；
- 当前没有 WebSocket、SSE 或轮询。已经停留在首页的用户需要重新载入或重新进入首页，才能看到另一标签页刚发布/收回的公告。

首页公告使用 SwiftUI 风格 inset 卡片，手机端公告详情沿用可访问的底部 sheet/模态框。当前 React 首页使用文本节点渲染正文，不会执行公告里的 HTML。

仓库遗留的 `frontend/public/static/js/main.js` 和 `frontend/public/static/js/notice.js` 属于旧页面兼容代码，仍使用 `innerHTML` 拼装公告，旧清洗逻辑不足以阻止所有事件属性型 HTML。不要重新启用引用这些脚本的旧 HTML；若必须保留旧页面兼容，应先把公告正文改为 `textContent`/DOM 文本节点并增加 XSS 回归测试。安全验收可用无害的 `<img src=x onerror=...>` 字符串确认页面只显示文字且不会执行事件，但不得在生产公告中做测试。

### 9.4 审计、并发与备份边界

公告写操作会进入后台结构化审计，包含操作者、操作者角色、HTTP 动作、`target_type=notice`、公告目标 ID 和状态码；收回时还附带公告时间与最多 200 字正文摘要。审核员无审计查看权限，管理员和超级管理员可进入 `/admin/audit`，但当前审计页面未展开全部 metadata，必要时通过审计 API 或只读数据库查询查看。当前通用审计是在 HTTP 响应完成后异步、best-effort 写入，失败不会撤销已经成功的公告操作，因此审计表不是公告备份，也不能被当作强事务合规日志。

`notice.json` 使用同步、非原子的覆盖写，适合当前单 Node 进程但不具备事务安全：磁盘写满、进程异常或文件损坏可能造成截断；读取解析失败时当前通用 JSON 读取器会回退为空数组，随后一次写入还可能覆盖原文件。编辑接口没有版本号、ETag 或乐观锁，多个管理页面同时编辑时最后一次保存胜出，可能覆盖先前修改。公告管理异常或并发冲突时应先停止写操作、复制原文件和最近备份，再排查，不能直接发布一条新公告“试修复”。未经改造不要启用多进程同时写公告；若未来横向扩容，应先把公告迁移到 PostgreSQL，并使用事务、稳定排序字段和并发控制。

日常只读核对：

```bash
cd /www/wwwroot/campuswall-react
node -e "const fs=require('fs');const p='backend/static/notice.json';const a=JSON.parse(fs.readFileSync(p,'utf8'));console.log({count:a.length,missingIds:a.filter(x=>x==null||x.id==null||String(x.id).length===0).length})"
curl -fsS http://127.0.0.1:5412/api/notice
```

人工验收必须覆盖 reviewer/admin/super_admin 三种角色均可发布、编辑、收回，普通用户接口返回 401/403；还要覆盖多条排序、编辑旧公告后重新提醒、换行/长文本、公开字段脱敏、旧 POST 顺序、收回后首页消失和深色/手机布局。

## 10. 审核消息提醒

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

当前只实现飞书自定义群机器人和企业微信群机器人，不支持个人微信或 QQ 机器人。新增渠道时必须继续使用 outbox 异步投递、官方 HTTPS 域名白名单、正文/身份脱敏、速率限制和重试上限，不能把第三方请求放回发帖事务中同步执行。

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
```

非空 `DATABASE_URL` 优先于分散的 `PG*` 参数。`SITE_LAUNCHED_AT` 表示真实首次上线时间，发布、重启、迁移或换域名时都不应自动改为当前时间。

来源、Cookie 与验证码：

```env
ALLOWED_ORIGINS=https://wall.example.com
SESSION_COOKIE_SAMESITE=Lax
SESSION_COOKIE_SECURE=true
SESSION_MAX_AGE=604800
PUBLIC_SITE_URL=https://wall.example.com
CAPTCHA_PROVIDER=none
CAPTCHA_ENABLED=false
CAPTCHA_SITE_KEY=
CAPTCHA_SECRET_KEY=
```

当前仅 HTTP 的 IP 站点不能使用 `SESSION_COOKIE_SECURE=true`，否则浏览器不会回传 Cookie；完成 HTTPS 后必须改为 `true`。`ALLOWED_ORIGINS` 使用完整来源（协议、域名/IP、端口），多个来源用逗号分隔，不要设置成带凭据的通配符。

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
```

审核通知：

```env
MODERATION_NOTIFY_ENABLED=false
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

生产启动会拒绝默认 `SECRET_KEY` 和默认开发数据库密码。修改环境变量后必须重启 `campuswall.service`。

前端构建变量见 `frontend/.env.example`：`VITE_API_BASE_URL`、`VITE_STATIC_URL` 和 `VITE_APP_ENV`。`frontend/src/main.jsx` 当前在生产构建中加载 Umami，并在未配置时使用代码内网站 ID；这会产生第三方分析请求。学校正式接管前应完成隐私评审，如不需要统计，应改为显式开关并停止加载，而不是只把变量留空。

## 14. 本地开发

前置条件：Node.js 22.12+（推荐当前 LTS）、npm、可用的 PostgreSQL 18、Docker Desktop（使用 `compose.yml` 时）和系统 `ffmpeg`。虽然根包声明仍是 `>=20`，Vite 8 的实际引擎为 `^20.19.0 || >=22.12.0`，旧 SQLite 导入还使用 `node:sqlite`；为避免开发、构建和迁移使用不同版本，交接统一采用 22.12+。

首次运行：

```powershell
cd C:\path\to\campuswall-react
npm install
npm run db:up
npm run db:wait
npm run dev
```

`npm run db:migrate` 只用于把旧 SQLite 数据导入 PostgreSQL：仅当 `backend/static/messages/messages.db` 存在、确认需要导旧数据并已先备份时单独执行。全新环境没有该 SQLite 文件时脚本会以非零状态退出，这不代表 PostgreSQL 启动失败，也不应为了让命令成功而创建空 SQLite 文件。

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

## 15. 测试与发布门槛

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
3. 合法用户名的 2/24 字符边界、非法字符、NFKC 与大小写唯一性，以及 8/128 字符密码边界均符合第 7 节；
4. 失物招领未登录会跳转登录，登录后可用；
5. 四种角色的导航和后端权限一致；
6. 任意审核员能看到并处理全部待审类别，包括其他人和自己提交的内容；
7. 单条审核和批量审核均不因发布者身份产生额外限制，且审计记录完整；
8. 超级管理员能分配角色，审核员和管理员不能；
9. 头像横图、竖图、透明 PNG、带方向信息图片均输出方形 WebP；
10. reviewer/admin/super_admin 都能发布、编辑、收回公告，普通用户不能访问管理接口；
11. 公告 GET/旧 POST 排序、公开字段脱敏、旧 ID 迁移、编辑后未读、换行和收回均符合第 9 节；
12. 公告中的 HTML 标签与事件属性只显示为文本，不在 React 页面执行；
13. 桌面和手机导航、模态框、表单及页面切换动效正常；
14. 深色、浅色、跟随系统和 `prefers-reduced-motion` 均正常；
15. 浏览器控制台无新增 warning/error，页面无 Vite 错误遮罩。

当前自动化测试覆盖头像处理与原子替换、审核通知脱敏/签名/合并节流、审核员全局审核权限、公告角色权限、公告稳定 ID、公开排序和操作者字段脱敏。新增数据状态或权限时必须补相应测试；仅靠前端截图不能证明后端权限安全。

`frontend/package.json` 当前没有 React 单元测试、E2E 或自动化无障碍测试脚本，前端发布仍依赖人工回归。至少在 1080/768/520/360px 宽度检查导航和表单；用键盘验证 Modal 焦点圈闭/Escape/焦点恢复；模拟 WebGL 不可用、验证码配置/脚本失败；测试 reduced-motion、reduced-transparency、high contrast；并逐一登录四种角色核对顶部入口、后台侧栏和直接 API 拒绝。新增核心交互后应优先引入可重复的 E2E 与 axe 类可访问性测试。

前端页面已经使用路由懒加载。构建仍可能出现 Three.js 表白墙 vendor/场景分包体积提示；这不是构建失败，但若体积继续增长，应进一步拆分 Three.js vendor、延后场景初始化或提供更轻的移动端降级包，不能把“启用路由懒加载”当作尚未完成的工作。

## 16. Git 工作流

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

当前本机通常在 `codex/*` 功能分支，而目标是远端 `schoolrepo/main`，因此确认快进关系后使用：

```powershell
git fetch schoolrepo main
git merge-base --is-ancestor schoolrepo/main HEAD
git push schoolrepo HEAD:main
```

不要误用 `git push schoolrepo main`，它会推送本地名为 `main` 的分支，而不一定是当前已测试的功能分支。若远端 `main` 不是当前 HEAD 的祖先，先停止发布并核对双方提交，不能强推覆盖。

## 17. 生产部署标准流程

生产服务采用 systemd，不能使用 Vite、nodemon、PM2 cluster 或 `npm run dev`。部署命令由具备 root 权限的运维人员执行，运行中的 Node 进程仍由 systemd 降权到 `campuswall:campuswall`。

以下 Linux 命令按 Bash 编写；高风险代码块必须启用 `set -euo pipefail`，不能逐行复制到不支持数组/`pipefail` 的 `/bin/sh`。任何命令失败都应停止，先确认服务与备份状态，再继续。

Nginx 关键契约：

- `/` 与 SPA 深链接从 `frontend/dist` 返回，`index.html` 禁止长期缓存；
- `/assets/*` 使用内容哈希文件名并缓存一年；
- `/api/*`、`/health`、`/static/uploads/*`、`/static/tiny_files/*` 反代到 `127.0.0.1:5412`；
- 上传、头像和导入接口单独放宽请求体与超时，普通请求保持较小限制；
- `Host`、客户端 IP 和 `X-Forwarded-Proto` 必须正确传给后端，否则来源校验、日志和 Secure Cookie 判断会错误；
- 配置修改后先 `nginx -t`，不要直接在宝塔界面保存后假设语法正确。

第 17.2–17.4 节应在同一个 root shell 中按顺序执行，使 `backup_dir`、`deploy_stamp` 和 `deploy_dist` 保持一致。如果 SSH 中断，先从磁盘确认已经创建的精确备份/构建目录，再手工重新赋绝对值；绝不能在变量为空时继续执行 `mv`、tar 或回滚命令。

### 17.0 新服务器重建

本节只用于新机或灾难恢复，不用于日常增量发布：

1. 安装 Node.js 22.12+ 当前 LTS、npm、PostgreSQL、Nginx、`ffmpeg`、Git 与系统 CA 证书；校准 NTP 和 `Asia/Shanghai` 时区；
2. 把学校仓库 `main` 克隆到 `/www/wwwroot/campuswall-react`，核对远端 URL 与提交哈希，执行 `npm ci` 和 `npm run build`；
3. 用 `runuser -u postgres -- createuser --pwprompt <数据库角色>` 创建最小权限数据库角色，再用 `runuser -u postgres -- createdb -O <数据库角色> campus_wall` 创建数据库；密码只通过隐藏输入和密码管理器交接；
4. 创建 `/etc/campuswall/backend.env`，填入新的强 `SECRET_KEY`、数据库、来源、Cookie、上线时间和可选机器人变量，设为 `root:root 600`；不要直接复用旧机密或把环境文件提交到 Git；
5. 以 root 执行 `bash deploy/prepare-runtime.sh /www/wwwroot/campuswall-react`，它会创建 `campuswall` 账号、运行目录和 `/usr/local/lib/campuswall/node`；每次更换 Node 可执行文件后都要重跑；
6. 用 `install -m 0644 deploy/campuswall.service /etc/systemd/system/campuswall.service` 安装 unit，再执行 `systemctl daemon-reload` 和 `systemctl enable campuswall.service`；
7. 以 `deploy/nginx-campuswall.conf` 为基线合并到宝塔实际 vhost，先替换域名/证书并确认受保护静态资源仍反代后端，再执行 `nginx -t`；不要盲目覆盖宝塔生成的整份配置；
8. 执行 `systemctl start campuswall.service`。PostgreSQL schema 由各 store 的 `init()` 在服务启动时创建/补齐；`npm run db:migrate` 只迁旧 SQLite，不是通用 schema migration；
9. 按第 20.1 节通过加载生产 EnvironmentFile 的一次性任务创建/恢复首个超级管理员；再验证 `systemctl status`、本机 `/health`、Nginx 首页/深链接、登录、管理权限、上传目录权限和公网访问，最后建立首份加密备份。

### 17.1 上线前检查

```bash
set -euo pipefail
cd /www/wwwroot/campuswall-react
test "$(git branch --show-current)" = "main"
origin_url="$(git remote get-url origin)"
case "$origin_url" in
  *ZONGRUICHD/Campus-Wall-For-GuanLan*) ;;
  *) printf 'unexpected origin: %s\n' "$origin_url"; exit 1 ;;
esac
git status --short
test -z "$(git status --porcelain)"
git rev-parse HEAD
node --version
timedatectl show -p Timezone
systemctl is-active campuswall.service
curl -fsS http://127.0.0.1:5412/health
df -h /www/wwwroot /www/backups
```

工作树不干净时先识别文件所有者和用途，不要直接 `git reset --hard` 或删除运行数据。

### 17.2 建立上线备份

```bash
set -euo pipefail
cd /www/wwwroot/campuswall-react
stamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="/www/backups/campuswall/${stamp}-before-deploy"
: "${backup_dir:?backup_dir is required}"
case "$backup_dir" in
  /www/backups/campuswall/*) ;;
  *) printf 'invalid backup path\n'; exit 1 ;;
esac
install -d -m 0700 "$backup_dir"
git rev-parse HEAD > "$backup_dir/previous-commit.txt"
runuser -u postgres -- pg_dump -Fc campus_wall > "$backup_dir/campus_wall.dump"
test -s "$backup_dir/campus_wall.dump"
runuser -u postgres -- pg_restore -l < "$backup_dir/campus_wall.dump" >/dev/null
install -m 0600 /etc/campuswall/backend.env "$backup_dir/backend.env"
systemctl cat campuswall.service > "$backup_dir/campuswall.service.effective.txt"
nginx -T > "$backup_dir/nginx.effective.txt" 2>&1

runtime_paths=()
for runtime_path in \
  backend/static backend/help backend/logs \
  backend/admin_log.json backend/manage_message.json backend/managers.json \
  backend/error.log frontend/dist; do
  if [ -e "$runtime_path" ]; then runtime_paths+=("$runtime_path"); fi
done
tar --exclude='backend/static/chunks' --exclude='backend/static/chunks/*' \
  -czf "$backup_dir/runtime-files.tar.gz" "${runtime_paths[@]}"
test -s "$backup_dir/runtime-files.tar.gz"
sha256sum "$backup_dir/campus_wall.dump" "$backup_dir/runtime-files.tar.gz" \
  > "$backup_dir/SHA256SUMS"
chmod 0600 "$backup_dir"/*
```

备份包含敏感数据，目录必须仅 root 可读，并应定期复制到加密的异机存储。确认 `pg_dump`、tar 和校验和均成功后才能继续；脚本中断时不要假设已有一个完整备份。

### 17.3 更新、测试与构建

```bash
set -euo pipefail
cd /www/wwwroot/campuswall-react
test "$(git branch --show-current)" = "main"
git remote -v
git fetch origin main
git merge --ff-only origin/main
npm ci
npm --workspace backend test
npm --workspace backend run check
```

为降低半构建状态风险，先构建到独立目录：

```bash
deploy_stamp="$(date +%Y%m%d-%H%M%S)"
deploy_dist="frontend/dist.deploy-${deploy_stamp}"
: "${deploy_dist:?deploy_dist is required}"
case "$(readlink -m "$deploy_dist")" in
  /www/wwwroot/campuswall-react/frontend/dist.deploy-*) ;;
  *) printf 'invalid deploy path\n'; exit 1 ;;
esac
test ! -e "$deploy_dist"
npm --workspace frontend run build -- --outDir "dist.deploy-${deploy_stamp}"
test -s "$deploy_dist/index.html"
test -d "$deploy_dist/assets"
```

若依赖未变化可省略 `npm ci`，但修改 `package.json`/`package-lock.json`、Node 版本或原生模块时必须重新安装并验证。

### 17.4 受控前端切换与重启

当前 Nginx 直接指向 `frontend/dist`，还不是 release 目录 + symlink 的严格原子发布。下面先在 `frontend/` 同一文件系统内重命名旧/新目录，把不可用窗口缩到两次 rename 之间；健康通过后才把旧目录移到备份盘，避免 `/www/backups` 跨文件系统时先发生长时间 copy + delete。若需要真正单步切换，应改造为不可变 release 目录和原子 symlink 指针。

```bash
set -euo pipefail
cd /www/wwwroot/campuswall-react
: "${backup_dir:?backup_dir is required}"
: "${deploy_dist:?deploy_dist is required}"
: "${deploy_stamp:?deploy_stamp is required}"
case "$(readlink -m "$backup_dir")" in
  /www/backups/campuswall/*) ;;
  *) printf 'invalid backup path\n'; exit 1 ;;
esac
case "$(readlink -m "$deploy_dist")" in
  /www/wwwroot/campuswall-react/frontend/dist.deploy-*) ;;
  *) printf 'invalid deploy path\n'; exit 1 ;;
esac
nginx -t
old_dist="$backup_dir/frontend-dist.previous"
old_dist_local="frontend/dist.previous-${deploy_stamp}"
case "$(readlink -m "$old_dist")" in
  /www/backups/campuswall/*/frontend-dist.previous) ;;
  *) printf 'invalid rollback path\n'; exit 1 ;;
esac
case "$(readlink -m "$old_dist_local")" in
  /www/wwwroot/campuswall-react/frontend/dist.previous-*) ;;
  *) printf 'invalid local rollback path\n'; exit 1 ;;
esac
test -d frontend/dist
test -d "$deploy_dist"
test ! -e "$old_dist"
test ! -e "$old_dist_local"
mv frontend/dist "$old_dist_local"
if ! mv "$deploy_dist" frontend/dist; then
  mv "$old_dist_local" frontend/dist
  printf 'frontend switch failed; previous dist restored\n' >&2
  exit 1
fi
restart_ok=1
if ! systemctl restart campuswall.service; then
  restart_ok=0
fi

health_ok=0
if [ "$restart_ok" -eq 1 ]; then
  for attempt in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:5412/health >/dev/null 2>&1; then
      health_ok=1
      break
    fi
    sleep 1
  done
fi

if [ "$health_ok" -ne 1 ]; then
  failed_dist_local="frontend/dist.failed-${deploy_stamp}"
  previous_commit="$(cat "$backup_dir/previous-commit.txt")"
  mv frontend/dist "$failed_dist_local"
  mv "$old_dist_local" frontend/dist
  git switch --detach "$previous_commit"
  npm ci
  systemctl restart campuswall.service
  curl -fsS http://127.0.0.1:5412/health >/dev/null
  if ! mv "$failed_dist_local" "$backup_dir/frontend-dist.failed-${deploy_stamp}"; then
    printf 'failed dist remains at %s\n' "$failed_dist_local" >&2
  fi
  printf 'deployment failed; previous code and frontend restored in detached HEAD\n' >&2
  exit 1
fi

mv "$old_dist_local" "$old_dist"

systemctl is-active campuswall.service
curl -fsS http://127.0.0.1:5412/health
curl -fsSI -H 'Host: 160.236.110.133' http://127.0.0.1/
```

随后检查：

```bash
journalctl -u campuswall.service --since "5 minutes ago" --no-pager
git rev-parse HEAD
git status --short
```

最后从公网检查首页、`/health`、登录、后台入口和一个深链接刷新。只有代码、服务、页面和日志均正常才算上线完成。

## 18. 回滚

### 18.1 仅前端异常

先把下面的占位路径替换为本次部署实际备份目录；不要依赖另一个 shell 中的旧变量：

```bash
set -euo pipefail
cd /www/wwwroot/campuswall-react
backup_dir="/www/backups/campuswall/<本次实际备份目录>"
: "${backup_dir:?backup_dir is required}"
case "$(readlink -m "$backup_dir")" in
  /www/backups/campuswall/*) ;;
  *) printf 'invalid backup path\n'; exit 1 ;;
esac
test -d "$backup_dir/frontend-dist.previous"
rollback_stamp="$(date +%Y%m%d-%H%M%S)"
rollback_dist="frontend/dist.rollback-${rollback_stamp}"
failed_dist="frontend/dist.failed-${rollback_stamp}"
test ! -e "$rollback_dist"
test ! -e "$failed_dist"
cp -a "$backup_dir/frontend-dist.previous" "$rollback_dist"
test -s "$rollback_dist/index.html"
mv frontend/dist "$failed_dist"
mv "$rollback_dist" frontend/dist
nginx -t && systemctl reload nginx
```

### 18.2 后端代码异常

先读取 `$backup_dir/previous-commit.txt`，确认目标提交后再创建回滚分支或部署该提交。不要用 `git reset --hard` 覆盖不明运行文件。推荐在本地对错误提交做 `git revert`，测试后推送 `main`，再按标准流程部署。

紧急情况下可在生产目录检出已确认提交并重启：

```bash
set -euo pipefail
cd /www/wwwroot/campuswall-react
backup_dir="/www/backups/campuswall/<本次实际备份目录>"
: "${backup_dir:?backup_dir is required}"
case "$(readlink -m "$backup_dir")" in
  /www/backups/campuswall/*) ;;
  *) printf 'invalid backup path\n'; exit 1 ;;
esac
previous_commit="$(cat "$backup_dir/previous-commit.txt")"
git rev-parse --verify "${previous_commit}^{commit}" >/dev/null
test -d "$backup_dir/frontend-dist.previous"
test -z "$(git status --porcelain)"
git switch --detach "$previous_commit"
npm ci

rollback_stamp="$(date +%Y%m%d-%H%M%S)"
rollback_dist="frontend/dist.rollback-${rollback_stamp}"
failed_current="frontend/dist.failed-rollback-${rollback_stamp}"
test -d frontend/dist
test ! -e "$rollback_dist"
test ! -e "$failed_current"
cp -a "$backup_dir/frontend-dist.previous" "$rollback_dist"
test -s "$rollback_dist/index.html"
mv frontend/dist "$failed_current"
if ! mv "$rollback_dist" frontend/dist; then
  mv "$failed_current" frontend/dist
  printf 'frontend restore failed; current dist restored\n' >&2
  exit 1
fi

systemctl restart campuswall.service
curl -fsS http://127.0.0.1:5412/health
```

这一步同时恢复匹配旧提交的依赖和前端产物，`failed_current` 保留用于排查。若错误发布含不兼容的数据变更，还必须按下一节评估数据库恢复，不能只回滚代码。恢复服务后应尽快通过正常 Git revert 提交让生产重新回到 `main`，避免长期处于 detached HEAD。

### 18.3 数据异常

数据恢复会覆盖或合并生产数据，执行前必须停写、再做一次现状备份，并确认恢复时间点。自定义格式备份示例：

```bash
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
- 当前 Git 提交号与 Nginx/systemd 实际配置。

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

### 20.2 分配角色

超级管理员登录后从顶部后台入口进入“用户与权限”，选择用户并设置角色。审核员不能添加审核员，也不能修改任何人的角色；管理员同样不能分配角色。

### 20.3 审核员操作

审核员登录前台账号后：

1. 顶部导航出现后台入口；
2. 进入统一帖子审核队列；
3. 可查看所有待审类别，不需要手工输入 `/admin`；
4. 查看清晰的内容、附件、标签、投票、提交时间和审核状态；
5. 通过或退回其他人提交的内容；
6. 可处理自己发布的内容；系统仍记录审核账号、时间和结果；
7. 可从后台侧栏进入“公告管理”，发布、编辑或收回主页公告。

审核员除通用仪表盘、帖子审核与公告管理外，不应看见用户与权限、设置、举报、反馈、日志或回收站等管理模块。

## 21. 监控与日志

常用命令：

```bash
systemctl status campuswall.service --no-pager
journalctl -u campuswall.service -n 200 --no-pager
journalctl -u campuswall.service --since "1 hour ago" --no-pager
curl -fsS http://127.0.0.1:5412/health
nginx -t
tail -n 200 /www/wwwlogs/campuswall-error.log
tail -n 200 /www/wwwlogs/campuswall-access.log
tail -n 200 /www/wwwroot/campuswall-react/backend/logs/info.log
df -h
free -h
sudo -u postgres psql -d campus_wall -c "SELECT 1;"
```

当前日志链路有一个已知不一致：Express 错误处理中实际写入 `backend/logs/info.log`，但后台 `/admin/error_log` 所调用的错误日志接口读取 `backend/error.log`。因此后台错误日志页可能为空且目前不是权威来源；故障排查优先看 systemd journal、Nginx 日志和 `backend/logs/info.log`。后续应统一写入/读取路径并补回归测试，修复前不要因为后台页为空就判断“没有错误”。

重点告警信号：

- systemd 反复重启或健康检查失败；
- PostgreSQL 连接失败、磁盘空间接近下限；
- 头像/上传频繁返回 429、400 或 Sharp 解码错误；
- 审核通知 outbox 大量重试或持续失败；
- Nginx 502、请求体过大或深链接 404；
- 待审内容出现在公开接口；
- 最后一位超级管理员被停用或没有可登录的审核员。

日志、数据库查询结果和截图可能含用户信息，对外分享前必须脱敏。

## 22. 常见故障

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

使用 Node 22.12+ 的当前 LTS，在服务器目标系统重新执行 `npm ci`，不要复制 Windows `node_modules`。确认 `sharp` 原生依赖与服务器架构匹配。

### 头像仍显示旧图

接口使用重新验证缓存。先确认用户记录中的 `avatar_file` 已更新、文件存在于 `backend/static/avatars`，再检查浏览器请求是否返回新 ETag/内容；不要通过永久 immutable 规则缓存头像接口。

### 审核员看不到后台入口

确认用户角色确实为 `reviewer`、账号状态启用、重新登录后 `user_session` 已刷新；再检查 `/api/user/session` 返回的角色和前端 `Layout.jsx` 条件。即使前端入口异常，后端仍必须拒绝普通用户访问后台。

### 点击顶部后台入口又要求登录

这是当前双会话设计：顶部入口依据 `user_session` 显示，后台接口依据 `admin_session` 授权。先在 `/admin/login` 使用同一管理账号完成后台登录；后台登录会清理前台会话，因此返回前台后可能需要再次登录。若产品希望真正单点进入，需要先统一会话生命周期与退出语义，不能仅在前端绕过 `ProtectedRoute`。

### 审核通知没有发送

确认 `MODERATION_NOTIFY_ENABLED=true`、至少一个合法 Webhook、服务器可访问机器人域名、systemd 已重启。查看日志和 `moderation_notification_outbox` 状态；不要通过关闭审核或在发帖请求中同步调用 Webhook 来“修复”。

## 23. 安全检查表

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
- [ ] 学校已书面接受审核员可自审全部帖子、可直接维护公告且审核员本人看不到审计的高信任模型；审核员人数最小化、使用强唯一密码，并由管理员定期复核审计；
- [ ] 公告和反馈/举报 JSON 已纳入备份，服务账号只有必要写权限；
- [ ] 公告正文始终按纯文本渲染，遗留 `innerHTML` 页面没有重新启用；
- [ ] 上传同时受类型、大小、字节、并发、磁盘和路径限制；
- [ ] 机器人 Webhook 不在前端或日志中泄露；
- [ ] 备份已加密、可恢复且存在异机副本。

## 24. 已知限制与后续建议

- 生产站应尽快绑定正式域名并启用 HTTPS，之后开启安全 Cookie；
- 生产分析脚本目前会连接 Umami；在面向未成年学生正式开放前，应确认学校的隐私告知、数据范围与是否继续启用；
- 机器人提醒需要学校自行创建飞书或企业微信群机器人并在服务器注入密钥；
- Three.js 表白墙构建分包较大；页面已路由懒加载，后续应继续优化 Three.js vendor/场景的按需加载与移动端降级；
- 表白墙的 280 字和强制匿名目前只由专用前端页面执行，通用发帖 API 仍使用全站正文上限，也可直接提交 `#表白` 且关闭匿名；若这是产品安全不变量，必须在后端按内容类型强制并补绕过测试；
- 失物招领页面与 API 的字段校验不完全一致：页面要求地点并使用较短上限，后端允许空地点且上限更宽；应统一后端契约、前端提示和测试，修复前不能把页面限制当作服务端安全保证；
- 当前主题按钮一旦手动切换后只在浅色/深色之间切换，没有“恢复跟随系统”操作入口；可清除 `theme-preference` 恢复，后续可补三态选择器；
- 前台与后台使用独立会话，顶部后台入口不是 SSO，后台登录还会清理前台会话；若改为统一会话，必须同步评估退出、改密、停用和 `session_version` 失效规则；
- 个人中心仍有“已登录认证学生”的遗留文案，但系统已经取消学号/学生认证；应改为“已登录校园用户”，避免造成身份已由学校核验的误解；
- 用户名后端按 Unicode code point 计算 2–24 字符，注册页的 `maxLength=24` 按 UTF-16 code unit 截断；含非 BMP 字母时前端可能比后端更早截断，后续应统一计数和提示；
- 公告当前是单进程 JSON 非原子覆盖写，没有草稿、定时、版本历史、撤销和实时推送；应优先改用 PostgreSQL 事务存储，并在迁移前保留文件备份；
- 反馈、举报和兼容管理员日志同样是非事务 JSON。举报归档会先改待处理文件再写已处理文件，故障窗口可能丢记录；这些文件缺统一保留/轮转策略且 `admin_log.json` 会持续增长，应定期备份并迁移到 PostgreSQL 事务存储；
- 遗留静态公告脚本使用 `innerHTML`，若旧 HTML 被重新启用可能产生存储型 XSS；正式删除旧入口或改为文本节点前不得恢复引用；
- 当前图标子集仍缺少已被 JSX 引用的若干图标（包括 `chat-left-dots`、`clipboard-check`、`collection`、`file-earmark-ruled`、`info-circle`、`megaphone-fill`、`patch-check-fill`、`person-gear`、`play-btn`、`search-heart`），相关页面可能出现空白图标；应补齐本地 subset 或替换为已有图标，并增加构建期引用扫描；
- 后台错误日志页读取路径与实际 Express 日志写入路径不一致，运维应以 journal、Nginx 日志和 `backend/logs/info.log` 为准，并尽快统一路径；
- 前端目前没有单测、E2E 或自动化无障碍测试，关键响应式、主题、Modal、Three.js 降级和角色导航主要依赖第 15 节人工矩阵；
- 可增加定期扫描无数据库引用头像的维护任务，处理进程崩溃留下的极少量孤儿文件；
- 评论当前是发布后管理，不是先审后发；如学校要求评论也先审，需按第 8 节完整扩展；
- 应为备份增加自动化、保留策略、异机复制和恢复演练记录；
- 应增加 HTTPS、外部可用性、磁盘、数据库和 outbox 积压监控。

## 25. 最终交接清单

- [ ] 接手人已获得 GitHub 仓库权限；
- [ ] 接手人已通过密码管理器获得服务器/宝塔凭据；
- [ ] 接手人知道生产目录、systemd 服务和环境文件位置；
- [ ] 接手人能在本地 1145 端口启动前端并运行后端测试；
- [ ] 接手人能完成一次无变更构建和健康检查；
- [ ] 接手人确认 `SITE_LAUNCHED_AT` 是真实首次上线时间，普通部署不会重置；
- [ ] 接手人理解四种角色及“所有审核员完全同权”的规则；
- [ ] 接手人理解前台/后台双会话，能从顶部导航完成后台二次登录并处理统一队列；
- [ ] reviewer/admin/super_admin 均已实测公告发布、编辑、收回，普通用户被拒绝；
- [ ] 接手人知道公告、反馈、举报、管理员日志和上传等运行文件不是 Git 数据；
- [ ] 接手人已验证浅色、深色、手机 safe-area、reduced-motion、表白便签轮播和失物招领登录保护；
- [ ] 接手人能创建上线前备份、部署、验证和回滚；
- [ ] 接手人已做一次数据库和运行文件恢复演练；
- [ ] 接手人知道如何轮换管理员密码、数据库密码、`SECRET_KEY` 与机器人密钥；
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

- `2.0`（2026-08-25）：按当前 React/PostgreSQL/systemd 生产实现重写；补齐统一账号与四角色权限、审核员全局同权、公告系统、机器人提醒、头像处理、Apple/SwiftUI 前端、表白便签、失物招领、真实上线时间、安全部署/回滚及已知限制。
- `1.x`：早期开发阶段说明，已被本版取代；历史部署资料仅供追溯，不能覆盖当前代码与部署资产。
