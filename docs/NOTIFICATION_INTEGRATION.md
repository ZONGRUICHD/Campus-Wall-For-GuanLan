# 审核提醒系统接入手册

> 适用于龙华区观澜中学校园墙。文档更新日期：2026-08-26。

## 1. 先看结论

| 渠道 | 官方方案 | 普通群提醒 | 本项目状态 |
| --- | --- | --- | --- |
| 飞书 | 自定义群机器人 Webhook | 支持 | **已可用，推荐主通道** |
| 企业微信 | 群机器人/消息推送 Webhook | 支持 | **已可用，推荐备用通道** |
| QQ | QQ 开放平台官方机器人 | 需机器人审核、群授权和 `GROUP_OPENID` | 架构预留，**尚未上线** |
| 微信 | iLink 私聊、公众号模板消息、小程序订阅消息 | 不支持通用普通微信群 Webhook | 架构预留，**尚未上线** |

不得在生产环境使用 PC Hook、网页自动化、协议逆向、NapCat、itchat 或非官方 WeChaty 来发送关键审核提醒。这类方案可能失效、封号，也会扩大学生数据的隐私风险。

## 2. 当前系统怎样工作

待审内容与提醒任务优先在同一 PostgreSQL 事务中写入 Outbox；为保证第三方提醒故障绝不阻断发帖，入队失败会回滚到保存点并由后台补偿扫描按硬批次上限补齐，因此存在一个短暂的“内容已保存、提醒任务尚待补偿”窗口。网络发送由后台 worker 异步执行。系统已具备：

- 超时与不跟随重定向；
- 业务错误码识别、`Retry-After`、指数退避与最大重试次数；
- 过期锁恢复、启动补偿和优雅关机；
- 按审核版本去重；
- 死信状态和保留期；重启不会自动复活死信，修复原因后必须由受审计的显式操作重试。

外部机器人只会显示内容编号、提交时间、固定内容类别、审核板块、附件/投票提示、当前待审数量及审核页链接。审核版本和官方标记仅保留在内部 Outbox/载荷，不展示到群消息。**不发送正文、账号、姓名、联系方式或附件 URL**。

## 3. 通用生产配置

在服务器后端环境文件或 systemd `EnvironmentFile` 中配置：

```dotenv
PUBLIC_SITE_URL=https://wall.zongtech.xyz
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

要点：

1. 不要在文档、Git、`VITE_*`、前端代码、截图或工单中填写真实 Webhook/Secret。
2. 修改环境变量后重启后端服务，不需要重新构建 Cloudflare Pages 前端。
3. `PUBLIC_SITE_URL` 必须是 HTTPS，否则提醒中不会生成审核深链。
4. 生产服务器需要正确的 NTP 时间，否则飞书签名时间窗会失败。
5. 更换密钥时先创建新通道、做固定测试消息、再撤销旧通道；不要把真实待审内容当测试。

## 4. 飞书接入（已支持）

官方参考：[飞书自定义机器人使用指南](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)

### 4.1 创建

1. 进入审核员专用飞书群。
2. 在群设置中添加“自定义机器人”。
3. 设置清晰的机器人名称，例如“观澜校园墙审核提醒”。
4. 复制群专属 Webhook。
5. 启用“签名校验”并保存 Secret。建议再开启服务器出口 IP 白名单。
6. 将 Webhook 和 Secret 分别写入上述两个后端环境变量。

项目只接受 `https://open.feishu.cn/open-apis/bot/v2/hook/...` 或官方 Lark 域名，拒绝 HTTP、自定义端口、用户名/密码、URL fragment 和不符合格式的路径。

### 4.2 安全与限流

- Webhook 本身就是凭据，Secret 不能代替 Webhook 的保密。
- 优先使用“签名 + IP 白名单”，关键词只做额外约束。
- 本项目以 30 秒最小发送间隔为默认，并会合并待审数量。不要为了“更快”而关闭冷却。
- 常见失败原因：Webhook 已重建、签名错误、时间偏差、出口 IP 不在白名单、未命中关键词、请求体格式错误。

自定义群机器人是单向提醒。若需要按钮回调、读取消息或在飞书内直接审核，应另建飞书企业自建应用，并做权限审批、事件签名与加密验证。

