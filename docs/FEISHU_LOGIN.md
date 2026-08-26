# 飞书登录接入（校园墙群成员）

> 适用于龙华区观澜中学校园墙。文档更新日期：2026-08-26。
>
> 本文说明**前台飞书 OAuth 登录**。审核提醒用的是**群自定义机器人 Webhook**，见 [NOTIFICATION_INTEGRATION.md](./NOTIFICATION_INTEGRATION.md)。两套凭据不能混用，也不要把 Webhook 填进本文的环境变量。

## 1. 产品规则

- 飞书群成员可立即登录。`GET /api/user/feishu/start` 与 callback 不经过人工审核。
- 用户名密码注册走 `POST /api/user/register`：只创建 `pending` 普通用户，不签发会话；审核员在「用户与权限」通过后才能 `POST /api/user/login`。
- 电脑打开飞书官方授权页后扫码；手机一般会跳转飞书 App。网站**不**展示加群二维码（会过期，也与登录无关）。
- 不要按群**名字**判断。群能改名、能重名。服务端只认环境变量里的 `FEISHU_LOGIN_CHAT_ID`（`oc_...`）。
- 应用机器人必须一直在该群里。机器人退群后，下次登录会失败；已登录会话本轮只在下次登录时拦截。
- 审核员/管理员/超管继续使用 `/admin/login` 的用户名和密码。飞书登录不会授予后台根权限。
- 后台人员只能由超级管理员在「用户与权限」中创建，不能对外自助注册成管理员。

## 2. 飞书开放平台（你方操作）

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，创建**企业自建网页应用**（不要用审核提醒那条自定义机器人 Webhook）。
2. 开通**机器人能力**，并把该应用机器人拉进内部群「观澜中学校园墙」。
3. 在群的机器人会话或开放平台调试工具中取得该群 `chat_id`（形如 `oc_` 开头）。写入服务器环境变量，**不要写入 Git**。
4. 安全设置 → 重定向 URL 只添加：

   `https://api-wall.zongtech.xyz/api/user/feishu/callback`

   本地调试另加本机回调，例如 `http://localhost:5412/api/user/feishu/callback`。不要用 Pages 预览域名。
5. 权限申请至少包括：
   - 获取用户身份 / 用户信息（`authen` 相关，登录后读取姓名与 `open_id`）；
   - 查看群成员或只读群信息（`im:chat:readonly` 或 `im:chat.members:read`），供服务端按 `chat_id` 核对成员；
   - 邀请群成员（`im:chat.members:write` 或同等拉人权限），供已登录用户在主页绑定飞书后自动进群。
6. 发布应用，并把可用范围限制在本校租户。知道授权链接的人仍可能走到 OAuth，**服务端仍必须再校验群成员**。
7. 已登录用户访问 `GET /api/user/feishu/start?intent=bind` 会把当前校园墙账号挂上该飞书 `open_id`（已被其他账号占用则拒绝），再尝试把该用户拉进登录校验群。进群失败时账号仍可能已绑定，页面会提示联系管理员，不能假装已进群。
8. 若 App Secret 曾出现在聊天、截图或工单中：先在飞书后台**轮换 Secret**，再用新值写入服务器，然后发布后端。旧 Secret 视为已泄露。

## 3. 服务器环境变量

只写入 `/etc/campuswall/backend.env`（`root:root 600`）。禁止 Git、`HANDOFF.md` 正文、`VITE_*`、前端代码或截图出现 Secret / `chat_id` 真值。

```env
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_LOGIN_CHAT_ID=
FEISHU_REDIRECT_URI=https://api-wall.zongtech.xyz/api/user/feishu/callback
FEISHU_TIMEOUT_MS=8000
PUBLIC_SITE_URL=https://wall.zongtech.xyz
SESSION_COOKIE_SAMESITE=Lax
SESSION_COOKIE_SECURE=true
```

`SESSION_COOKIE_SAMESITE` 必须是 `Lax` 或 `None`（且 HTTPS）。`Strict` 会让飞书回跳带不上 OAuth 校验 Cookie。`ALLOWED_ORIGINS` 保持 `https://wall.zongtech.xyz`，不要为飞书登录改来源白名单。

修改环境变量后执行 `systemctl restart campuswall.service`。前端按钮只是跳到 API 的 `/api/user/feishu/start`，一般不必因登录开关单独重建 Pages；若登录页文案已随代码更新，仍按正常前端发布。

## 4. 登录流程

1. 浏览器打开 `/login`，主按钮前往 `GET /api/user/feishu/start?next=...`。
2. API 写入 HttpOnly `feishu_oauth` 校验 Cookie，并把带 HMAC `state` 的地址 302 到飞书授权页。
3. 用户扫码或 App 同意后，飞书 GET ` /api/user/feishu/callback`。
4. API 用 `code` 换用户信息，再用 tenant token 确认：**机器人在指定群内**，且该用户 `open_id` 在群成员列表中。
5. 通过则 upsert 普通用户并设置 `user_session`，302 回 `PUBLIC_SITE_URL` 的原目标页；失败则回 `/login?feishu_error=...`，不回传飞书原文。

失败码（只出现在前端查询参数，文案由登录页或主页映射）：`not_in_group`、`disabled`、`oauth_failed`、`invalid_state`、`cancelled`、`not_configured`、`conflict`、`already_bound`、`join_failed`。

## 5. 验收

- 未进群或机器人已退群：不能通过飞书登录获得会话。
- 群内成员：电脑扫码、手机跳转均可进入。
- 失物招领列表公开可浏览；填写、评论和点赞必须已登录（飞书或已审核的用户名密码均可）。
- 旧密码注册的普通账号若状态仍是 `active` 且有密码，可以再次密码登录；新注册必须先过审。已登录用户可在 `/me` 连接飞书账户；绑定后会尝试拉进登录校验群，进群失败时提示 `join_failed`，不会假装成功。
- `POST /api/admin/login` 对审核员/管理员/超管仍可用。
- 超级管理员可在「用户与权限」创建带密码的 `reviewer|admin|super_admin`；不能在此创建普通学生号。
- 自动化测试使用 mock HTTP，不打真实飞书网。
