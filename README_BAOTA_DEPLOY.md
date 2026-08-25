# 宝塔面板部署教程

本文档说明如何在宝塔面板上部署本项目。当前项目结构是：

- 前端：React + Vite，构建后输出到 `frontend/dist`
- 后端：Node.js + Express，默认监听 `5412`
- 数据库：PostgreSQL 18
- 静态运行文件：上传文件、缩略图、头像、应用图标都在 `backend/static`

推荐生产部署方式：

- Nginx 直接托管 `frontend/dist`
- Nginx 将 `/api`、后端静态资源和 `/health` 反向代理到 `127.0.0.1:5412`
- Node 后端用宝塔 Node 项目管理器、PM2 或 Supervisor 常驻
- PostgreSQL 18 使用系统直接安装的 PostgreSQL 服务；`compose.yml` 仅用于本地开发

## 一、服务器准备

建议配置：

- 系统：Debian / Ubuntu / CentOS / AlmaLinux 均可
- 内存：至少 2GB，文件上传和图片处理较多时建议 4GB+
- Node.js：20 或更高
- Nginx：宝塔网站服务
- PostgreSQL 18：系统直接安装并常驻运行
- ffmpeg：用于视频转换和预览

宝塔面板中安装：

1. 软件商店安装 `Nginx`
2. 软件商店安装 `Node.js 版本管理器`，安装 Node.js 20 或 22 LTS
3. 安装 PostgreSQL 18，优先使用系统包或 PostgreSQL 官方仓库
4. 可选安装 `PM2 管理器`，也可以用宝塔的 Node 项目管理器

SSH 中确认版本：

```bash
node -v
npm -v
psql --version
pg_isready --version
ffmpeg -version
```

不建议生产环境使用 Node 26 这类非 LTS 版本。`sharp` 等原生依赖在 LTS 版本上更稳。

如果没有 `ffmpeg`，可用系统包安装，例如：

```bash
# Debian / Ubuntu
apt update
apt install -y ffmpeg

# CentOS / AlmaLinux 视系统源而定
yum install -y ffmpeg
```

## 二、上传项目代码

推荐目录：

```bash
/www/wwwroot/campusWall
```

方式一：用 Git 拉取：

```bash
cd /www/wwwroot
git clone <你的仓库地址> campusWall
cd campusWall
```

方式二：用宝塔文件管理上传压缩包，解压到：

```bash
/www/wwwroot/campusWall
```

确认根目录下能看到：

```text
backend/
frontend/
package.json
package-lock.json
```

安装依赖：

```bash
cd /www/wwwroot/campusWall
npm install
```

生产环境不要用 `npm run dev`，它只适合本地开发。

## 三、启动 PostgreSQL 18

生产环境使用系统直接安装的 PostgreSQL 18，不使用 Docker PostgreSQL。仓库里的 `compose.yml` 只用于本地开发。

先确认 PostgreSQL 服务正常：

```bash
systemctl status postgresql
sudo -u postgres psql -c "SELECT version();"
```

有些发行版或安装方式的服务名可能是 `postgresql-18`，如果 `postgresql` 查不到，就用实际服务名替换后续命令。

如果服务器环境不支持 `sudo -u postgres`，可以切换到 `postgres` 用户后执行：

```bash
su - postgres
psql
```

创建数据库和运行用户。请把密码改成强密码：

```bash
sudo -u postgres psql
```

```sql
CREATE USER campus_wall WITH PASSWORD '改成强密码';
CREATE DATABASE campus_wall OWNER campus_wall;
GRANT ALL PRIVILEGES ON DATABASE campus_wall TO campus_wall;
\q
```

如果 PostgreSQL 不在默认 `5432` 端口，后面的数据库连接配置也要同步改端口。生产环境如果数据库和后端在同一台服务器，建议 PostgreSQL 只监听本机 `localhost`，不要把数据库端口开放到公网。

测试连接：

```bash
psql -h 127.0.0.1 -p 5432 -U campus_wall -d campus_wall -c "SELECT 1;"
```

如果连接被 `pg_hba.conf` 拒绝，请允许本机连接，例如：

