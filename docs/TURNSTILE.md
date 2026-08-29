# Cloudflare Turnstile 接入与运维

本文说明校园墙如何创建、启用、测试、轮换和停用 Cloudflare Turnstile。正式密钥只能进入 Cloudflare、生产数据库或受权限保护的服务器环境文件，不能写入 Git、截图、日志或交接文档。

## 1. 当前保护链路

Turnstile 不是只在页面放一个组件。完整请求链为：

```text
浏览器加载 Cloudflare Widget
  -> Widget 生成一次性 token，并绑定 action
  -> 登录/注册请求把 captcha_token 交给校园墙 API
  -> API 从加密设置读取 Secret Key
  -> API POST Cloudflare Siteverify
  -> 同时校验 success、action 和 hostname
  -> 全部通过后才继续校验用户名和密码
```

当前可分别保护三个入口：

- 师生用户名密码登录：action `login`；
- 用户名密码注册：action `register`；
- 审核员/管理员后台登录：action `admin_login`。

后台“配置自检”使用独立 action `admin_test`。Token 最长 2048 字符，只能验证一次，约 5 分钟后过期；登录失败或 Token 过期时前端会清空并重新生成。飞书 OAuth 登录不使用这个表单 Token，仍由飞书 OAuth state、群成员校验和自身限流保护。

## 2. 在 Cloudflare 创建 Widget

在 Cloudflare Dashboard 打开 **Turnstile**，创建 Managed Widget：

1. 名称建议 `Guanlan Campus Wall authentication`；
2. Widget Mode 选择 `Managed`；
3. Hostname 只添加 `wall.zongtech.xyz`；
4. 不为正式 Widget 添加 `localhost`、Pages 预览域名、IP 或通配符；
5. 保存后分别复制 Site Key 与 Secret Key。Site Key 可以进入浏览器，Secret Key 绝不能进入前端构建。

也可使用已登录的 Wrangler：

```powershell
npx wrangler turnstile widget create "Guanlan Campus Wall authentication" `
  --domain wall.zongtech.xyz `
  --mode managed `
  --clearance-level no_clearance
```

创建、查看和删除 Widget 是 Cloudflare 账号级外部状态。删除前必须先在校园墙后台关闭验证，并确认还有其他可登录的超级管理员会话，避免锁死后台。

Cloudflare 官方文档：

- <https://developers.cloudflare.com/turnstile/get-started/>
- <https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/>
- <https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>

## 3. 在校园墙后台配置

使用具备 `settings.read` 与 `settings.captcha.update` 的账号进入：

```text
管理后台 -> 平台与验证 -> Cloudflare Turnstile 人机验证
```

按顺序操作：

1. 服务商选择 `Cloudflare Turnstile`；
2. 填写 Site Key；
3. 填写 Secret Key；已有密钥留空表示保留，不会回显原值；
4. “允许的前端域名”只填写 `wall.zongtech.xyz`，不含协议和路径；
5. 勾选要保护的师生登录、账号注册、后台登录；
6. 先保持总开关关闭并保存；
7. 在“配置自检”完成 Widget，再点击“测试完整链路”；
8. 测试成功后打开总开关并再次保存；
9. 用无痕窗口分别验证前台登录、注册和后台登录。

设置即时从 PostgreSQL `platform_settings` 读取，保存后不需要重启。数据库设置优先于环境变量；只有不存在 `captcha` 设置记录时，后端才使用 `CAPTCHA_*` 环境变量。

Secret Key 使用由服务端 `SECRET_KEY` 派生的 AES-256-GCM 密钥加密。轮换生产 `SECRET_KEY` 前必须先关闭 Turnstile、备份设置并在轮换后重新填写 Turnstile Secret，否则旧密文无法解开且登录会按失败关闭。

## 4. 环境变量回退

自动化部署或数据库尚未建立设置时可使用：

```env
CAPTCHA_PROVIDER=turnstile
CAPTCHA_ENABLED=true
CAPTCHA_SITE_KEY=<public-site-key>
CAPTCHA_SECRET_KEY=<write-only-secret-key>
CAPTCHA_PROTECT_LOGIN=true
CAPTCHA_PROTECT_REGISTER=true
CAPTCHA_PROTECT_ADMIN_LOGIN=true
CAPTCHA_ALLOWED_HOSTNAMES=wall.zongtech.xyz
CAPTCHA_TIMEOUT_MS=8000
```

环境文件 `/etc/campuswall/backend.env` 必须保持 `root:root 600`。不能把 Secret 放入 `VITE_*`、Cloudflare Pages 构建变量、README 示例或浏览器请求。后台一旦保存过验证码设置，修改环境变量不会覆盖数据库记录。

## 5. 测试密钥与自动化

Cloudflare 提供专用测试 Site Key/Secret Key。它们只允许用于本地或自动化测试，生产后台在启用 Turnstile 时会拒绝官方测试密钥。正式 Widget 不应允许 `localhost`。

后端自动化覆盖：

- Secret 加密、write-only 返回和显式清除；
- 登录/注册/后台登录独立范围；
- Siteverify 请求、IP 与幂等键；
- action/hostname 不匹配；
- 缺失、过长、过期/重复 Token；
- 生产测试密钥拒绝。

运行：

```powershell
npm --prefix backend test
npm --prefix frontend run build
```

## 6. 密钥轮换

1. 保留一个已经登录的超级管理员会话；
2. 在后台关闭人机验证并保存；
3. 在 Cloudflare 轮换 Widget Secret；
4. 回到后台填写新 Secret，Site Key 不变时可保留；
5. 完成“测试完整链路”；
6. 重新启用并保存；
7. 用无痕窗口验证三个已选入口；
8. 记录操作人、时间和 Widget 名称，不记录密钥。

如果 Site Key 也变更，必须同步填写新 Site Key。浏览器配置接口带 `Cache-Control: no-store`，刷新登录页后应立即获取新值。

## 7. 故障与紧急停用

### Widget 不显示

- 浏览器必须能访问 `https://challenges.cloudflare.com`；
- 检查 Site Key 是否属于允许 `wall.zongtech.xyz` 的 Widget；
- 检查内容拦截器、校园网络和浏览器控制台；
- 不要代理、缓存或自行托管 Cloudflare 的 `api.js`。

### 浏览器通过但后端拒绝

- 在后台重新做完整链路测试；
- 核对允许域名是否精确为 `wall.zongtech.xyz`；
- action 不同的 Token 不能跨登录、注册或后台入口复用；
- Token 过期、已使用或提交两次会被 Cloudflare 拒绝；
- 核对服务器时间与出站 HTTPS，不要在日志打印 Token 或上游完整响应。

### Cloudflare 暂时不可用

验证启用时后端按 fail-closed 处理，不能在代码里临时绕过。使用仍有效的超级管理员会话进入后台关闭总开关；若所有会话均失效，才通过 SSH 修改数据库设置或暂时删除 `captcha` 数据库记录以恢复环境变量回退。操作前先备份数据库，恢复后立即审计、修复并重新启用。

### 误清除 Secret

清除后配置会变为未完成且不能启用。Cloudflare Secret 不会从校园墙后台回显；到 Cloudflare 轮换/获取新 Secret，再重新保存并测试。
