# 校园墙生产架构

## 请求路径

```text
Browser
   │  HTTP(S)，同一 Origin
   ▼
Nginx / React + Vite 静态产物 :8080
   ├── /、/assets、已有 /static 文件 ──> 静态文件与 SPA fallback
   ├── /api/*                         ──> Express :5412
   └── /static/*（运行时文件）         ──> Express :5412
                                               ├── PostgreSQL 18 :5432
                                               └── media_data 命名卷
```

浏览器只访问前端入口。Nginx 提供编译后的 React 应用，将 API 和运行时静态文件反向代理到 Express，因此 Cookie、API 与页面保持同域，不需要把内部服务端口暴露到宿主机。未知的前端路由回退到 `index.html`，API 与静态文件请求不会落入 SPA fallback。

## 组件职责

- `frontend`：多阶段构建生成 Vite `dist`，最终镜像仅含 Nginx 和静态产物。构建参数不得承载秘密。
- `backend`：Node.js 24 + Express。最终镜像仅安装生产依赖，并包含 `ffmpeg` 处理视频、`sharp` 处理图片。容器以非 root 用户运行。
- `postgres`：PostgreSQL 18，数据库目录由 `postgres_data` 命名卷持久化，不对宿主机发布端口。
- `media_data`：保存上传、分片、缩略图、头像、应用图标、公告及后端仍使用的文件型运行状态。镜像中的应用目录只包含代码和指向该卷的链接。

## 启动与迁移

`postgres` 先通过 `pg_isready` 健康检查。`backend` 随后再次主动等待数据库，取得 PostgreSQL advisory lock，并按文件名顺序执行随应用发布的版本化 SQL migration。每个迁移在独立事务中执行，成功后把版本与 SHA-256 校验和写入 `schema_migrations`；已应用文件若被修改，启动会失败。Express 只在全部迁移成功后监听端口，`frontend` 则只在后端健康后启动。

迁移文件是只增不改的发布记录。结构演进应使用 expand/migrate/contract：先增加向后兼容结构，迁移数据并发布兼容代码，最后在确认没有旧版本运行后移除旧结构。

## 数据与可用性边界

数据库卷与媒体卷共同构成完整业务状态，备份和恢复必须使用同一检查点。删除容器或重建镜像不会删除命名卷；执行 `docker compose down -v` 会删除它们。

当前后端会把部分消息数据载入进程内存，并保留少量卷内文件状态，因此默认拓扑是单个后端副本。增加副本前需要先消除进程内缓存一致性和共享文件写入问题；仅增加 Compose 副本数并不安全。

健康检查用于编排启动顺序和发现进程故障，不替代外部监控。生产监控还应覆盖请求错误率、延迟、磁盘容量、数据库连接数、备份结果和证书到期时间。

## 信任边界

生产环境在 Compose 入口之前终止 HTTPS，只发布 Nginx 端口。边缘代理必须覆盖并传递可信的 `Host`、`X-Forwarded-For` 和 `X-Forwarded-Proto`。`SECRET_KEY`、数据库密码及验证码密钥仅由运行环境注入，不进入镜像、前端构建参数或版本库。