```text
host    campus_wall    campus_wall    127.0.0.1/32    scram-sha-256
```

修改后重载 PostgreSQL：

```bash
systemctl reload postgresql
```

如果你有旧 SQLite 数据，需要导入到 PostgreSQL，只运行一次：

```bash
cd /www/wwwroot/campusWall
npm run db:migrate
```

迁移脚本会读取 `backend/static/messages/messages.db`，不会删除原来的 SQLite 文件。

## 四、配置后端环境变量

复制环境变量示例：

```bash
cd /www/wwwroot/campusWall
cp backend/.env.example backend/.env
```

编辑 `backend/.env`。这个项目支持两种 PostgreSQL 配置方式：

- 推荐方式：`DATABASE_URL` 留空，填写下面的 `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD`
- 备用方式：直接填写完整 `DATABASE_URL`，此时后端会优先使用它

按你截图里的 `.env` 结构，生产环境重点改成这样：

```env
APP_NAME=校园墙 API
DEBUG=false

SECRET_KEY=改成一串足够长的随机密钥

HOST=127.0.0.1
PORT=5412

DATABASE_URL=
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=campus_wall
PGUSER=campus_wall
PGPASSWORD=你的数据库密码
PGSSL=false

ALLOWED_ORIGINS=https://wall.example.com
SESSION_COOKIE_SAMESITE=Lax
SESSION_COOKIE_SECURE=true
PUBLIC_SITE_URL=https://wall.example.com

# 审核群机器人（可先保持 false，创建群机器人后再启用）
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

CAPTCHA_PROVIDER=none
CAPTCHA_ENABLED=false
CAPTCHA_SITE_KEY=
CAPTCHA_SECRET_KEY=
CAPTCHA_TIMEOUT_MS=8000

# 社区功能与防刷限制
MAX_POLL_OPTIONS=6
MAX_POLL_DURATION_DAYS=30
RATE_LIMIT_LOGIN=30
RATE_LIMIT_WRITE=40
RATE_LIMIT_INTERACTION=240
RATE_LIMIT_UPLOAD=600
RATE_LIMIT_FEEDBACK=20
```

生成随机密钥可以用：

```bash
openssl rand -hex 32
```

注意：

- 使用 HTTPS 时，`SESSION_COOKIE_SECURE=true`
- 只用 HTTP 测试时，临时设为 `SESSION_COOKIE_SECURE=false`
- `DATABASE_URL` 留空时，一定要把 `PGPASSWORD=campus_wall_dev` 改成你真实创建数据库用户时设置的密码
- 宝塔/Nginx 只反代到本机 `127.0.0.1:5412`；接口限流会读取代理后的访问地址，修改限额后需要重启 Node 项目
- `ALLOWED_ORIGINS` 必须包含你的实际访问域名，本文使用 `https://wall.example.com` 作为示例
- 如果以后前端和后端分开域名部署，也要把前端域名加入 `ALLOWED_ORIGINS`
- `PUBLIC_SITE_URL` 用于生成机器人里的审核后台深链，应填写用户实际访问的网站根地址
- 飞书或企业微信群机器人 Webhook 属于密钥，只写入服务器环境变量，不提交到仓库；配置完成后再把 `MODERATION_NOTIFY_ENABLED` 改为 `true` 并重启后端
- `PUBLIC_SITE_URL` 只有使用 HTTPS 才会出现在群机器人按钮中；HTTP 生产站仍会发送提醒，但省略后台登录链接
- 同一机器人默认每 30 秒最多发送一条摘要；首次启用时，历史待审积压只发送一条汇总提醒

systemd 环境文件包含数据库密码与机器人密钥，应限制为 root 读取：

```bash
chown root:root /etc/campuswall/backend.env
chmod 600 /etc/campuswall/backend.env
```

管理员账号状态、权限和密码哈希保存在：

```text
backend/managers.json
```

公共源码仓库不会包含这个文件，也不会包含数据库、反馈/举报、日志、头像或上传文件。全新部署需要先执行下方恢复命令创建第一个管理员；迁移已有站点时，请从加密备份单独恢复运行数据，不能从 Git 仓库恢复。

