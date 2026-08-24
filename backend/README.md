# 观澜校园墙 Express 后端

`backend/` 提供观澜校园墙的 Express API。PostgreSQL 18 是唯一数据库，结构由版本化 SQL migration 管理；后端不读取或迁移 SQLite。

## 从仓库根目录运行

```bash
npm ci
npm run db:up
npm run db:wait
npm run db:migrate
npm run admin:reset-password -- <username>
npm run dev
```

仅启动后端：

```bash
npm run dev:backend
# 或
npm run start:backend
```

默认健康检查是 `GET http://localhost:5412/health`。

## PostgreSQL migration

- SQL 文件位于 `backend/migrations/`，文件名按递增版本排序。
- `npm run db:migrate` 使用 advisory lock 串行执行。
- 每个 migration 使用独立短事务，成功后记录版本和文件内容的 SHA-256。
- 已应用 migration 不得修改或重命名；后续结构变化新增 migration。
- 全新空库直接应用 `0001_initial_schema.sql`，没有旧 SQLite 数据迁移步骤。

后端启动也会幂等确认 schema；显式 migration 命令用于发布和验收。

## 配置

开发配置见 `backend/.env.example`。连接顺序为：

1. 非空 `DATABASE_URL`
2. `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`PGSSL`

本地 `compose.yml` 的默认连接为：

```text
host=localhost
port=5432
database=campus_wall
user=campus_wall
password=campus_wall_dev
```

上传、验证码、Cookie、Origin、限流和媒体处理参数也集中在 `backend/.env.example`。

## 持久状态

- PostgreSQL：留言、账号、收藏、通知、应用、平台设置、结构化审计及契约定义的关系数据。
- 文件卷：上传与缩略图、临时分片、应用图标，以及参考实现仍使用的公告和兼容日志状态。

生产容器将文件状态写入 `media_data` 卷，不写入镜像层。数据库卷和媒体卷必须作为同一业务检查点备份，详见 `../docs/deployment.md`。

过期上传凭证、遗留 staging 文件、未引用上传和超时分片由上传模块按 TTL 自动维护。

## 契约与测试

接口契约以 `../contracts/openapi.yaml` 为准，功能状态机以 `../contracts/feature-parity.md` 为准。

```bash
npm --workspace backend run check
npm --workspace backend test
```

完整仓库验收请在根目录运行 `npm run check` 和 `npm test`。