## 5. 企业微信接入（已支持）

官方参考：[企业微信消息推送配置说明](https://developer.work.weixin.qq.com/document/path/91770)

### 5.1 创建

1. 进入审核员专用企业微信群。
2. 添加群机器人/消息推送。
3. 复制 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...` 完整地址。
4. 写入 `MODERATION_NOTIFY_WECOM_WEBHOOK`，重启后端。

当前实现发送官方 `markdown_v2`。标准群机器人没有独立 HMAC Secret，URL 里的 `key` 就是 bearer secret。

### 5.2 安全与故障处理

- 严格固定 `qyapi.weixin.qq.com/cgi-bin/webhook/send` 域名与路径，不跟随重定向。
- 关闭 Nginx/APM 对该出站 URL 查询串的日志。
- 如果 Webhook 泄漏，不要只改文档：立即在群内删除旧机器人、新建机器人并替换服务器环境变量。
- 企业微信返回 HTTP 200 不一定代表业务成功；项目会同时检查响应业务码。HTTP `Retry-After` 的秒数和标准日期格式都会被解析，并设置 24 小时安全上限。
- 若需要按企业成员 UserID 私发或接收回调，改用企业微信自建应用，需 CorpID、AgentID、Secret、Token 和 EncodingAESKey。

## 6. QQ 官方机器人（待实现）

官方资源：[QQ 开放平台](https://q.qq.com/qqbot/openclaw/)、[腾讯官方 BotPy SDK](https://github.com/tencent-connect/botpy)

### 6.1 前置条件

1. 在 QQ 开放平台创建官方机器人。
2. 完成机器人资质/功能审核，取得 AppID 和 AppSecret。
3. 由目标群的群主/管理员授权机器人入群及主动发言。
4. 通过官方事件获取该机器人下的 `GROUP_OPENID`。OpenID 按机器人隔离，不得跨 AppID 复用。
5. 先在沙箱群验收，保留飞书/企业微信作为官方审核完成前和风控期间的兜底。

### 6.2 未来适配器所需凭据

```text
QQ_BOT_APP_ID
QQ_BOT_APP_SECRET          # 只存 Secret Store
QQ_BOT_GROUP_OPEN_ID
QQ_BOT_CALLBACK_SECRET/PUBLIC_KEY
```

发送器要缓存官方 access token，在 401 时仅强制刷新并重试一次；429 必须尊重 `Retry-After`。主动消息配额与时效以机器人控制台当前规则为准，不在代码中固化可能过时的数字。

若使用 HTTPS Webhook 接收事件：

- 回调路由必须在全局 `express.json()` 之前使用 `express.raw()`，或在 parser `verify` 中保留原始 bytes；
- 按官方规范验证 Ed25519 签名和地址校验；
- 用事件 ID 去重，签名验证前不得处理业务；
- 不把平台原始响应和凭据返回管理前端。

## 7. 微信官方方案（待实现）

### 7.1 iLink / OpenClaw 微信私聊

官方实现：[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)

流程：安装官方插件 → 终端出现二维码 → 管理员用微信人工扫码确认 → 插件保存登录凭据 → 长轮询 `getupdates` 并使用 `sendmessage` 回复已建立上下文的用户。

当前官方插件明确是 DM/私聊上下文，**不应宣称可发往普通微信群**。建议做独立 localhost sidecar：主后端只向 sidecar 提交隐私安全事件，sidecar 保管 bot token、cursor、`to_user_id` 和 `context_token`。

必须同时检查 HTTP 状态和 JSON `ret`；`ret != 0` 就是失败。会话超时或 token 失效时停止无限重试，要求管理员重新建立会话/扫码。

### 7.2 公众号/小程序个人订阅

官方参考：[公众号接入概述](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Access_Overview.html)、[公众号模板消息](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Template_Message_Interface.html)、[小程序订阅消息](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html)

需要 AppID、AppSecret、已关注/授权用户的 OpenID、审核通过的模板 ID 及合规的服务场景。小程序订阅通常需要用户明确授权，不能默认把全校用户加入提醒。必须提供绑定、解绑、同意记录和删除流程。这两类消息都面向个人订阅者，不是普通微信群提醒。

## 8. 未来的统一通道架构

当前的飞书/企业微信可继续使用。加入 QQ/微信前，应先抽出以下静态适配器：

```text
backend/src/services/notifications/
  providerRegistry.js
  targetStore.js
  dispatcher.js
  privacyPayload.js
  providers/
    feishuWebhook.js
    wecomWebhook.js
    qqOfficialBot.js
    weixinIlink.js
    wechatOfficialAccount.js
```

每个 provider 统一实现：

```js
{
  id: 'feishu',
  capabilities: { destination: 'group', inbound: false, interactive: false },
  validateConfig(config) {},
  validateTarget(target) {},
  buildMessage(context) {},
  deliver({ target, message, signal }) {},
  classifyResponse({ response, body }) {},
  minIntervalMs: 30000,
  redactError(error) {}
}
```

严禁使用“不是飞书就按企业微信处理”的默认分支。未知 provider 必须 fail closed。幂等键必须包含 `targetId`：

```text
message:{messageId}:pending:{revision}:{targetId}
```

配置与投递管理 API 建议：

```http
GET    /api/admin/v1/notification-targets
POST   /api/admin/v1/notification-targets
PATCH  /api/admin/v1/notification-targets/:id
DELETE /api/admin/v1/notification-targets/:id
GET    /api/admin/v1/notification-deliveries
POST   /api/admin/v1/notification-deliveries/:id/retry
POST   /api/admin/v1/notification-targets/:id/test
```

测试接口只允许超级管理员或拥有专项细权限的账号，强制限流、写审计，并只发送固定示例；返回投递任务 ID，不返回密钥或平台原始响应。

## 9. 运维检查与故障处理

当群里收不到提醒时：

1. 确认内容实际处于“待审”；审核员/管理员自己发帖会免审，不会生成提醒。
2. 确认 `MODERATION_NOTIFY_ENABLED=true` 且至少一个 Webhook 通过格式校验。
3. 查看后端 systemd 状态与脱敏日志；不要打印完整 URL。
4. 查看 `moderation_notification_outbox` 中的 `status/attempts/next_attempt_at/last_error`。
5. 用服务器检查 DNS、TLS、出口防火墙和 NTP；不用真实 Webhook 在共享终端命令中测试。
6. 若任务死信，先修复凭据/限流/网络原因，再做一次人工重试。不要通过关闭审核规则来“修复”提醒。

当前版本没有面向网页的死信重试按钮。值班人员确认故障已经修复后，应先在变更记录中登记任务编号和原因，再以数据库运维账号只重试明确的单条任务；不要批量复活所有死信：

```sql
\set job_id 123456
BEGIN;
SELECT id, provider, message_id, attempts, last_error
FROM moderation_notification_outbox
WHERE id = :job_id AND status = 'dead'
FOR UPDATE;

UPDATE moderation_notification_outbox
SET status = 'pending', attempts = 0, locked_at = NULL,
    next_attempt_at = now(), last_error = 'manual retry after verified repair'
WHERE id = :job_id AND status = 'dead';
COMMIT;
```

第一行的 `123456` 必须由当班人员显式替换为单个数字任务 ID；先保留查询结果和变更单编号，不要把数据库连接串、正文载荷或 Webhook 写进记录。未来实现文档第 8 节的管理 API 后，应迁移为应用内权限校验与审计，届时停止直接 SQL 操作。

健康指标建议：待投递数、最旧待投递年龄、送达率、P95 送达时间、重试数、死信数，以及各 provider 的最后成功时间。

## 10. 上线验收清单

- [ ] 真实凭据仅存后端 Secret Store/环境文件，Git 中为空。
- [ ] 服务器时间同步，`PUBLIC_SITE_URL` 是正确 HTTPS 域名。
- [ ] 一条固定脱敏测试消息能到达，审核深链要求登录。
- [ ] 审核员、管理员、超级管理员自发内容免审且不误报。
- [ ] 普通动态与表白墙待审均可通知，但外部消息不含正文/身份/联系方式。
- [ ] 人为暂停网络后任务重试，恢复后送达，发帖本身不被阻断。
- [ ] Webhook 已重建或凭据失效时不会无限刷屏。
- [ ] 日志、审计和错误页中没有 Webhook、Secret、token 或 OpenID。
