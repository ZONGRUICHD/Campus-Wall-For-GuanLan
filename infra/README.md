# 容器运行

在仓库根目录执行：

```powershell
docker compose -f infra/compose.yaml up --build
```

Web 镜像使用 Next.js standalone 输出，API 镜像在每次启动时执行幂等 `campus-wall-api install`，完成 Alembic migration 和演示数据 seed。SQLite 文件位于命名卷 `campus-data`，重建镜像不会复制或覆盖业务数据。

若浏览器不是从本机访问，构建 Web 时传入浏览器可达的 API 地址：

```powershell
$env:NEXT_PUBLIC_API_URL = "https://wall-api.example.edu"
$env:CORS_ORIGINS = "https://wall.example.edu"
docker compose -f infra/compose.yaml build web
```

Compose 中的 service tag 只是可读引用，镜像自身由 OCI digest 标识。Docker/BuildKit 的全局缓存由运行环境维护；仓库的 `campusctl clean` 不越界清理运维侧全局缓存。
