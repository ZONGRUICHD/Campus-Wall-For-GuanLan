# campuswall-react 功能对齐契约

## 0. 契约基线

- 唯一参考：[`Gavin-LHX/campuswall-react@d33237e55e3b2a6a2ae3706f9d05aca39beab11f`](https://github.com/Gavin-LHX/campuswall-react/tree/d33237e55e3b2a6a2ae3706f9d05aca39beab11f)。
- 本文只记录该提交中可由源码、路由或前端调用证明的能力；README 仅用于交叉验证，不能扩张源码边界。
- HTTP 请求与响应以同目录的 [`openapi.yaml`](./openapi.yaml) 为规范；本文件规定页面、权限、状态机、模块归属和验收范围。
- 目标工程固定为根 npm workspace：`frontend/` 使用 React 19 + Vite，`backend/` 使用 Node.js + Express + PostgreSQL；下文“目标模块”均指这两个目录，参考源证据仍指固定提交中的原始 `frontend/`、`backend/` 文件。
- 参考项目称内容为 `message`，本契约也使用“留言/Message”。现有本地 `Post` 可在迁移期间映射为 `Message`，但不得因此保留参考项目不存在的五板块业务语义。
- 参考路径（例如 `/api/get_messages`、`/api/admin/api/messages`）作为兼容 URL 保留；新实现内部不得复制旧项目的 JSON 文件存储方式，目标后端统一使用关系模型与事务。

### 0.1 证据索引

| 证据 | 参考源文件 |
|---|---|
| SPA 页面与路由全集 | `frontend/src/App.jsx` |
| 前端实际 API 封装全集 | `frontend/src/services/api.js` |
| 公共、反馈、举报 API | `backend/src/routes/public.js` |
| 发帖、评论、反应、投票 API | `backend/src/routes/wall.js` |
| 上传 API | `backend/src/routes/upload.js` |
| 用户、收藏、通知 API | `backend/src/routes/users.js` |
| 管理 API 与权限判断 | `backend/src/routes/admin.js` |
| 留言、评论、审核、回收站状态机 | `backend/src/services/messageStore.js` |
| 用户、会话、收藏、通知 | `backend/src/services/userStore.js` |
| 管理员与权限定义 | `backend/src/services/managerStore.js`、`backend/src/services/auth.js` |
| 举报、反馈、设置、审计、应用 | `backend/src/services/reportStore.js`、`feedbackStore.js`、`settingsStore.js`、`auditStore.js`、`appStore.js` |
| 上传限制与运行参数 | `backend/src/config.js`、`backend/src/services/fileTools.js` |

## 1. 产品边界

### 1.1 必须实现

1. 单一校园留言墙：公开列表、详情、关键词搜索、附件/投票筛选、最新/赞/踩排序、标签分区和热门留言。
2. 游客与学生均可发匿名留言、评论、赞踩和投票；管理员设置可分别关闭全站或游客发帖/评论。
3. 学生账号由管理员 Excel 导入，不提供自助注册；支持登录、退出、资料、头像、改密、公开主页、我的发布、我的评论、收藏和通知。
4. 留言可含文字、标签、附件或投票；登录用户可选择公开昵称，游客强制匿名。
5. 评论支持附件和单层“回复某楼”引用，不实现无限嵌套树。
6. 留言/评论举报、追踪码查询、管理员处理和公开处理说明；独立的帮助反馈工单及进度查询。
7. 留言预审、单条/批量审核、置顶、精华、下架/恢复；评论单条/批量下架/恢复。
8. 留言和评论统一软删除到回收站，可恢复或在明确确认后永久删除。
9. 管理后台：仪表盘、留言、评论、回收站、用户、管理员、应用、公告、反馈、举报、设置、管理员日志、错误日志和结构化审计。
10. 管理员细粒度权限、签名 httpOnly 会话、会话版本失效、写请求可信 Origin 校验、分类限流、登录 CAPTCHA 配置。

### 1.2 明确排除

以下条目出现在本地 `一些可参考的.md`，但在固定参考提交中没有实现，因而不是本次对齐范围；不得创建菜单、空页面、表、接口或“即将上线”入口：

| 排除域 | 明确不做 |
|---|---|
| 交易与服务 | 二手市场、商品/订单/卖家、禁售品、支付、匿名联系；专用失物招领状态/地点/找回流程（参考项目只有普通标签“寻物”） |
| 社团与活动 | 社团主页/认证/成员/招新、活动发布/报名/签到/相册/提醒、校历后台 |
| 私信与社交关系 | 私信、消息请求、图片私信、撤回、匿名会话、黑名单、关注、粉丝 |
| 账号扩展 | 自助注册、找回密码、账号注销、校园身份认证、等级/信誉、设备管理、隐私中心、数据导出 |
| 内容扩展 | 草稿服务端同步、定时发布、转发、浏览历史、@用户、评论点赞/置顶/折叠/关闭评论、视频独立审核队列 |
| 搜索与推荐 | 用户/商品/社团/活动专用搜索、搜索建议/历史、关注流、个性化推荐；只保留留言关键词、标签和热门 |
| 申诉与风控 | 内容/封禁申诉、举报用户/私信/商品/图片、风险评分、设备/IP 风险后台、CAPTCHA 之外的注册防刷 |
| 平台扩展 | CMS、标签管理后台、分类管理后台、推荐/热榜编辑后台、RBAC 角色层级、管理员 2FA、PWA Push、多主题 |

“校园资讯、日常、失物招领、表白墙、树洞”是本地 MVP 的板块模型，不是参考提交的数据模型。参考提交只提供通用留言与自由标签；可以用标签展示这些名称，但不得把 `board`、`lost_found_kind`、`location`、`resolved` 当作对齐验收的必需字段。

## 2. 目标模块和数据模型

### 2.1 前端模块编号

| 编号 | 目标模块 |
|---|---|
| `FE-SHELL` | `frontend/src/App.jsx`、`frontend/src/main.jsx`、`frontend/src/components/layout/**`：Vite 入口、公共布局、路由保护、错误页 |
| `FE-WALL` | `frontend/src/features/wall/**`：列表、详情、标签、发布、留言卡、评论、反应、投票 |
| `FE-MEDIA` | `frontend/src/features/media/**`：上传、分片、附件预览与 URL |
| `FE-AUTH` | `frontend/src/features/auth/**`：学生/管理员登录和会话上下文 |
| `FE-ACCOUNT` | `frontend/src/features/account/**`：个人中心、公开主页、发布、评论、收藏、通知 |
| `FE-SUPPORT` | `frontend/src/features/support/**`：帮助、反馈、举报、追踪码 |
| `FE-APPS` | `frontend/src/features/apps/**`：应用广场 |
| `FE-ADMIN` | `frontend/src/features/admin/**`：后台壳及全部管理页面 |
| `FE-API` | `frontend/src/services/api/**`、`frontend/src/services/http.js`：由 OpenAPI 生成或严格对齐的请求客户端与共享 HTTP 配置 |

### 2.2 后端模块编号

| 编号 | 目标模块 |
|---|---|
| `BE-PUBLIC` | `backend/src/routes/public.js`、`backend/src/services/publicFeed.js` |
| `BE-WALL` | `backend/src/routes/wall.js`、`backend/src/services/messageStore.js`、`backend/src/services/reactionStore.js`、`backend/src/services/pollStore.js` |
| `BE-MEDIA` | `backend/src/routes/upload.js`、`backend/src/services/mediaStore.js`、`backend/src/services/fileTools.js` |
| `BE-USERS` | `backend/src/routes/users.js`、`backend/src/services/userStore.js`、`backend/src/services/sessionService.js` |
| `BE-SUPPORT` | `backend/src/routes/support.js`、`backend/src/services/reportStore.js`、`backend/src/services/feedbackStore.js` |
| `BE-ADMIN-CONTENT` | `backend/src/routes/admin/content.js`、`backend/src/services/moderationService.js`、`backend/src/services/trashService.js` |
| `BE-ADMIN-USERS` | `backend/src/routes/admin/users.js`、`backend/src/services/adminUserService.js` |
| `BE-ADMIN-OPS` | `backend/src/routes/admin/operations.js`、`backend/src/services/settingsStore.js`、`backend/src/services/noticeStore.js`、`backend/src/services/appStore.js` |
| `BE-ADMIN-AUTH` | `backend/src/routes/admin/auth.js`、`backend/src/services/managerStore.js`、`backend/src/services/auth.js`、`backend/src/services/permissions.js` |
| `BE-AUDIT` | `backend/src/services/auditStore.js`、`backend/src/middleware/adminAudit.js` |

### 2.3 规范实体

| 实体 | 必需语义 |
|---|---|
| `User` / `UserSession` | 唯一学号 `username`、scrypt/等强度密码哈希、真实姓名仅后台可见、昵称/性别/简介/头像、`active|disabled`、禁言截止与原因、会话版本 |
| `AdminUser` / `AdminSession` / `AdminPermission` | 用户名、哈希密码、`active|disabled`、权限集合、会话版本、登录/更新时间 |
| `Message` | 7 位兼容 ID 或稳定整数 ID、文字、附件、标签、作者绑定、匿名及昵称快照、赞踩数、置顶/精华、审核与管理状态、时间戳 |
| `Comment` | 稳定字符串 ID、留言 ID、文字、附件、作者绑定、引用评论 ID/摘要、管理状态、时间戳 |
| `MediaAsset` / `UploadChunk` | 安全文件名、原名、MIME/扩展名、大小、存储键、缩略/预览、分片会话；最终删除前保持引用完整 |
| `MessageReaction` | `(message_id, actor_key)` 唯一，值 `1|-1`，游客设备键或用户键 |
| `Poll` / `PollOption` / `PollVote` | 问题、2–6 个唯一选项、可选截止时间、计数；`(message_id, voter_key)` 唯一 |
| `Favorite` | `(user_id, message_id)` 唯一与收藏时间 |
| `Notification` | 接收用户、`comment|reply|moderation|comment_moderation|featured`、关联留言、内容、已读状态 |
| `Report` | 32 位追踪码、留言/评论目标、类别、理由、邮箱、摘要、待处理/已处理、处置、公开说明、处理人/时间 |
| `FeedbackTicket` / `FeedbackHistory` | 32 位追踪码、类别、主题、邮箱、正文、状态、公开回复、内部备注、变更历史 |
| `PlatformSetting` | CAPTCHA 与社区运营两类版本化配置；CAPTCHA secret 只加密存储且从不回传 |
| `Notice` / `CatalogApp` | 公告 CRUD；应用元数据、图标、发布状态与排序 |
| `AdminAuditEvent` | 操作者、HTTP 动作、目标类型/ID、摘要、元数据、创建时间 |
| `TrashEntry` | 不是独立业务内容；由 Message/Comment 的 `deleted` 状态、删除来源/原因/操作者/时间、删除前状态构成 |

### 2.4 权限编号

| 编号 | 含义 |
|---|---|
| `PUB` | 无登录要求；只返回公开、脱敏数据 |
| `PUB-W` | 无登录要求的写操作，但必须通过可信 `Origin/Referer` 和对应限流 |
| `USER` | 有效签名 `user_session`；停用或会话版本过期视为未登录 |
| `OWNER` | `USER` 且资源 `user_id` 等于当前用户 |
| `ADMIN` | 有效签名 `admin_session` |
| `WALL` | `ADMIN + manage_wall_message` |
| `USERS` | `ADMIN + (manage_users 或 manage_wall_message)` |
| `ADMINS` | `ADMIN + manage_admins` |
| `APPS` | `ADMIN + manage_apps` |
| `NOTICE` | `ADMIN + notice` |
| `FEEDBACK` | `ADMIN + view_user_log` |
| `REPORT` | `ADMIN + view_report`；删除被举报内容还需 `manage_wall_message` |
| `SETTINGS` | `ADMIN + manage_settings` |
| `ADMINLOG` | `ADMIN + view_admin_log` |
| `ERRORLOG` | `ADMIN + view_log` |

## 3. 用户端页面契约

每行都是独立验收项；“后端”中的接口均指 `openapi.yaml` 中同路径操作。

| ID / 页面 | 实际能力 | 参考源文件 | 目标前端 | 目标后端 | 实体 / 权限 | 验收测试 |
|---|---|---|---|---|---|---|
| `P-01 /` 首页 | 英雄入口、社区状态、快捷匿名发布、公告弹窗、热门留言、规则/帮助入口 | `frontend/src/pages/Home.jsx`、`contexts/PlatformContext.jsx` | `FE-SHELL`、`FE-WALL` | `BE-PUBLIC`、`BE-WALL` | Message、Notice、PlatformSetting / `PUB`,`PUB-W` | 公告只展示发布数据；热门只含 `visible`；关闭发帖或禁言时快捷发布不可用；成功发布后 pending/visible 提示正确。 |
| `P-02 /wall` 留言墙 | 搜索；全部/附件/投票筛选；最新/赞/踩排序；15 条窗口加载更多；发布文字/标签/附件/2–6 项投票；本地草稿；匿名切换 | `frontend/src/pages/Wall.jsx` | `FE-WALL`、`FE-MEDIA` | `BE-PUBLIC`、`BE-WALL`、`BE-MEDIA` | Message、MediaAsset、Poll / `PUB`,`PUB-W`，实名需 `USER` | 三种排序和三种筛选结果稳定；加载更多无重复；游客始终匿名；登录用户可公开昵称；上传后再提交；预审开启时新内容不出现在公共列表。 |
| `P-03 /wall/message/:id` | 完整留言、高清附件、投票、赞踩、收藏、分享、评论/回复、内容与评论举报入口 | `frontend/src/pages/MessageDetail.jsx`、`components/MessageCard.jsx` | `FE-WALL`、`FE-MEDIA`、`FE-ACCOUNT` | `BE-PUBLIC`、`BE-WALL`、`BE-USERS` | Message、Comment、Reaction、PollVote、Favorite / 读取 `PUB`，互动 `PUB-W`，收藏 `USER` | visible 内容可访问；pending/hidden/deleted 均 404；赞踩互斥；同一投票身份仅一次；回复引用正确；未登录收藏提示登录。 |
| `P-04 /p`、`/p/:tag` | 全部话题或指定标签列表；标签从留言卡可跳转 | `frontend/src/pages/Partition.jsx`、`components/MessageCard.jsx` | `FE-WALL` | `BE-PUBLIC` | Message、TagIndex / `PUB` | 指定标签只返回关联且 visible 的留言；下架/删除后立即从分区消失；空结果有可操作空态。 |
| `P-05 /login` | 学号密码登录；按公开配置渲染 Turnstile/reCAPTCHA；登录后回到原目标 | `frontend/src/pages/Login.jsx`、`components/CaptchaWidget.jsx` | `FE-AUTH` | `BE-USERS` | User、UserSession、PlatformSetting / `PUB-W` | CAPTCHA 关闭时可直接登录；开启时空 token/服务端验证失败均拒绝；错误密码或 disabled 用户拒绝；成功写 httpOnly cookie。 |
| `P-06 /me` | 用户摘要、公开主页入口、资料/性别/简介编辑、头像上传、修改密码、退出、四个个人数据入口 | `frontend/src/pages/Me.jsx` | `FE-ACCOUNT`、`FE-AUTH` | `BE-USERS` | User、UserSession、MediaAsset / `USER` | 未登录重定向；简介≤200；头像类型/大小校验；改密后当前会话更新且其他旧会话失效；退出清 cookie。 |
| `P-07 /me/favorites` | 分页收藏列表、在卡片取消收藏、继续浏览入口 | `frontend/src/pages/SavedMessages.jsx` | `FE-ACCOUNT`、`FE-WALL` | `BE-USERS` | Favorite、Message / `USER` | 跨设备显示同一账号收藏；重复收藏幂等；取消后即时移除；非 visible 内容不泄漏。 |
| `P-08 /me/posts` | 查看本人全部未删除留言（含匿名、pending、hidden）；编辑文字/标签/匿名；软删除 | `frontend/src/pages/MyPosts.jsx` | `FE-ACCOUNT`、`FE-WALL` | `BE-USERS`、`BE-ADMIN-CONTENT` | Message / `OWNER` | 匿名内容仍可由作者看到；hidden 原因可见；编辑重置 review 状态并遵守预审；不可编辑他人或 deleted；删除进入回收站。 |
| `P-09 /me/comments` | 跨留言分页查看本人评论、附件、引用、原帖状态、下架原因；软删除自己的评论 | `frontend/src/pages/MyComments.jsx` | `FE-ACCOUNT`、`FE-MEDIA` | `BE-USERS` | Comment、Message / `OWNER` | 只返回本人且未 deleted 的评论；原帖 hidden 时不向非原帖作者泄漏正文；删除他人评论返回 403/404；自删进入回收站。 |
| `P-10 /me/notifications` | 未读数、分页加载、点开标已读、全部已读、单删、清空 | `frontend/src/pages/Notifications.jsx`、`contexts/UserContext.jsx` | `FE-ACCOUNT` | `BE-USERS` | Notification / `USER` | 未读数与列表一致；操作只影响当前用户；点击通知跳转关联留言或个人发布；清空后计数归零。 |
| `P-11 /user/:id` | 公开昵称/性别/简介/头像/加入时间和非匿名公开留言；分享主页 | `frontend/src/pages/UserProfile.jsx` | `FE-ACCOUNT`、`FE-WALL` | `BE-USERS` | UserPublicProfile、Message / `PUB` | 永不返回 username、real_name、禁言原因或匿名留言；不存在用户 404；disabled 只显示公开状态，不开放后台字段。 |
| `P-12 /help` | 反馈、进度查询、举报、社区公约四个入口 | `frontend/src/pages/Help.jsx` | `FE-SUPPORT` | 无直接调用 | 无 / `PUB` | 四个入口均指向真实页面，不出现愿望功能入口。 |
| `P-13 /help/form` | 提交 bug/feature/account/content/other 反馈，主题和邮箱可选，正文必填 | `frontend/src/pages/HelpForm.jsx` | `FE-SUPPORT` | `BE-SUPPORT` | FeedbackTicket / `PUB-W` | 正文为空、超长或邮箱非法拒绝；成功生成不可猜测 32 位追踪码并进入成功页。 |
| `P-14 /help/report/:id`、`/help/report/:id/comment/:commentId` | 加载目标上下文；按 spam/abuse/porn/rumor/other 举报留言或评论 | `frontend/src/pages/Report.jsx` | `FE-SUPPORT` | `BE-SUPPORT`、`BE-PUBLIC` | Report、Message、Comment / `PUB-W` | 非 visible 目标或不存在评论 404；理由必填；成功返回独立追踪码；留言和评论目标类型准确。 |
| `P-15 /help/success` | 展示并复制反馈或举报追踪码，跳转查询页 | `frontend/src/pages/HelpSuccess.jsx` | `FE-SUPPORT` | 无直接调用 | tracking code / `PUB` | 两种类型使用正确 query key；刷新后仍可由 URL 展示；没有码时给出安全返回入口。 |
| `P-16 /help/status` | 在反馈/举报模式间切换，按追踪码查询状态、结果和公开回复 | `frontend/src/pages/HelpStatus.jsx` | `FE-SUPPORT` | `BE-SUPPORT` | FeedbackTicketPublic、ReportPublic / `PUB` | 允许带/不带短横线输入；错误或未知码 404；内部备注、举报邮箱和处理内部信息绝不返回。 |
| `P-17 /rules` | 展示后台维护的社区公约及暂停原因 | `frontend/src/pages/CommunityRules.jsx` | `FE-SUPPORT` | `BE-PUBLIC` | PlatformSetting / `PUB` | 公约按行展示；任一互动关闭时展示 pause_reason；公开响应不含 sensitive_words。 |
| `P-18 /apps` | 仅展示 published 应用，安全外链、图标、作者、描述、分类和排序 | `frontend/src/pages/Apps.jsx` | `FE-APPS` | `BE-PUBLIC` | CatalogApp / `PUB` | hidden 应用不可见；仅允许 http/https 链接；图标失败有回退；顺序为 sort_order、created_at。 |
| `P-19 *` | 404 页面和返回首页/墙入口 | `frontend/src/pages/NotFound.jsx`、`App.jsx` | `FE-SHELL` | 无 | 无 / `PUB` | 任意未知前端路由显示 404 而不是空白；未知 API 路由返回统一 JSON 404。 |

## 4. 管理员页面契约

| ID / 页面 | 实际能力 | 参考源文件 | 目标前端 | 目标后端 | 实体 / 权限 | 验收测试 |
|---|---|---|---|---|---|---|
| `A-01 /admin/login` | 管理员用户名/密码登录和来源页回跳 | `frontend/src/pages/admin/AdminLogin.jsx` | `FE-AUTH`、`FE-ADMIN` | `BE-ADMIN-AUTH` | AdminUser、AdminSession / `PUB-W` | active 且密码正确才写签名 cookie；密码不进 localStorage；限流生效。 |
| `A-02 /admin` | 运营指标、7 日趋势、治理指标、热门标签、按权限显示快捷入口 | `frontend/src/pages/admin/Admin.jsx` | `FE-ADMIN` | `BE-ADMIN-OPS` | 聚合统计 / `ADMIN` | 统计与数据库一致；普通管理员看不到无权限快捷入口；刷新更新时间。 |
| `A-03 /admin/wall` | 状态队列、搜索分页、详情、单/批审核、退回、下架/恢复、置顶、精华、移回收站 | `frontend/src/pages/admin/AdminWall.jsx` | `FE-ADMIN` | `BE-ADMIN-CONTENT` | Message、User、Moderation / `WALL` | 六种筛选计数正确；批量 1–100；状态转换符合 §6；作者收到对应通知；操作审计落一条。 |
| `A-04 /admin/comments` | 评论搜索、visible/hidden 筛选、单/批下架恢复、移回收站 | `frontend/src/pages/admin/AdminComments.jsx` | `FE-ADMIN` | `BE-ADMIN-CONTENT` | Comment、User、Moderation / `WALL` | 隐藏评论从公共响应与热度中消失；引用摘要脱敏；批量 1–100；作者收到通知。 |
| `A-05 /admin/trash` | 留言/评论筛选搜索分页、单/批恢复或永久删除 | `frontend/src/pages/admin/AdminTrash.jsx` | `FE-ADMIN` | `BE-ADMIN-CONTENT` | TrashEntry、MediaAsset / `WALL` | 恢复到删除前合法状态；非回收站资源不能 purge；purge 必须 `confirm=PURGE`；仅无引用附件被清理。 |
| `A-06 /admin/users` | 统计、搜索/状态/禁言筛选、Excel 导入、编辑资料、禁言/解禁、停用、重置密码 | `frontend/src/pages/admin/AdminUsers.jsx` | `FE-ADMIN` | `BE-ADMIN-USERS` | User、UserSession / `USERS` | `.xlsx` 至少可按学号/密码/姓名导入，最多 5000 行；学号不可改；禁言阻止发帖评论；停用/重置使旧会话失效。 |
| `A-07 /admin/managers` | 新建、启停、权限分配、重置他人密码、修改自己密码 | `frontend/src/pages/admin/AdminManagers.jsx` | `FE-ADMIN` | `BE-ADMIN-AUTH` | AdminUser、AdminPermission / `ADMINS` | 至少保留一个 active 管理员和一个 active `manage_admins`；不可停用自己或移除自己的管理管理员权限；改密使旧会话失效。 |
| `A-08 /admin/apps` | 应用统计/搜索、新增编辑、图标上传、上下架、永久删除 | `frontend/src/pages/admin/AdminApps.jsx` | `FE-ADMIN`、`FE-APPS` | `BE-ADMIN-OPS` | CatalogApp、MediaAsset / `APPS` | slug 唯一且规范化；URL 仅 http/https；图标类型/5MiB 限制；下架即时从公共页消失；删除清图标。 |
| `A-09 /admin/settings` | 社区开关、游客开关、预审、暂停说明、公约、敏感词；CAPTCHA provider/site/secret | `frontend/src/pages/admin/AdminSettings.jsx` | `FE-ADMIN` | `BE-ADMIN-OPS` | PlatformSetting / `SETTINGS` | 设置由后端强制而非只禁用 UI；敏感词≤200、单词≤50；关闭预审释放 pending 并通知作者；secret 留空保留且响应不回传。 |
| `A-10 /admin/notice` | 公告列表、发布、编辑、撤回 | `frontend/src/pages/admin/AdminNotice.jsx` | `FE-ADMIN` | `BE-ADMIN-OPS` | Notice / `NOTICE` | 空公告不新增；编辑保留 ID 并写 updated 字段；撤回后公共公告消失；全部写操作审计。 |
| `A-11 /admin/feedback` | 工单搜索、类别/状态筛选、分页、公开回复、内部备注、流转历史 | `frontend/src/pages/admin/AdminFeedback.jsx` | `FE-ADMIN` | `BE-SUPPORT` | FeedbackTicket、FeedbackHistory / `FEEDBACK` | 状态仅四值；历史记录前后状态、操作者及回复/备注变更；公开查询只见 public_reply。 |
| `A-12 /admin/report` | 按留言聚合待处理举报、上下文；保留/删评论/删留言；公开说明；历史筛选分页 | `frontend/src/pages/admin/AdminReport.jsx` | `FE-ADMIN` | `BE-SUPPORT`、`BE-ADMIN-CONTENT` | Report、Message、Comment / `REPORT`，删除另需 `WALL` | 同目标举报随删除一并归档；处置幂等冲突返回 409；删除进入回收站；追踪页显示 resolution/public_reply。 |
| `A-13 /admin/log` | 兼容管理员文本日志搜索与最多 1000 行展示 | `frontend/src/pages/admin/AdminLog.jsx` | `FE-ADMIN` | `BE-ADMIN-OPS` | LegacyAdminLog / `ADMINLOG` | 无权限 403；搜索不区分大小写；不返回超过上限。 |
| `A-14 /admin/audit` | 结构化审计时间线，关键词、目标类型、操作者/动作（API）和分页 | `frontend/src/pages/admin/AdminAudit.jsx` | `FE-ADMIN` | `BE-AUDIT` | AdminAuditEvent / `ADMINLOG` | 成功管理写请求恰好一条事件；失败请求和读取不记录；筛选、倒序和分页稳定。 |
| `A-15 /admin/error_log` | 错误日志搜索与最多 1000 行展示 | `frontend/src/pages/admin/AdminLog.jsx` | `FE-ADMIN` | `BE-ADMIN-OPS` | ErrorLog / `ERRORLOG` | 文件不存在返回空数组；无权限 403；不暴露超出日志视图的文件。 |
| `A-16 AdminShell/ProtectedRoute` | 每次后台路由验证会话，按权限隐藏导航，安全退出 | `frontend/src/App.jsx`、`components/AdminShell.jsx` | `FE-ADMIN`、`FE-AUTH` | `BE-ADMIN-AUTH` | AdminSession、AdminPermission / `ADMIN` | 过期会话重定向登录；隐藏菜单不能替代后端 403；POST 退出后 cookie 失效。 |

## 5. 领域能力契约

| ID / 能力 | 参考源文件 | 目标前端 | 目标后端 | 数据实体 | 权限 | 验收测试 |
|---|---|---|---|---|---|---|
| `USR-01` 管理员导入学生账号 | `AdminUsers.jsx`、`admin.js`、`userStore.js` | `FE-ADMIN` | `BE-ADMIN-USERS` | User | `USERS` | 新增/更新/跳过和逐行错误可核对；密码非空才重置。 |
| `USR-02` 学生登录/会话/退出 | `Login.jsx`、`UserContext.jsx`、`users.js` | `FE-AUTH` | `BE-USERS` | UserSession | `PUB-W`,`USER` | 签名、过期、session_version、disabled 四类校验覆盖。 |
| `USR-03` 资料、头像、密码 | `Me.jsx`、`users.js` | `FE-ACCOUNT` | `BE-USERS`、`BE-MEDIA` | User、MediaAsset | `USER` | 字段边界、头像白名单、旧头像替换、改密失效均通过。 |
| `USR-04` 公开身份隔离 | `utils/user.js`、`public.js`、`users.js` | `FE-ACCOUNT`、`FE-WALL` | `BE-USERS`、`BE-PUBLIC` | UserPublicProfile、Message | `PUB` | 匿名内容永不含 user_id/username；实名只给昵称快照和公开 user_id；后台仍可追溯。 |
| `USR-05` 禁言/停用/重置 | `AdminUsers.jsx`、`admin.js` | `FE-ADMIN` | `BE-ADMIN-USERS` | User | `USERS` | 禁言只阻止发帖/评论，不阻止读/收藏；停用拒绝会话；重置密码踢出旧会话。 |
| `CNT-01` 留言创建和编辑 | `Wall.jsx`、`MyPosts.jsx`、`wall.js`、`users.js` | `FE-WALL`、`FE-ACCOUNT` | `BE-WALL`、`BE-USERS` | Message | `PUB-W`,`OWNER` | 文字/附件/投票至少一项；标签≤10且单项≤50；文本≤10000；编辑不允许改附件/投票。 |
| `CNT-02` 列表/详情/搜索/排序 | `Wall.jsx`、`MessageDetail.jsx`、`public.js` | `FE-WALL` | `BE-PUBLIC` | Message | `PUB` | pinned 优先；newest/likes/dislikes 正确；word 搜文字/投票题；files/polls 筛选；只见 visible。 |
| `CNT-03` 标签分区与热门 | `Partition.jsx`、`messageStore.js` | `FE-WALL` | `BE-PUBLIC` | Message、TagIndex | `PUB` | 标签索引随创建/编辑更新；热门计入赞踩评论和投票且精华优先；隐藏内容排除。 |
| `CNT-04` 评论与楼层回复 | `MessageCard.jsx`、`wall.js` | `FE-WALL` | `BE-WALL` | Comment、Notification | `PUB-W` | 可纯附件评论；reply target 必须 visible；引用摘要≤120；回复人与原作者通知去重。 |
| `CNT-05` 赞踩 | `MessageCard.jsx`、`messageStore.js` | `FE-WALL` | `BE-WALL` | MessageReaction | `PUB-W` | 同身份最多一态；重复点击取消；赞转踩计数同时调整；刷新恢复。 |
| `MED-01` 直接与分片上传 | `Wall.jsx`、`upload.js`、`fileTools.js` | `FE-MEDIA` | `BE-MEDIA` | UploadChunk、MediaAsset | `PUB-W` | ≤10MiB 直接上传；大文件按分片合并；缺片/元数据冲突拒绝；总内容≤500MiB。 |
| `MED-02` 附件安全与预览 | `MessageCard.jsx`、`utils/user.js`、`public.js` | `FE-MEDIA` | `BE-MEDIA`、`BE-PUBLIC` | MediaAsset | `PUB` | 路径穿越失败；允许扩展名与配置一致；图片缩略图、视频 ffmpeg 失败返回明确错误；静态缓存头正确。 |
| `MED-03` 评论附件与头像/应用图标 | `wall.js`、`users.js`、`appStore.js` | `FE-MEDIA`、`FE-ACCOUNT`、`FE-ADMIN` | `BE-MEDIA`、`BE-USERS`、`BE-ADMIN-OPS` | MediaAsset | 按所属写权限 | 评论最多10件；头像/应用图标≤5MiB且类型白名单；永久删除仅清无引用附件。 |
| `POL-01` 创建投票 | `Wall.jsx`、`wall.js` | `FE-WALL` | `BE-WALL` | Poll、PollOption | `PUB-W` | 问题≤200；2–6 个非空、不重复选项且每项≤80；截止在未来30天内或为空。 |
| `POL-02` 单选与结果 | `MessageCard.jsx`、`messageStore.js` | `FE-WALL` | `BE-WALL` | PollVote | `PUB-W` | 每身份每投票唯一；投后或结束后显示结果；结束后拒绝；重复返回原选项。 |
| `FAV-01` 收藏 | `UserContext.jsx`、`SavedMessages.jsx`、`users.js` | `FE-ACCOUNT` | `BE-USERS` | Favorite | `USER` | 新增幂等、删除幂等；ID 与分页列表一致；非 visible 自动过滤。 |
| `NOT-01` 评论/回复通知 | `wall.js`、`userStore.js` | `FE-ACCOUNT` | `BE-WALL`、`BE-USERS` | Notification | `USER` 接收 | 不给自己发通知；评论原作者与被回复者按用户去重。 |
| `NOT-02` 治理/精华/恢复通知 | `admin.js` | `FE-ACCOUNT`、`FE-ADMIN` | `BE-ADMIN-CONTENT`、`BE-USERS` | Notification | 管理动作对应权限 | 审核、退回、上下架、评论治理、精华、回收站恢复生成准确文案。 |
| `NOT-03` 通知管理 | `Notifications.jsx`、`users.js` | `FE-ACCOUNT` | `BE-USERS` | Notification | `USER` | 分页、未读、单读、全读、单删、清空均按用户隔离。 |
| `RPT-01` 留言/评论举报 | `Report.jsx`、`public.js`、`reportStore.js` | `FE-SUPPORT` | `BE-SUPPORT` | Report | `PUB-W` | 目标存在且 visible；类别规范化；追踪码唯一；限流。 |
| `RPT-02` 举报处置/历史/公开查询 | `AdminReport.jsx`、`admin.js` | `FE-SUPPORT`、`FE-ADMIN` | `BE-SUPPORT`、`BE-ADMIN-CONTENT` | Report、TrashEntry | `REPORT`/删除需`WALL` | dismiss/delete_comment/delete_message 三态；处置原子归档；公开页不泄漏举报人邮箱。 |
| `FBK-01` 反馈提交与查询 | `HelpForm.jsx`、`HelpStatus.jsx`、`feedbackStore.js` | `FE-SUPPORT` | `BE-SUPPORT` | FeedbackTicket | `PUB-W`/查询`PUB` | 五类别、追踪码、公开字段与错误边界正确。 |
| `FBK-02` 反馈后台流转 | `AdminFeedback.jsx`、`admin.js` | `FE-ADMIN` | `BE-SUPPORT` | FeedbackTicket、FeedbackHistory | `FEEDBACK` | pending/in_progress/resolved/closed；公开回复与内部备注隔离；每次变化有历史。 |
| `MOD-01` 留言审核 | `AdminWall.jsx`、`admin.js`、`messageStore.js` | `FE-ADMIN` | `BE-ADMIN-CONTENT` | Message、Moderation | `WALL` | 预审开关两种模式及单/批 approve/return 全组合覆盖。 |
| `MOD-02` 留言置顶/精华/下架 | 同上 | `FE-ADMIN`、`FE-WALL` | `BE-ADMIN-CONTENT` | Message | `WALL` | pinned 改排序；featured 改热门权重并通知；hidden 从所有公共面消失且记录原因。 |
| `MOD-03` 评论下架 | `AdminComments.jsx`、`admin.js` | `FE-ADMIN` | `BE-ADMIN-CONTENT` | Comment | `WALL` | visible/hidden 转换、批量上限、引用脱敏、计数与通知正确。 |
| `TRH-01` 软删除 | `users.js`、`admin.js`、`messageStore.js` | `FE-ACCOUNT`、`FE-ADMIN` | `BE-ADMIN-CONTENT` | TrashEntry | `OWNER` 或 `WALL` | 保存 deleted_from_status、来源、原因、操作者、时间；公共面立即消失。 |
| `TRH-02` 恢复/永久删除 | `AdminTrash.jsx`、`admin.js` | `FE-ADMIN` | `BE-ADMIN-CONTENT` | TrashEntry、MediaAsset | `WALL` | 恢复合法前态；purge 二次确认且不可逆；批量最多100；附件引用安全。 |
| `SET-01` 社区运营设置 | `AdminSettings.jsx`、`settingsStore.js` | `FE-ADMIN`、`FE-SUPPORT` | `BE-ADMIN-OPS` | PlatformSetting | 写`SETTINGS`/读`PUB` | 服务端强制五开关、pause_reason、公约和敏感词；公开响应脱敏。 |
| `SET-02` CAPTCHA 设置 | 同上、`captcha.js` | `FE-ADMIN`、`FE-AUTH` | `BE-ADMIN-OPS`、`BE-USERS` | PlatformSetting | 写`SETTINGS`/公开配置`PUB` | none/turnstile/recaptcha；启用需 site+secret；secret 加密且永不回传。 |
| `AUD-01` 细粒度管理员权限 | `managerStore.js`、`AdminShell.jsx` | `FE-ADMIN` | `BE-ADMIN-AUTH` | AdminPermission | `ADMINS` | 十个权限逐接口 401/403/200；前端菜单和后端判定一致。 |
| `AUD-02` 结构化审计 | `admin.js`、`auditStore.js` | `FE-ADMIN` | `BE-AUDIT` | AdminAuditEvent | 读`ADMINLOG` | 所有成功管理写操作记录 actor/action/target/summary/status；失败和 GET 不记录。 |
| `AUD-03` 兼容日志 | `AdminLog.jsx`、`admin.js` | `FE-ADMIN` | `BE-ADMIN-OPS` | LegacyAdminLog、ErrorLog | `ADMINLOG`/`ERRORLOG` | 独立权限、搜索、最多1000行；文件路径固定不可注入。 |

## 6. 强制状态机与可见性

### 6.1 留言

`moderation_status`: `pending | visible | hidden | deleted`；`review_status`: `pending | approved`。

| 事件 | 结果 |
|---|---|
| 创建，预审关闭 | `visible + pending`（公开但待复核） |
| 创建，预审开启 | `pending + pending`（仅作者与管理员可见） |
| 审核通过 | `visible + approved` |
| 退回，预审开启 | `pending + pending` |
| 退回，预审关闭 | 保持公开或当前合法管理态，`review_status=pending` |
| 作者编辑 | `review_status=pending`；预审开启时转 `pending`，但已 `hidden` 的仍 hidden |
| 管理员下架 | `hidden`，必须有对作者可见原因 |
| 管理员恢复 | 预审开启且未 approved 时 `pending`，否则 `visible` |
| 作者/管理员删除 | `deleted`，记录 `deleted_from_status` |
| 回收站恢复 | 恢复删除前状态；非法/缺失前态保守恢复为 hidden |
| 永久删除 | 仅 `deleted` 可执行 |

公共列表、详情、标签、热门、收藏、赞踩、评论和投票只能读取/操作 `visible`。作者的“我的发布”可以读取自己的 `pending` 和 `hidden`，管理员可以按权限读取全部非永久删除内容。

### 6.2 评论

`moderation_status`: `visible | hidden | deleted`。公共响应只计入/返回 visible 评论。引用目标被隐藏/删除时，引用文本固定为“该评论已被管理员隐藏”或等价脱敏文案；作者可在“我的评论”看到自己的 hidden 原因。

### 6.3 匿名

- 游客留言强制 `anonymous=true`，无 User 绑定。
- 登录用户留言默认匿名，可显式选择 `anonymous=false`；公开时只显示发布时 `display_name_snapshot`，不显示学号/真实姓名。
- 评论在参考实现中统一匿名展示；登录评论仍保存 `user_id` 供本人管理、通知和后台追溯。
- 管理员详情可查看绑定账号；公共 API 必须删除匿名留言/评论的 `user_id`、`username`。

## 7. API 完整清单

### 7.1 公共、墙与上传

| ID / 方法路径 | 用途 | 参考源文件 | 目标前端 / 后端 | 实体 / 权限 | 验收测试 |
|---|---|---|---|---|---|
| `API-P01 GET /health` | 存活检查 | `backend/src/server.js` | 运维 / `BE-PUBLIC` | 无 / `PUB` | 200 且 `status=ok`。 |
| `API-P02 GET /api/get_messages` | 窗口分页、搜索、排序、筛选 | `public.js` | `FE-WALL` / `BE-PUBLIC` | Message / `PUB` | start/end 边界、total、visible 过滤与 viewer 状态。 |
| `API-P03 POST /api/get_hot_messages` | 热门留言 | `public.js` | `FE-WALL` / `BE-PUBLIC` | Message / `PUB` | 只返回热门 visible 留言。 |
| `API-P04 POST /api/get_message_details/{messageId}` | 公开详情 | `public.js` | `FE-WALL`,`FE-SUPPORT` / `BE-PUBLIC` | Message / `PUB` | 非公开统一 404。 |
| `API-P05 POST /api/get_message_partitions/{messageId}` | 留言标签 | `public.js` | `FE-WALL` / `BE-PUBLIC` | TagIndex / `PUB` | 公开目标返回 tags。 |
| `API-P06 POST /api/get_tags` | 公开标签全集 | `public.js` | `FE-WALL` / `BE-PUBLIC` | TagIndex / `PUB` | 只含至少一个 visible 留言的标签。 |
| `API-P07 POST /api/get_partition_messages` | 标签关联 ID | `public.js` | `FE-WALL` / `BE-PUBLIC` | TagIndex / `PUB` | 模糊兼容标签，过滤非公开 ID。 |
| `API-P08 POST /api/notice` | 公告 | `public.js` | `FE-WALL` / `BE-PUBLIC` | Notice / `PUB` | 返回全部当前公告。 |
| `API-P09 POST /api/apps` | 应用广场 | `public.js` | `FE-APPS` / `BE-PUBLIC` | CatalogApp / `PUB` | 仅 published，顺序稳定。 |
| `API-P10 GET /api/community/config` | 公开社区设置 | `public.js` | 全前端 / `BE-PUBLIC` | PlatformSetting / `PUB` | `Cache-Control:no-store`，无 sensitive_words。 |
| `API-P11 POST /api/help/form` | 创建反馈 | `public.js` | `FE-SUPPORT` / `BE-SUPPORT` | FeedbackTicket / `PUB-W` | 校验、限流、追踪码。 |
| `API-P12 GET /api/help/status/{ticketId}` | 反馈公开状态 | `public.js` | `FE-SUPPORT` / `BE-SUPPORT` | FeedbackTicketPublic / `PUB` | 字段脱敏，未知码404。 |
| `API-P13 GET /api/help/report/status/{reportId}` | 举报公开状态 | `public.js` | `FE-SUPPORT` / `BE-SUPPORT` | ReportPublic / `PUB` | pending/processed 与公开说明正确。 |
| `API-P14 POST /api/help/report/{messageId}` | 举报留言 | `public.js` | `FE-SUPPORT` / `BE-SUPPORT` | Report / `PUB-W` | visible 校验并生成追踪码。 |
| `API-P15 POST /api/help/report/{messageId}/comment/{commentId}` | 举报评论 | `public.js` | `FE-SUPPORT` / `BE-SUPPORT` | Report、Comment / `PUB-W` | 评论必须属于该 visible 留言且自身 visible。 |
| `API-P16 GET /api/get_page_size` | 旧客户端读取留言窗口大小 | `public.js` | 无当前调用 / `BE-PUBLIC` 兼容层 | 运行配置 / `PUB` | 返回正整数 `page_size`；目标响应可增加统一 `success` 字段但不得删除原字段。 |
| `API-P17 GET /static/notice.json` | 旧客户端直接读取公告 JSON | `server.js` | 无当前调用 / `BE-ADMIN-OPS` 兼容层 | Notice / `PUB` | 返回公告数组；与 `/api/notice` 使用同一数据源且内容、顺序一致。 |
| `API-W01 POST /api/wall/submit` | 创建留言/投票并绑定已上传文件 | `wall.js` | `FE-WALL` / `BE-WALL` | Message、Poll / `PUB-W` | 内容、标签、文件、匿名、策略、预审全部后端校验。 |
| `API-W02 POST /api/wall/comment/{messageId}` | 评论/回复及评论附件 | `wall.js` | `FE-WALL` / `BE-WALL` | Comment、Notification / `PUB-W` | 可纯附件；引用合法；禁言/策略生效。 |
| `API-W03 POST /api/wall/like/{messageId}` | 点赞/取消/切换 | `wall.js` | `FE-WALL` / `BE-WALL` | MessageReaction / `PUB-W` | 原子计数和互斥。 |
| `API-W04 POST /api/wall/dislike/{messageId}` | 点踩/取消/切换 | `wall.js` | `FE-WALL` / `BE-WALL` | MessageReaction / `PUB-W` | 原子计数和互斥。 |
| `API-W05 POST /api/wall/poll/{messageId}/vote` | 单选投票 | `wall.js` | `FE-WALL` / `BE-WALL` | PollVote / `PUB-W` | 唯一约束、截止时间与选项校验。 |
| `API-M01 POST /api/direct_upload` | 小文件上传 | `upload.js` | `FE-MEDIA` / `BE-MEDIA` | MediaAsset / `PUB-W` | 单文件、类型和 10MiB 限制。 |
| `API-M02 POST /api/chunked_upload` | 写单个分片 | `upload.js` | `FE-MEDIA` / `BE-MEDIA` | UploadChunk / `PUB-W` | index/total/key/原名一致，幂等计数。 |
| `API-M03 POST /api/merge_chunks` | 合并并处理分片 | `upload.js` | `FE-MEDIA` / `BE-MEDIA` | UploadChunk、MediaAsset / `PUB-W` | 必须齐片，成功清临时目录。 |
| `API-M04 GET /static/uploads/{filename}` | 原附件 | `server.js` | `FE-MEDIA` / `BE-MEDIA` | MediaAsset / `PUB` | 安全 basename、正确 MIME 与缓存。 |
| `API-M05 GET /static/tiny_files/{filename}` | 缩略/预览 | `server.js`,`public.js` | `FE-MEDIA` / `BE-MEDIA` | MediaAsset / `PUB` | 缩略不存在可回退原文件，路径穿越404。 |
| `API-M06 GET /api/static/files/{filename}` | 原附件兼容别名 | `public.js` | 无当前调用 / `BE-MEDIA` 兼容层 | MediaAsset / `PUB` | 与 `/static/uploads/{filename}` 字节、MIME、缓存和 404 语义一致。 |
| `API-M07 GET /api/static/tiny_files/{filename}` | 预览兼容别名 | `public.js` | 无当前调用 / `BE-MEDIA` 兼容层 | MediaAsset / `PUB` | 优先预览、缺失时回退原件；路径穿越和未知文件均 404。 |
| `API-M08 GET /static/apps/icons/{filename}` | 本地应用图标 | `server.js`、`appStore.js` | `FE-APPS` / `BE-ADMIN-OPS` | CatalogApp、MediaAsset / `PUB` | 只服务图标目录安全 basename；删除/替换应用图标后旧资源不可再访问。 |

### 7.2 用户 API

| ID / 方法路径 | 用途 | 参考源文件 | 目标前端 / 后端 | 实体 / 权限 | 验收测试 |
|---|---|---|---|---|---|
| `API-U01 GET /api/user/captcha/config` | 登录 CAPTCHA 公共配置 | `users.js` | `FE-AUTH` / `BE-USERS` | PlatformSetting / `PUB` | 无 secret，no-store。 |
| `API-U02 POST /api/user/login` | 学生登录 | `users.js` | `FE-AUTH` / `BE-USERS` | UserSession / `PUB-W` | CAPTCHA、密码、状态、限流。 |
| `API-U03 POST /api/user/logout` | 学生退出 | `users.js` | `FE-AUTH` / `BE-USERS` | UserSession / `USER` 或幂等 | 清 cookie。 |
| `API-U04 GET /api/user/me` | 严格当前用户 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | User / `USER` | 未登录401。 |
| `API-U05 GET /api/user/session` | 可选会话探测 | `users.js` | 全前端 / `BE-USERS` | User / `PUB` | 未登录以 success=false 返回且不抛500。 |
| `API-U06 PUT /api/user/me/profile` | 更新昵称/性别/简介 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | User / `USER` | 字段范围和身份隔离。 |
| `API-U07 POST /api/user/me/password` | 修改密码 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | UserSession / `USER` | 当前密码、新密码8–128、会话版本。 |
| `API-U08 POST /api/user/me/avatar` | 上传头像 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | User、MediaAsset / `USER` | 类型/5MiB/安全名。 |
| `API-U09 GET /api/user/me/favorites/ids` | 当前收藏 ID | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Favorite / `USER` | 只含 visible。 |
| `API-U10 GET /api/user/me/favorites` | 收藏分页 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Favorite、Message / `USER` | 标准分页和 favorited_at。 |
| `API-U11 POST /api/user/me/favorites/{messageId}` | 收藏 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Favorite / `USER` | 目标 visible，幂等。 |
| `API-U12 DELETE /api/user/me/favorites/{messageId}` | 取消收藏 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Favorite / `USER` | 幂等且隔离。 |
| `API-U13 GET /api/user/me/messages` | 我的发布分页 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Message / `USER` | 含本人匿名/pending/hidden，不含 deleted。 |
| `API-U14 PUT /api/user/me/messages/{messageId}` | 编辑本人留言 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Message / `OWNER` | 所有权、禁言、策略、预审。 |
| `API-U15 DELETE /api/user/me/messages/{messageId}` | 自删留言 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | TrashEntry、Report / `OWNER` | 软删除并归档关联待处理举报。 |
| `API-U16 GET /api/user/me/comments` | 我的评论分页 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Comment / `USER` | 上下文脱敏。 |
| `API-U17 DELETE /api/user/me/comments/{messageId}/{commentId}` | 自删评论 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | TrashEntry、Report / `OWNER` | 软删除并归档该评论举报。 |
| `API-U18 GET /api/user/me/notifications/unread-count` | 未读数 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Notification / `USER` | 与列表一致。 |
| `API-U19 GET /api/user/me/notifications` | 通知分页 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Notification / `USER` | 倒序标准分页。 |
| `API-U20 POST /api/user/me/notifications/{notificationId}/read` | 单条已读 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Notification / `USER` | 仅本人，重复幂等。 |
| `API-U21 POST /api/user/me/notifications/read-all` | 全部已读 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Notification / `USER` | 返回更新数。 |
| `API-U22 DELETE /api/user/me/notifications/{notificationId}` | 删除通知 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Notification / `USER` | 非本人按不存在处理。 |
| `API-U23 DELETE /api/user/me/notifications` | 清空通知 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Notification / `USER` | 返回删除数。 |
| `API-U24 GET /api/user/{userId}/profile` | 公开资料 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | UserPublicProfile / `PUB` | 严格脱敏。 |
| `API-U25 GET /api/user/{userId}/messages` | 公开用户留言 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | Message / `PUB` | 仅实名且 visible。 |
| `API-U26 GET /api/user/{userId}/avatar` | 头像或 SVG 回退 | `users.js` | `FE-ACCOUNT` / `BE-USERS` | MediaAsset / `PUB` | 正确类型与缓存；`/user/{userId}/avatar` 为兼容别名。 |

`backend/src/server.js` 还把同一个 `usersRouter` 挂载到 `/user`，因此源码层面存在与 API-U01–U26 同方法、同后缀的 `/user/*` 镜像。固定提交的当前前端只调用 `/api/user/*`；目标客户端和主路由以该前缀为准，`openapi.yaml` 仅保留实际作为资源 URL 使用的 `/user/{userId}/avatar` 别名。若部署方启用其余镜像，鉴权、Origin、请求和响应必须逐项委托规范操作，禁止形成第二套行为。

### 7.3 管理员 API

下表的所有写操作还必须通过可信 Origin，并由 `BE-AUDIT` 在成功后记录。

| ID / 方法路径 | 用途 | 参考源文件 | 目标前端 / 后端 | 实体 / 权限 | 验收测试 |
|---|---|---|---|---|---|
| `API-A01 POST /api/admin/login` | 登录 | `admin.js` | `FE-AUTH` / `BE-ADMIN-AUTH` | AdminSession / `PUB-W` | active、密码、限流、cookie。 |
| `API-A02 POST /api/admin/logout` | 退出 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-AUTH` | AdminSession / `ADMIN` | 清 cookie；GET 兼容路径返回405。 |
| `API-A03 GET /api/admin/verify` | 校验会话与返回权限 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-AUTH` | AdminUser / 可选`ADMIN` | 过期返回 success=false。 |
| `API-A04 GET /api/admin/dashboard/stats` | 仪表盘聚合 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | Aggregate / `ADMIN` | 各子统计一致并带 generated_at。 |
| `API-A05 GET /api/admin/managers` | 管理员/权限清单 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-AUTH` | AdminUser、Permission / `ADMINS` | 无密码哈希。 |
| `API-A06 POST /api/admin/managers` | 创建管理员 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-AUTH` | AdminUser / `ADMINS` | 用户名、密码、权限校验，重复409。 |
| `API-A07 PUT /api/admin/managers/{username}` | 启停与改权限 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-AUTH` | AdminUser / `ADMINS` | 最后管理员保护和会话失效。 |
| `API-A08 POST /api/admin/managers/{username}/reset_password` | 重置他人密码 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-AUTH` | AdminUser / `ADMINS` | 不能重置自己；旧会话失效。 |
| `API-A09 POST /api/admin/managers/me/password` | 自己改密 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-AUTH` | AdminSession / `ADMIN` | 当前密码校验并续发当前会话。 |
| `API-A10 GET,PUT /api/admin/settings/captcha` | 读取/更新 CAPTCHA | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | PlatformSetting / `SETTINGS` | secret 不回传；启用前完整校验。 |
| `API-A11 GET,PUT /api/admin/settings/community` | 读取/更新社区设置 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | PlatformSetting / `SETTINGS` | 关闭预审释放数、敏感词校验。 |
| `API-A12 GET /api/admin/api/messages` | 管理留言分页 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Message / `WALL` | 六状态、搜索、计数、用户富化。 |
| `API-A13 GET /api/admin/api/get_message/{messageId}` | 管理详情 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Message、User / `WALL`或`REPORT` | 包含绑定用户和评论上下文。 |
| `API-A14 GET /api/admin/api/approved_ids` | 已审核 ID 兼容视图 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Message / `WALL` | 仅非 deleted approved。 |
| `API-A15 POST /api/admin/approve_message/{messageId}` | 切换审核兼容操作 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Moderation / `WALL` | 状态与显式 review 操作一致。 |
| `API-A16 POST /api/admin/messages/{messageId}/review` | approve/return | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Moderation、Notification / `WALL` | 状态机和通知。 |
| `API-A17 POST /api/admin/messages/{messageId}/moderation` | pinned/featured/hidden | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Moderation、Notification / `WALL` | 至少一字段；原因≤200。 |
| `API-A18 POST /api/admin/messages/bulk-moderation` | 批量审核/上下架 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Moderation / `WALL` | 1–100、逐项结果、成功/失败计数。 |
| `API-A19 POST /api/admin/delete_message/{messageId}` | 留言移回收站 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | TrashEntry、Report / `WALL` | 关联举报归档。 |
| `API-A20 POST /api/admin/repair_message/{messageId}` | 重建媒体缩略图 | `admin.js` | `FE-ADMIN` / `BE-MEDIA` | MediaAsset / `WALL` | 无附件也成功；缺目标404。 |
| `API-A21 GET /api/admin/comments` | 评论队列 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Comment、User / `WALL` | 搜索、三状态、分页与 counts。 |
| `API-A22 POST /api/admin/comments/{messageId}/{commentId}/moderation` | 评论上下架 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Comment、Notification / `WALL` | hidden 布尔必填，原因≤200。 |
| `API-A23 POST /api/admin/comments/bulk-moderation` | 批量评论治理 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | Comment / `WALL` | 1–100、逐项结果。 |
| `API-A24 POST /api/admin/api/delete_comment/{messageId}/{commentId}` | 评论移回收站 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | TrashEntry、Report / `WALL` | 通知作者并归档该目标举报。 |
| `API-A25 GET /api/admin/trash` | 回收站列表 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | TrashEntry / `WALL` | 类型/搜索/分页/counts。 |
| `API-A26 POST /api/admin/trash/messages/{messageId}/restore` | 恢复留言 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | TrashEntry、Notification / `WALL` | 恢复前态。 |
| `API-A27 DELETE /api/admin/trash/messages/{messageId}` | 永久删留言 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | TrashEntry、MediaAsset / `WALL` | confirm=PURGE。 |
| `API-A28 POST /api/admin/trash/comments/{messageId}/{commentId}/restore` | 恢复评论 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | TrashEntry、Notification / `WALL` | 恢复 visible/hidden。 |
| `API-A29 DELETE /api/admin/trash/comments/{messageId}/{commentId}` | 永久删评论 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | TrashEntry、MediaAsset / `WALL` | confirm=PURGE。 |
| `API-A30 POST /api/admin/trash/bulk` | 批量恢复/永久删 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-CONTENT` | TrashEntry / `WALL` | 1–100 targets、逐项结果。 |
| `API-A31 GET /api/admin/users` | 用户分页筛选 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-USERS` | User / `USERS` | q/status/muted 与分页。 |
| `API-A32 GET /api/admin/users/stats` | 用户统计 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-USERS` | User / `USERS` | total/active/disabled/muted。 |
| `API-A33 POST /api/admin/users/import` | Excel 导入 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-USERS` | User / `USERS` | xlsx、大小、行数和列别名。 |
| `API-A34 PUT /api/admin/users/{userId}` | 编辑用户 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-USERS` | User / `USERS` | 学号不可变。 |
| `API-A35 POST /api/admin/users/{userId}/mute` | 禁言 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-USERS` | User / `USERS` | 未来时间与原因。 |
| `API-A36 POST /api/admin/users/{userId}/unmute` | 解禁 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-USERS` | User / `USERS` | 清截止与原因。 |
| `API-A37 POST /api/admin/users/{userId}/disable` | 停用 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-USERS` | UserSession / `USERS` | 状态 disabled，会话版本增加。 |
| `API-A38 POST /api/admin/users/{userId}/reset_password` | 重置用户密码 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-USERS` | UserSession / `USERS` | 哈希更新、旧会话失效。 |
| `API-A39 GET /api/admin/apps` | 应用管理列表 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | CatalogApp / `APPS` | q 搜索含 hidden。 |
| `API-A40 GET /api/admin/apps/stats` | 应用统计 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | CatalogApp / `APPS` | 三计数。 |
| `API-A41 POST /api/admin/apps` | 新建应用 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | CatalogApp、MediaAsset / `APPS` | multipart 校验。 |
| `API-A42 PUT /api/admin/apps/{appId}` | 编辑应用 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | CatalogApp、MediaAsset / `APPS` | 可替换图标且清旧图标。 |
| `API-A43 POST /api/admin/apps/{appId}/hide` | 下架应用 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | CatalogApp / `APPS` | 公共面即时隐藏。 |
| `API-A44 POST /api/admin/apps/{appId}/restore` | 恢复应用 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | CatalogApp / `APPS` | 公共面按排序恢复。 |
| `API-A45 DELETE /api/admin/apps/{appId}` | 永久删应用 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | CatalogApp、MediaAsset / `APPS` | 记录和图标删除。 |
| `API-A46 GET,POST /api/admin/notice` | 公告列表/发布 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | Notice / `NOTICE` | 长度和空值校验。 |
| `API-A47 PUT,DELETE /api/admin/notice/{noticeId}` | 编辑/撤回公告 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | Notice / `NOTICE` | UUID 与旧索引兼容；未知404。 |
| `API-A48 GET /api/admin/report` | 待处理举报 | `admin.js` | `FE-ADMIN` / `BE-SUPPORT` | Report / `REPORT` | 按 message_id 聚合。 |
| `API-A49 GET /api/admin/reports/history` | 举报历史 | `admin.js` | `FE-ADMIN` / `BE-SUPPORT` | Report / `REPORT` | action/target/q/分页。 |
| `API-A50 POST /api/admin/reports/{messageId}/{reportId}/resolve` | 处置举报 | `admin.js` | `FE-ADMIN` / `BE-SUPPORT` | Report、TrashEntry / `REPORT`，删除需`WALL` | 原子处置与409冲突。 |
| `API-A51 POST /api/admin/api/delete_report/{messageId}/{reportId}` | dismiss 兼容操作 | `admin.js` | `FE-ADMIN` / `BE-SUPPORT` | Report / `REPORT` | 等价 resolve dismiss。 |
| `API-A52 GET /api/admin/feedback` | 工单分页筛选 | `admin.js` | `FE-ADMIN` / `BE-SUPPORT` | FeedbackTicket / `FEEDBACK` | q/status/category/分页/统计。 |
| `API-A53 PUT /api/admin/feedback/{ticketId}` | 更新工单 | `admin.js` | `FE-ADMIN` / `BE-SUPPORT` | FeedbackTicket、History / `FEEDBACK` | 状态、公开回复、内部备注与历史。 |
| `API-A54 GET /api/admin/audit` | 结构化审计 | `admin.js` | `FE-ADMIN` / `BE-AUDIT` | AdminAuditEvent / `ADMINLOG` | q/actor/action/target_type/分页。 |
| `API-A55 GET /api/admin/admin_log` | 兼容管理员日志 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | LegacyAdminLog / `ADMINLOG` | 搜索与上限。 |
| `API-A56 GET /api/admin/log` | 错误日志 | `admin.js` | `FE-ADMIN` / `BE-ADMIN-OPS` | ErrorLog / `ERRORLOG` | 搜索与上限。 |

## 8. 跨模块验收门槛

1. **OpenAPI 一致性**：所有 `frontend/src/services` 替代实现只能调用 `openapi.yaml` 已定义操作；请求、成功响应和错误响应通过 schema 测试。
2. **鉴权矩阵**：每个 `USER/ADMIN/细粒度权限` 接口至少覆盖无 cookie、伪造 cookie、过期 cookie、会话版本过期、缺权限、有效权限。
3. **公开面零泄漏**：以 pending、hidden、deleted 留言及 hidden/deleted 评论建立夹具，断言列表、详情、标签、热门、公开用户页、收藏和互动均不泄漏。
4. **匿名零泄漏**：公共 JSON 快照不得出现匿名作者的 `user_id`、`username`、`real_name`；后台详情必须可追溯。
5. **并发约束**：赞踩切换、投票唯一、收藏幂等、举报处置和软删/恢复使用数据库约束或行锁验证，不以进程内锁作为唯一保证。
6. **媒体生命周期**：上传→发布/评论→软删→恢复→永久删除全链路测试；软删不删附件，永久删除只删无其他引用文件。
7. **审计**：逐类执行一个成功和一个失败管理写操作；成功恰好一条事件，失败零条，事件 actor/target/status 正确。
8. **参考排除项**：路由、导航、OpenAPI 和数据库迁移中均不得出现二手、私信、社团、活动报名、关注/粉丝等排除域。

## 9. 源码无法唯一确定、由本契约固定的细节

1. 参考实现混用 PostgreSQL 时间戳和 `YYYY-MM-DD HH:mm:ss` 文本。本契约统一要求 API 新写数据使用 RFC 3339 UTC；兼容读取可接受旧格式。
2. 参考公共列表使用 `start/end` 窗口，而大多数账号/后台列表使用页码。本契约保留各参考 URL 和参数，同时统一页码响应字段 `page/page_size/total/total_pages`；公共列表额外保留 `start/end` 兼容字段。
3. 参考留言正文和评论嵌在 JSONB 中，部分历史字段可缺失。OpenAPI 固定了前端实际使用字段；数据库实现应关系化，未知历史字段无需对外透传。
4. 参考上传后的图片/视频具体压缩质量取决于 `sharp`、`ffmpeg` 和运行环境，源码没有稳定的像素/码率契约；只验收安全、可访问缩略/预览和失败语义，不锁定编码参数。
5. 参考热门算法是实现细节且按小时刷新；契约只固定可观察排序原则（互动权重、精华优先、非公开排除），不固定精确分数。
6. 参考 `/api/admin/api/get_message/{id}` 在不存在时可能返回 JSON `null` 的 200。目标契约规范化为 404，前端必须同时兼容迁移期的旧响应。
7. 参考登录失败有些操作返回 HTTP 200 + `success:false`。目标契约使用 4xx 统一错误；兼容代理可临时接受旧状态，但不得让生成客户端依赖“错误也是 200”。
