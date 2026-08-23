# 观澜校园墙

一个面向校内学生的校园社区，包含校园资讯、校园日常、失物招领、二手交易、表白墙和树洞六个板块。仓库采用 Next.js 16 前端与 Python 3.14 FastAPI API；本地默认使用 SQLite，也可通过 `DATABASE_URL` 切换 PostgreSQL。

## 目录

```text
apps/web/        Next.js 响应式前端
apps/api/        FastAPI、SQLAlchemy 与 Alembic
tools/           幂等 install、内容寻址 build 与 clean
infra/           容器镜像和本地 Compose
docs/            架构说明与工程决议
```

## 本地启动

先启动 API：

```powershell
uv sync --project apps/api --extra test
uv run --project apps/api campus-wall-api install
uv run --project apps/api uvicorn campus_wall_api.main:app --app-dir apps/api/src --reload --port 8000
```

再启动前端：

```powershell
npm ci --prefix apps/web
npm run dev --prefix apps/web
```

浏览器打开 <http://localhost:3000>。API 不可达时，前端会明确进入“演示数据”模式，交互仍可继续；服务恢复后可手动重新同步。

## 工程生命周期

仓库只有一个幂等安装语义，不提供 `update`：重复运行 `install` 会从空状态、完整状态或中断后的部分状态收敛到同一结果。

```powershell
python tools/campusctl.py install
python tools/campusctl.py build --target web apps/web/src
python tools/campusctl.py clean
```

`build` 的原材料摘要不包含绝对路径；最终产物另按输出字节计算摘要。`install` 和 `build` 都会自动回收临时及失去引用的对象，`clean` 则移除仓库内全部可再生缓存，不删除依赖、源码或业务数据库。完整语义见 [工程决议](docs/adr/0001-install-build-and-cache.md)。

## 容器启动

```powershell
docker compose -f infra/compose.yaml up --build
```

Compose 默认持久化 SQLite 数据并暴露 Web `3000`、API `8000`。镜像 tag 只用于人类识别，产物身份由 OCI digest 决定；构建流程不向源码或组件写入某次构建号。

## 验证

```powershell
npm run lint --prefix apps/web
npm run build --prefix apps/web
uv run --project apps/api --extra test pytest -q
python -m unittest discover -s tools/tests -v
```