后端首次启动时会把旧格式中的明文密码自动迁移为 scrypt 哈希。上线后登录 `/admin/managers` 修改当前管理员密码，不要手工把明文密码写回 JSON。

如果忘记密码或管理员账号全部被停用，在项目根目录执行：

```bash
cd /www/wwwroot/campusWall
npm run admin:reset-password -- admin
```

命令会在终端中交互式读取新密码；它可以重置并启用已有账号，也可以在账号不存在时创建具备完整权限的恢复管理员。执行后旧管理员会话立即失效。

## 五、构建前端

如果前后端同域部署，前端不需要单独设置 API 地址，保持默认即可。

构建：

```bash
cd /www/wwwroot/campusWall
npm run build
```

构建成功后会生成：

```text
frontend/dist/
```

宝塔网站根目录后面要指向这个目录。

## 六、启动 Node 后端

后端入口：

```text
backend/src/server.js
```

### 方案 A：用 PM2

如果宝塔安装了 PM2 管理器，或服务器有 PM2：

```bash
npm install -g pm2
cd /www/wwwroot/campusWall/backend
pm2 start src/server.js --name campus-wall-api --time
pm2 save
```

检查：

```bash
pm2 status
pm2 logs campus-wall-api
curl http://127.0.0.1:5412/health
```

看到下面结果说明后端正常：

```json
{"status":"ok"}
```

### 方案 B：用宝塔 Node 项目管理器

在宝塔中添加 Node 项目：

- 项目目录：`/www/wwwroot/campusWall`
- 项目名称：例如 `campuswall`
- 启动选项：选择“自定义启动命令”
- 自定义启动命令：`node backend/src/server.js`
- Node 版本：建议选择 Node 20 或 22 的 LTS 版本，至少要 20+
- 包管理器：选择 `npm`，不要选 `pnpm`
- 项目端口：`5412`
- 环境变量文件：后端会固定读取 `backend/.env`
- 安装依赖：如果你已经在服务器执行过 `npm install`，可以勾选“不安装 node_module”；否则不要勾选，让宝塔安装依赖

如果你的实际目录是截图里的 `/www/wwwroot/campusWall-react-new`，上面的项目目录就填这个实际路径，后续 Nginx 根目录也同样替换。

不要直接选择宝塔下拉里的 `start:backend:npm --workspace backend start`。部分宝塔版本会把它错误当成命令 `start:backend:npm` 执行，然后报：

```text
nohup: failed to run command 'start:backend:npm': No such file or directory
```

遇到这个错误，就把启动选项改成“自定义启动命令”，填 `node backend/src/server.js`。

不要选择这些启动项：

- `dev`：这是本地开发用，会同时启动后端和 Vite 前端
- `dev:local`：这是本地开发用，会尝试启动 Docker PostgreSQL
- `dev:backend`：这是开发模式，会用 nodemon
- `dev:frontend`：这是前端开发服务器，生产环境不需要
- `db:up`、`db:down`、`db:wait`、`db:migrate`：这些不是后端常驻服务

如果你想把项目目录填成后端目录，也可以这样配置：

- 项目目录：`/www/wwwroot/campusWall/backend`
- 启动选项：选择“自定义启动命令”
- 自定义启动命令：`node src/server.js`

启动后检查：

```bash
curl http://127.0.0.1:5412/health
```

## 七、创建宝塔网站

宝塔面板进入：

```text
网站 -> 添加站点
```

填写：

- 域名：`wall.example.com`（替换为你的实际域名）
- 根目录：`/www/wwwroot/campusWall/frontend/dist`
- PHP：纯静态，不需要 PHP
- 数据库：不在宝塔网站里创建；使用系统 PostgreSQL 中已经创建好的 `campus_wall` 数据库

然后给站点申请 SSL：

```text
网站 -> SSL -> Let's Encrypt
```

开启强制 HTTPS。

