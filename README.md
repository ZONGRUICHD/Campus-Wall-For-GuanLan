# 观澜校园墙

观澜校园墙是面向校内师生的校园交流 SPA。前端保留米色纸张公告栏、五板块便笺、桌面三栏与移动单栏视觉；业务能力与 API 以冻结契约和参考项目为准。

## 技术栈

- 前端：React 19、React Router、Vite，目录 `frontend/`
- 后端：Node.js 20+、Express，目录 `backend/`
- 数据库：PostgreSQL 18
- 工作区：根 npm workspaces
- 生产入口：Nginx 同域提供前端，并反向代理 Express

仓库运行不依赖 Python、uv、Next.js、FastAPI 或 SQLite。

## 已实现范围

- 35 个 SPA 业务路由，包括公开墙、用户中心、15 个后台页面和管理员保护壳
- 107 个前端 HTTP API 调用，并逐项映射冻结的 OpenAPI 操作
- 学生导入登录、资料、收藏、我的发布、我的评论和通知
- 发帖、评论、附件、分片上传、投票、赞踩、分享和浏览器草稿
- 留言与评论举报、反馈追踪码和公开处理状态
- 预审、上下架、评论治理、回收站、管理员权限、平台设置和审计

不在范围内的愿望清单，以及状态机、页面和接口的完整定义，见：

- `contracts/feature-parity.md`
- `contracts/openapi.yaml`

## 本地启动

要求：

- Node.js 20 或更高版本
- npm（使用仓库中的 `package-lock.json`）
- Docker Engine 与 Docker Compose，用于本地 PostgreSQL
- 本机可调用 `ffmpeg`，用于视频转码和预览

从空环境启动：

```bash
npm ci
npm run db:up
npm run db:wait
npm run db:migrate
npm run admin:reset-password -- <username>
npm run dev
```

`db:migrate` 执行版本化 PostgreSQL migration，可安全重复运行；它不会读取或导入 SQLite。管理员恢复命令会交互式读取新密码。

完成依赖安装后，也可以让脚本先启动并等待本地 PostgreSQL，再启动前后端：

```bash
npm run dev:local
```

后端启动时也会幂等确认 schema，因此全新本地库可直接由 `dev:local` 自举。显式运行 `db:migrate` 仍是部署和验收时的标准入口。

默认地址：

- 前端：http://localhost:5173
- 后端健康检查：http://localhost:5412/health

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动 Express 与 Vite |
| `npm run dev:local` | 启动本地 PostgreSQL、等待就绪并启动开发服务 |
| `npm run dev:backend` | 仅启动后端 |
| `npm run dev:frontend` | 仅启动前端 |
| `npm run db:up` | 只使用 `compose.yml` 启动本地 PostgreSQL |
| `npm run db:wait` | 等待本地 PostgreSQL 可连接 |
| `npm run db:migrate` | 应用并校验版本化 PostgreSQL migration |
| `npm run db:down` | 停止 `compose.yml` 的本地数据库 |
| `npm run clean` | 删除仓库内可再生的构建、测试和 Vite 缓存，不删除依赖或业务数据 |
| `npm run admin:reset-password -- <username>` | 创建或恢复管理员账号 |
| `npm run build` | 构建 Vite 生产产物 |
| `npm run check` | 检查后端语法并构建前端 |
| `npm test` | 运行后端、前端和契约测试 |

## Compose 边界

- `compose.yml` 仅定义本地 PostgreSQL；根 `db:up` 和 `db:down` 会显式指定该文件。
- `compose.yaml` 是唯一生产 Compose，定义 PostgreSQL、Express 后端与 Nginx/Vite 前端。

生产 Compose 从空卷启动：

```bash
cp .env.example .env
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml up -d --build
```

先把 `.env` 中的占位密码、签名密钥和 `APP_ORIGIN` 改为部署环境的真实值。部署、备份与恢复细节见 `docs/deployment.md`。

## 测试与验收

```bash
npm run check
npm test
```

对已启动的后端运行 HTTP 关键路径：

```bash
E2E_BASE_URL=http://127.0.0.1:5412 npm run test:e2e:http
```

允许测试创建一条反馈工单时，再显式设置 `E2E_ALLOW_WRITES=1`。CI 配置位于 `.github/workflows/ci.yml`。

## 目录

```text
.
├── backend/          # Express、PostgreSQL stores、migration 与后端测试
├── contracts/        # 冻结的功能和 OpenAPI 契约
├── docs/             # 架构、部署和 ADR
├── frontend/         # React/Vite SPA、组件和前端测试
├── infra/nginx/      # 生产 Nginx 配置
├── tests/            # 跨工作区契约测试
├── compose.yml       # 本地 PostgreSQL
├── compose.yaml      # 生产三服务栈
└── package.json      # npm workspace 统一命令
```

## 配置与运行数据

本地后端默认连接 `localhost:5432` 的 `campus_wall` 数据库，参数见 `backend/.env.example`。生产 Compose 参数见根 `.env.example`。

PostgreSQL 与媒体目录共同构成需要备份的运行状态。不要提交 `.env`、管理员状态、日志、上传文件或其他运行时数据；生产备份和恢复流程见 `docs/deployment.md`。
