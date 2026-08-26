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

推荐由超级管理员登录网站，进入 **管理后台 → 消息提醒** 完成配置。飞书和企业微信各自提供启用开关、write-only Webhook/签名密钥输入、清除配置与“发送测试”按钮；保存后后端会等待在途投递完成、原子切换目标并立即恢复 worker，不需要重启服务。页面与 API 永远不会回显完整 Webhook、Secret 或数据库密文。

后台凭据使用 AES-256-GCM 加密。生产环境必须在服务器后端环境文件或 systemd `EnvironmentFile` 中单独设置一个长期稳定的主密钥：

```dotenv
NOTIFICATION_MASTER_KEY=<使用密码管理器生成的长随机值>
```

该值不能放入 Git、截图或前端 `VITE_*`。轮换前必须先停用渠道并重新录入全部凭据；直接替换会使旧密文无法解密并按未配置状态 fail closed。未设置时仅为兼容本地开发而回退使用 `SECRET_KEY`。

以下环境变量保留为旧部署/应急回退方式；对应 provider 尚无数据库记录时才会读取：

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
2. 后台保存会即时生效；只有修改环境变量时才需要重启后端，不需要重新构建 Cloudflare Pages 前端。
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
6. 在“管理后台 → 消息提醒 → 飞书自定义群机器人”粘贴 Webhook 和 Secret，先保存，再发送固定测试消息，确认成功后启用。环境变量只作为旧部署回退。

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
4. 在“管理后台 → 消息提醒 → 企业微信群机器人”粘贴完整地址，先保存，再发送固定测试消息，确认成功后启用。环境变量只作为旧部署回退。

当前实现发送官方 `markdown_v2`。标准群机器人没有独立 HMAC Secret，URL 里的 `key` 就是 bearer secret。

### 5.2 安全与故障处理

- 严格固定 `qyapi.weixin.qq.com/cgi-bin/webhook/send` 域名与路径，不跟随重定向。
- 关闭 Nginx/APM 对该出站 URL 查询串的日志。
- 如果 Webhook 泄漏，不要只改文档：立即在群内删除旧机器人、新建机器人并替换服务器环境变量。
- 企业微信返回 HTTP 200 不一定代表业务成功；项目会同时检查响应业务码。HTTP `Retry-After` 的秒数和标准日期格式都会被解析，并设置 24 小时安全上限。
- 若需要按企业成员 UserID 私发或接收回调，改用企业微信自建应用，需 CorpID、AgentID、Secret、Token 和 EncodingAESKey。

## 6. QQ 官方机器人（待实现）