如果域名使用 Cloudflare 代理，并且 Cloudflare SSL/TLS 模式是 `Full` 或 `Full (strict)`，宝塔里必须给同一个站点 `wall.example.com` 配好 443/SSL。只配置 80 会导致 Cloudflare 访问源站 443 时命中宝塔默认站点，表现为首页变成“站点创建成功”或 `/health`、`/api/...` 返回 Nginx 404。

可以在本地或服务器上这样确认源站 443 是否命中正确站点：

```bash
curl -k -H "Host: wall.example.com" https://服务器IP/health
curl -k -H "Host: wall.example.com" https://服务器IP/
```

正确结果应该是 `/health` 返回 `{"status":"ok"}`，首页返回 React 构建后的 `index.html`，标题包含“校园墙”。如果这里仍是宝塔默认页，需要先回到 `网站 -> wall.example.com -> SSL` 开启 SSL，或者把 443 的 Nginx 配置改到同一份站点配置里。

## 八、配置 Nginx

进入宝塔站点配置：

```text
网站 -> 你的站点 -> 配置文件
```

在 `server { ... }` 内加入或合并以下配置。

如果宝塔已经有 `location /`，请把它改成下面这样：

```nginx
client_max_body_size 600m;

location ^~ /api/ {
    proxy_pass http://127.0.0.1:5412;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}

location = /health {
    proxy_pass http://127.0.0.1:5412;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /static/notice.json {
    proxy_pass http://127.0.0.1:5412;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /static/uploads/ {
    proxy_pass http://127.0.0.1:5412;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /static/tiny_files/ {
    proxy_pass http://127.0.0.1:5412;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /static/apps/ {
    proxy_pass http://127.0.0.1:5412;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 兼容旧头像地址。当前前端主要使用 /api/user/:id/avatar。
location ~ ^/user/[^/]+/avatar$ {
    proxy_pass http://127.0.0.1:5412;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

保存后重载 Nginx：

```bash
nginx -t
systemctl reload nginx
```

宝塔也可以在面板里点击“保存”，失败时查看配置错误提示。

## 九、放行端口

公网只需要开放：

- `80`
- `443`

不要向公网开放：

- `5412`，Node 后端只给 Nginx 访问
- `5432`，PostgreSQL 只给本机后端访问

如果服务器安全组或宝塔防火墙里开放了 `5412`、`5432`，建议关闭。

## 十、上线检查

后端本机检查：

```bash
curl http://127.0.0.1:5412/health
```

域名检查：

```bash
curl https://wall.example.com/health
curl https://wall.example.com/api/get_messages
curl -I https://wall.example.com/
```

浏览器打开：

```text
https://wall.example.com/
https://wall.example.com/wall
https://wall.example.com/apps
https://wall.example.com/login
https://wall.example.com/admin
```

重点测试：

- 首页、校园墙、应用广场能打开
- 深链接刷新不 404，例如 `/wall`、`/apps`
- `/api/get_messages` 不 404
- 上传图片后 `/static/uploads/...` 能访问
- 登录后 cookie 能保持
- 管理员后台能登录

## 十一、更新部署

以后更新代码：

```bash
cd /www/wwwroot/campusWall
git pull
npm install
npm run build
pm2 restart campus-wall-api
```

如果用宝塔 Node 项目管理器，就在面板里重启后端项目。

通常更新代码不需要动数据库。只有你改了数据库连接配置时，才需要检查系统 PostgreSQL 服务和连接：

```bash
systemctl status postgresql
PGPASSWORD='你的数据库密码' psql -h 127.0.0.1 -p 5432 -U campus_wall -d campus_wall -c "SELECT 1;"
```

旧 SQLite 到 PostgreSQL 的迁移只需要执行一次，不要在每次更新时重复导入。

## 十二、备份

### 备份 PostgreSQL

```bash
cd /www/wwwroot/campusWall
mkdir -p backups
PGPASSWORD='你的数据库密码' pg_dump -h 127.0.0.1 -U campus_wall -d campus_wall > backups/campus_wall_$(date +%F).sql
```

恢复：

```bash
PGPASSWORD='你的数据库密码' psql -h 127.0.0.1 -U campus_wall -d campus_wall < backups/你的备份.sql
```

如果你习惯用 `postgres` 系统用户，也可以：

```bash
sudo -u postgres pg_dump campus_wall > backups/campus_wall_$(date +%F).sql
sudo -u postgres psql campus_wall < backups/你的备份.sql
```

### 备份上传和配置文件

建议定期备份：

```text
backend/static/uploads
backend/static/tiny_files
backend/static/avatars
backend/static/apps/icons
backend/static/notice.json
backend/help
backend/managers.json
backend/admin_log.json
backend/manage_message.json
backend/.env
```

不要只备份数据库，上传文件和头像不在 PostgreSQL 里。

## 十三、常见问题

### 1. 页面能打开，但刷新 `/wall` 或 `/apps` 后 404

Nginx 没有配置 SPA 回退。确认有：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

### 2. `/api/...` 404 或 502

检查后端是否启动：

```bash
curl http://127.0.0.1:5412/health
pm2 logs campus-wall-api
```

检查 Nginx 反代是否写在当前站点配置里。

### 3. Edge/Chrome 打开域名提示 `ERR_TIMED_OUT`

如果命令行里 IPv4 正常、IPv6 超时，例如：

```bash
curl -4 -I https://wall.example.com/
curl -6 -I https://wall.example.com/
```

其中 `curl -4` 返回 200，但 `curl -6` 超时，说明浏览器可能优先走了不可达的 IPv6 链路。Cloudflare 橙云代理会给域名返回 A 和 AAAA 记录，这时浏览器可能卡在 AAAA。

推荐处理：

1. Cloudflare 控制台进入你的根域名，例如 `example.com`。
2. 进入 `Network`。
3. 找到 `IPv6 Compatibility`，关闭它。
4. 等待 DNS 缓存刷新，通常几分钟。
5. 本机执行：

```bash
ipconfig /flushdns
```

6. 浏览器强刷 `Ctrl + F5` 后重新打开 `https://wall.example.com/`。

