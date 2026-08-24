# Compose 部署与运维

以下命令均在仓库根目录执行，需要 Docker Engine 与新版 Docker Compose。

## 从空卷首次启动

1. 创建仅供本机使用的环境文件：

   ```sh
   cp .env.example .env
   openssl rand -hex 32
   openssl rand -hex 48
   ```

   把两个随机值分别填入 `.env` 的 `POSTGRES_PASSWORD` 和 `SECRET_KEY`，同时确认 `APP_ORIGIN` 是浏览器实际访问的、无结尾斜杠的 Origin。不要提交 `.env`。

2. 检查并构建配置：

   ```sh
   docker compose --env-file .env config --quiet
   docker compose build --pull
   ```

3. 启动并检查状态：

   ```sh
   docker compose up -d
   docker compose ps
   docker compose logs --tail=100 backend
   curl --fail http://127.0.0.1:8080/healthz
   ```

空的 `postgres_data` 卷会先由 PostgreSQL 18 初始化。后端等待数据库健康，按版本执行随应用发布的 SQL migration，迁移成功后才启动 Express；Nginx 等后端健康后再提供页面。空的 `media_data` 卷由后端创建所需目录。镜像重建不会把数据库、上传文件或其他运行状态复制进镜像。

首次创建管理员时使用交互式密码输入，避免密码进入 shell 历史：

```sh
docker compose exec backend node backend/scripts/reset-admin-password.js admin
```

常用命令：

```sh
docker compose logs -f --tail=200
docker compose up -d
docker compose down
```

不要在日常停止服务时添加 `-v`；`docker compose down -v` 会永久删除两个数据卷。数据库初始化变量只在数据库卷第一次创建时生效，之后只修改 `.env` 不会自动修改已有数据库角色的密码。

## 版本化迁移

迁移文件名采用递增版本，例如 `0002_add_example.sql`。新增文件后先在备份的生产数据副本上验证，再构建后端镜像。迁移执行器具备以下约束：

- 按文件名排序，一次只执行一个迁移；
- 使用 advisory lock 防止多个实例并发迁移；
- 每个迁移由执行器包裹在事务中，文件内不要再写 `BEGIN` 或 `COMMIT`；
- 成功版本和 SHA-256 校验和记录在 `schema_migrations`；
- 已应用的文件不可修改、重命名或复用版本号。

查看状态：

```sh
docker compose exec postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "TABLE schema_migrations;"'
```

不支持事务的 DDL 不能直接放进当前自动迁移流程，应设计为单独、可恢复的维护步骤。结构变更优先采用 expand/migrate/contract，使前一版与后一版应用能短期共存。

若迁移失败，当前事务会回滚，后端保持不健康且前端不会启动。先查看 `docker compose logs backend`，修正尚未在任何环境成功应用的迁移或增加后续修复迁移，再重新发布；不要手工伪造 `schema_migrations` 记录。

## 备份

数据库和媒体卷是一个业务检查点。以下流程暂停写入后依次备份二者：

```sh
backup_dir="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

docker compose stop frontend backend
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > "$backup_dir/postgres.dump"

backend_id="$(docker compose ps --all --quiet backend)"
docker run --rm \
  --volumes-from "$backend_id" \
  -v "$PWD/$backup_dir:/backup" \
  alpine:3.22 \
  tar -czf /backup/media.tar.gz -C /var/lib/campus-wall .

docker compose up -d
```

确认两个归档非空，并定期在隔离环境做恢复演练。`.env` 和外部 TLS 私钥应存入受控的秘密管理或加密备份，不能放进上述普通归档。不要用文件复制方式备份正在运行的 PostgreSQL 数据目录。

## 恢复

恢复会删除当前卷。先确认归档和所需镜像版本匹配，并在维护窗口执行：

```sh
restore_dir="backups/20260824T000000Z"

docker compose down -v
docker compose up -d postgres
until docker compose exec -T postgres sh -c \
  'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  sleep 2
done

docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  < "$restore_dir/postgres.dump"

docker compose create backend
backend_id="$(docker compose ps --all --quiet backend)"
docker run --rm \
  --volumes-from "$backend_id" \
  -v "$PWD/$restore_dir:/backup:ro" \
  alpine:3.22 \
  tar -xzf /backup/media.tar.gz -C /var/lib/campus-wall

docker compose up -d
docker compose ps
```

恢复后检查登录、上传文件、缩略图、公告以及 `schema_migrations`。必须使用同一检查点的数据库和媒体归档；只恢复其中一项可能产生数据库引用与文件不一致。

## 发布与回滚

生产发布应把 `BACKEND_IMAGE` 和 `FRONTEND_IMAGE` 设置为不可变版本标签或 digest，然后执行：

```sh
docker compose pull backend frontend
docker compose up -d --no-build
```

迁移前先完成数据库与媒体联合备份。代码回滚仅在数据库结构仍与旧代码向后兼容时安全。迁移完整性检查还要求数据库里每个已应用版本都存在于当前镜像；因此，缺少新 migration 文件的历史后端镜像会拒绝启动，即使结构本身兼容。此时应使用“旧应用代码 + 完整当前 migration 目录”构建的专用回滚镜像，再切换两个镜像变量。自动迁移不执行向下迁移。

若变更不向后兼容，完整回滚是停止服务、恢复迁移前的数据库与媒体检查点，并启动与该检查点匹配的旧镜像。不要只删除 `schema_migrations` 行，也不要让旧代码连接已发生破坏性变更的数据库。

## ffmpeg 与媒体处理

后端最终镜像已安装 `ffmpeg`，用于视频转码和缩略图生成。可检查实际版本：

```sh
docker compose exec backend ffmpeg -version
```

`FFMPEG_TIMEOUT_MS` 控制单次处理超时。应根据允许的上传大小为主机预留 CPU、内存和媒体卷空间，并监控转码失败；增加超时不能解决磁盘不足或不受支持的编码。上传、分片和派生文件都位于 `media_data`，不会进入镜像层。

## HTTPS 与 Cookie

Compose 内的 Nginx 监听 HTTP 8080。生产环境应由受信任的边缘代理或负载均衡器终止 HTTPS，只把流量转发到该端口，并覆盖传递 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto=https`。证书续期与 HSTS 在 TLS 终止层配置。

HTTPS 部署至少修改：

```dotenv
APP_ORIGIN=https://wall.example.edu
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=Lax
```

更新后重新创建容器：

```sh
docker compose up -d --force-recreate backend frontend
```

同域部署使用 `Lax` 即可。只有确实采用跨站前端时才使用 `SameSite=None`，且必须同时启用 `Secure` 并精确配置允许的 Origin。若边缘代理与 Compose 在同一主机，可把 `HTTP_BIND_ADDRESS` 设为 `127.0.0.1`；否则应通过防火墙限制入口，不能直接发布后端或数据库端口。