官方资源：[QQ 开放平台](https://q.qq.com/qqbot/openclaw/)、[AccessToken 获取](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html)、[API 调用说明](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html)、[腾讯官方 BotPy SDK](https://github.com/tencent-connect/botpy)

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

当前官方鉴权流程是向 `POST https://api.bot.qq.com/app/getAppAccessToken` 提交 `appId/clientSecret`，缓存返回的 `access_token/expires_in`，再用 `Authorization: QQBot <ACCESS_TOKEN>` 调用 OpenAPI。旧 Token 鉴权和旧 `api.sgroup.qq.com` 域名不能用于新实现。发送群消息使用 `POST /v2/groups/{group_openid}/messages`，私聊使用 `POST /v2/users/{user_openid}/messages`；最小纯文本请求为 `{"msg_type":0,"content":"..."}`。OpenID 由机器人事件获得并按 AppID 隔离，不能用 QQ 号代替。发送器在 401 时只允许强制刷新并重试一次；429 尊重 `Retry-After`，其他限额以控制台实时规则为准。官方端点：[群消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)、[单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html)。

不能只用 HTTP 2xx 判断送达。适配器需要解析官方错误结构、记录脱敏 `trace_id/provider_message_id`，把授权、关系不存在和拒收等错误归为永久失败，把超时、429、5xx 和官方繁忙码归为可重试。主动消息会受到机器人认证状态、用户拒收、单关系及账号级频控影响，数字不得硬编码到业务逻辑。

若使用 HTTPS Webhook 接收事件：

- 回调路由必须在全局 `express.json()` 之前使用 `express.raw()`，或在 parser `verify` 中保留原始 bytes；
- 只开放 HTTPS 回调；按官方规范用 `X-Signature-Ed25519`、`X-Signature-Timestamp`、原始请求体和 Bot Secret 验证 Ed25519 签名及地址校验；
- 用事件 ID 去重，签名验证前不得处理业务；
- 不把平台原始响应和凭据返回管理前端。

官方回调说明：[Webhook 事件](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html)、[签名校验](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html)。没有真实机器人凭据时，无法验证机器人审核/沙箱状态、目标 OpenID、接口权限、IP 白名单、用户拒收、平台风控和实际配额；这些必须在接入维护窗口用测试群验收，不能由单元测试推断成功。

## 7. 微信官方方案（待实现）

### 7.1 iLink / OpenClaw 微信私聊

官方实现：[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)

推荐直接使用腾讯官方插件，不自行实现私有协议：安装 `@tencent-weixin/openclaw-weixin`，管理员扫码确认后由插件保存 `bot_token`，长轮询 `getupdates`，再用 `sendmessage` 回复已经建立上下文的用户。当前官方 manifest 要求 Node.js 22 或以上和兼容版本 OpenClaw；部署时以仓库 `package.json` 的最低版本为准，不只看 README 的版本表。

当前官方插件只声明 DM/私聊能力，**不应宣称可发往普通微信群，也不能保证长期静默主动推送**。建议做独立 localhost sidecar：主后端只向 sidecar 提交隐私安全事件，sidecar 保管 bot token、cursor、`to_user_id` 和 `context_token`；回复时必须原样带回当前入站消息的 `context_token`。最小实现只发纯文本，媒体上传与加密另行验收。

必须同时检查 HTTP 状态和 JSON `ret`；`ret != 0` 就是失败。会话超时或 token 失效时停止无限重试，要求管理员重新建立会话/扫码。官方没有公开保证 `context_token` 的寿命或长期主动推送额度，因此 iLink 只能作为已建立私聊会话的辅助渠道，不能替代飞书/企微主提醒。

### 7.2 公众号/小程序个人订阅

官方参考：[公众号接入概述](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Access_Overview.html)、[公众号模板消息](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Template_Message_Interface.html)、[稳定版 access token](https://developers.weixin.qq.com/doc/service/api/base/api_getstableaccesstoken)、[小程序订阅消息](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html)、[新版一次性订阅](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-2.html)

公众号模板消息当前只适用于已认证服务号和合规的重要服务通知，不能用于广告、营销或骚扰。需要 AppID、AppSecret、属于该服务号且已关注用户的 OpenID、审核通过的模板 ID 和准确字段；优先使用 `stable_token` 并按 `expires_in` 缓存，发送到 `/cgi-bin/message/template/send`。HTTP/业务码成功只代表平台受理，最终结果要根据 `TEMPLATESENDJOBFINISH` 回调记录 `success`、用户拒收或系统失败，回调同样要做签名、重放与幂等防护。

小程序订阅必须由用户明确点击或支付行为触发授权，前端保存每个模板的 `accept/reject/ban/filter` 结果，服务端再通过 `/cgi-bin/message/subscribe/send` 发送。一次性和长期模板不可混用，不能默认把全校用户加入提醒。2026 年新版一次性订阅卡片不是旧 `requestSubscribeMessage + subscribe/send` 链路，必须根据模板类型改走官方 `setUserNotify` 流程；接入时应把模板类型固化为受控枚举，不能由前端任意指定端点。

两类微信订阅都面向个人，不是普通微信群提醒。系统必须提供账号绑定、解绑、同意来源、授权时间/次数、撤回和删除流程；OpenID、模板资格、IP 白名单、用户真实授权、实际额度和最终送达只能在真实认证账号与真机上验收，开发者工具或无凭据单元测试不能证明可用。

## 8. 统一通道架构（基础已落地）

当前发送层已经拆成显式 provider registry，只注册真实可用的飞书与企业微信；QQ、微信仍未注册，因此不会被误判成企业微信或产生“假成功”。代码位置：

```text
backend/src/services/notifications/
  providerRegistry.js
  messageTemplate.js
  providers/
    feishuWebhook.js
    wecomWebhook.js

backend/src/services/moderationNotifier.js  # outbox 调度、领取、重试与回执
```

当前 provider 契约为：

```js
{
  id: 'feishu',
  label: '飞书自定义群机器人',
  capabilities: { destination: 'group', inbound: false, supportsCallbacks: false },
  minIntervalMs: 650,
  readConfig(config) {},
  validateTarget(target) {},
  buildMessage({ target, payload, pendingCount, batchCount, reviewUrl }) {},
  classifyResponse({ body }) {}
}
```

公共 dispatcher 统一负责超时、禁止重定向、`Retry-After`、重试与脱敏；各 provider 只拥有自己的配置读取、目标校验、消息构造、业务响应分类和平台最小间隔。注册表在模块加载时校验 ID 唯一性、静态描述和四个必需方法，重复或残缺适配器会 fail fast；`notificationProviderManifest()` 只返回静态能力元数据，不包含 Webhook、Secret 或环境变量值。提醒启用时，启动巡检把数据库内未注册 provider 的 pending/sending 任务隔离为 dead，dispatcher 也会在任何网络请求前 fail closed。

这份 v1 契约只覆盖当前“固定 URL + 无额外 Authorization 的 JSON Webhook”。QQ、公众号、小程序和 iLink 具有 access token、动态目标、回调或 sidecar 语义，接入时必须先把契约版本化为 `buildRequest/deliver`（注入 `signal/http/secrets/idempotencyKey` 并返回显式 `delivered/retry/permanent` 结果），不能只新增一个 provider 文件后复用固定 Webhook POST。

当前 outbox 仍以 provider 作为单一目标，同一 provider 暂只支持一个群。接入 QQ、微信或同平台多群前，必须先新增稳定 `target_id`、回填旧记录，并把幂等键升级为包含目标：

```text
message:{messageId}:pending:{revision}:{targetId}
```

届时再按官方路线新增 `qqOfficialBot.js`、`weixinIlink.js` 或 `wechatOfficialAccount.js`，不能提前注册没有凭据、审核资格和离线测试的空适配器。

已上线的管理 API：

```http
GET    /api/admin/settings/notifications
PUT    /api/admin/settings/notifications/:provider
DELETE /api/admin/settings/notifications/:provider
POST   /api/admin/settings/notifications/:provider/test
```

权限分别是 `settings.notifications.read`、`settings.notifications.update` 和 `settings.notifications.test`。超级管理员默认具备全部权限；普通管理员默认只读，修改/测试需要超级管理员显式授权。测试接口只使用已保存配置，接受 provider 路径参数但不接受自定义 URL、Secret 或消息正文；它强制按管理员、IP 与 provider 限流，成功和失败均写脱敏审计，只返回成功时间或泛化错误。

配置按 provider 分别存入 PostgreSQL `platform_settings`，数据库记录存在后对该 provider 具有权威性；显式清除不会意外回退并重新启用旧环境变量。当前每个 provider 仍只支持一个群目标。投递历史列表与死信重试 UI 尚未开放，继续按第 9 节受控运维流程处理。相关回归位于 `backend/test/notificationProviderRegistry.test.js`、`notificationSettingsStore.test.js` 与 `notificationRuntimeConfig.test.js`。

## 9. 运维检查与故障处理

当群里收不到提醒时：

1. 确认内容实际处于“待审”；审核员/管理员自己发帖会免审，不会生成提醒。
2. 在“管理后台 → 消息提醒”确认至少一个渠道显示“发送中”，并先使用固定测试消息；旧环境变量部署则确认 `MODERATION_NOTIFY_ENABLED=true`。
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