如果控制台里找不到这个开关，也可以用 Cloudflare API 修改 zone setting：

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ipv6" \
  --request PATCH \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"value":"off"}'
```

API Token 需要有 `Zone Settings Write` 权限。

如果 Cloudflare 控制台里的 `IPv6 Compatibility` 按钮是灰色，但仍然要走 Cloudflare CDN，优先使用上面的 API 方式关闭 IPv6。控制台按钮灰掉不一定代表 API 不能改。

如果 API 也返回无权限或该设置不可修改，Cloudflare 橙云就无法在这个域名上做到“继续 CDN，但不返回 AAAA”。这种情况下有两个选择：

- 继续用 Cloudflare CDN：只能等待 IPv6 链路恢复，或让访问端禁用/修复 IPv6，不适合作为面向所有用户的正式方案。
- 仍然要 CDN 且要绕开 IPv6：换用支持 IPv4-only 加速域名的 CDN，例如腾讯云 CDN、阿里云 CDN、七牛云 CDN 等。Cloudflare 里把 `wall` 记录改成灰云 CNAME 到该 CDN 分配的 CNAME 域名，此时仍然是走 CDN，只是不走 Cloudflare 橙云。

如果临时不走 CDN，才使用下面的灰云源站直连方案：

1. 宝塔 `网站 -> wall.example.com -> SSL` 申请 Let's Encrypt 证书。
2. Cloudflare `DNS` 页面把 `wall` 这条 A 记录改成灰云 `DNS only`。
3. 删除 `wall` 的 AAAA 记录，如果没有 AAAA 就不用处理。
4. 等 DNS 刷新后，本机执行：

```bash
ipconfig /flushdns
```

5. 再检查：

```bash
nslookup -type=aaaa wall.example.com
curl -4 -I https://wall.example.com/
```

灰云后浏览器会直接连接宝塔源站，所以宝塔必须是浏览器信任的 Let's Encrypt 证书。不要在灰云下继续使用 Cloudflare Origin Certificate，否则会出现证书不受信任。

### 4. 登录成功后刷新又变成未登录

检查：

- `SECRET_KEY` 是否稳定，不要每次重启都变化
- HTTPS 下 `SESSION_COOKIE_SECURE=true`
- HTTP 测试时临时用 `SESSION_COOKIE_SECURE=false`
- `ALLOWED_ORIGINS` 是否包含实际访问域名
- Nginx 是否传了 `X-Forwarded-Proto`

### 5. 上传大文件失败

检查 Nginx：

```nginx
client_max_body_size 600m;
```

检查 `backend/.env`：

```env
MAX_CONTENT_LENGTH=524288000
MAX_CHUNK_SIZE=10485760
```

改完后重载 Nginx 并重启后端。

### 6. 视频上传后没有预览或转换失败

确认服务器安装了 `ffmpeg`：

```bash
ffmpeg -version
```

并查看后端日志：

```bash
pm2 logs campus-wall-api
```

### 7. 后端启动报 PostgreSQL 连接失败

检查系统 PostgreSQL 服务：

```bash
systemctl status postgresql
journalctl -u postgresql --no-pager -n 100
pg_isready -h 127.0.0.1 -p 5432
```

再直接测试连接：

```bash
psql -h 127.0.0.1 -p 5432 -U campus_wall -d campus_wall -c "SELECT 1;"
```

重点检查 `backend/.env`：

- 如果 `DATABASE_URL` 有值，确认里面的用户名、密码、主机、端口、数据库名正确
- 如果 `DATABASE_URL` 为空，确认 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD` 正确
- 确认 `pg_hba.conf` 允许本机连接

### 8. 后端启动报 `Could not load the "sharp" module using the linux-x64 runtime`

这通常不是代码错误，而是 `sharp` 的 Linux 原生依赖没有安装成功。常见原因：

- 把 Windows 或其他平台的 `node_modules` 上传到了 Linux 服务器
- 宝塔勾选了“不安装 node_module”，但服务器上其实没有可用依赖
- npm 安装时跳过了 optional dependencies
- 使用了非 LTS Node 版本导致原生依赖兼容性更差

推荐处理方式：

```bash
cd /www/wwwroot/campusWall-react-new

# 如果你的目录不是 campusWall-react-new，改成自己的实际目录
rm -rf node_modules frontend/node_modules backend/node_modules
npm cache verify
npm install --include=optional
npm rebuild sharp --include=optional
npm run build
npm run start:backend
```

如果安装日志里出现：

```text
npm warn allow-scripts ... sharp ... better-sqlite3 ...
```

但项目仍然可以启动，一般可以先观察。若后端仍报 `sharp` 加载失败，再在服务器项目目录执行：

```bash
cd /www/wwwroot/campusWall-react-new
npm approve-scripts
npm rebuild sharp --include=optional
```

如果上面正常，再回宝塔重启 Node 项目。宝塔里建议选择 Node 20/22 LTS；如果当前只装了 v24.18.0 和 v26.2.0，优先选 v24.18.0。包管理器选择 `npm`，启动项选择“自定义启动命令”，命令填 `node src/server.js`。

`npm warn Unknown global config "--init.module"` 一般只是 npm 配置警告，不是这次启动失败的原因；真正让后端退出的是 `sharp` 加载失败。

### 9. 应用图标或上传图片不显示

确认 Nginx 已反代这些路径：

```text
/static/uploads/
/static/tiny_files/
/static/apps/
/static/notice.json
```

同时确认对应文件确实存在于 `backend/static` 下。

## 十四、推荐最终目录结构

```text
/www/wwwroot/campusWall
├─ backend
│  ├─ .env
│  ├─ src
│  └─ static
│     ├─ uploads
│     ├─ tiny_files
│     ├─ avatars
│     └─ apps
├─ frontend
│  └─ dist
├─ compose.yml  # 仅本地开发用，生产部署不依赖它
├─ package.json
└─ package-lock.json
```

PostgreSQL 的数据目录由系统 PostgreSQL 服务管理，不放在项目目录里。

宝塔网站根目录指向：

```text
/www/wwwroot/campusWall/frontend/dist
```

Node 后端项目目录指向：

```text
/www/wwwroot/campusWall/backend
```
