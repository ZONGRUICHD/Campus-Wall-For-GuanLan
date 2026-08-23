# ADR 0002：Vercel API 与 GitHub Pages 静态前端

- 状态：已接受
- 日期：2026-08-23

## 背景

生产版要求后端部署到 Vercel、前端部署到 GitHub Pages。现有实现把 Next.js 构建为 `standalone` Node 服务，并默认使用本地 SQLite；这两项都不符合目标运行时。

## 决策

### 前端

- `apps/web` 使用 Next.js `output: "export"` 生成 `out/`。
- GitHub Actions 从 `main` 构建并通过 Pages artifact 发布，不提交构建产物。
- Actions 根据 `GITHUB_REPOSITORY` 自动注入仓库 `basePath`；自定义域名可用 `NEXT_PUBLIC_BASE_PATH` 覆盖。
- `NEXT_PUBLIC_API_URL` 必须是仓库 Actions variable 中的 HTTPS 地址；缺失或非 HTTPS 时部署构建失败。
- 所有运行时数据都由 Client Component 访问 FastAPI。不得引入依赖 Node 服务的 cookies、rewrites、Server Actions、动态 Route Handlers 或未预生成的动态路由。
- 本地容器仍可用于集成验证，但只用 Nginx 托管同一份静态导出。

### 后端

- Vercel 项目的 Root Directory 设置为 `apps/api`。
- Vercel Python Runtime 通过 `[tool.vercel].entrypoint = "campus_wall_api.main:app"` 加载 ASGI 应用，Python 版本固定为 3.14。
- API 不在请求启动时执行 Alembic；生产迁移是部署前独立门禁。
- Vercel Function 仅处理短请求。定时发布、通知和审核任务使用 PostgreSQL outbox，并由受鉴权的定时入口或外部队列消费。
- 本地 SQLite 继续服务快速开发测试；生产必须提供外部 PostgreSQL `DATABASE_URL`。
- 媒体不得落到 Function 文件系统，使用对象存储签名上传。

### 身份与跨域

- 推荐学校自有同站点子域名，例如 `wall.example.edu` 与 `api.wall.example.edu`。
- API 的 `CORS_ORIGINS` 只列出实际 Pages/自定义域名，不允许生产通配符。
- 在默认 `github.io` 与 `vercel.app` 跨站域名下，不以第三方 cookie 作为唯一会话方案；采用短时访问令牌、刷新令牌轮换、服务端吊销与严格 CSP。切换为同站点自定义域名后可优先使用 `Secure`、`HttpOnly` cookie。

## 后果

- GitHub Pages 无服务端路由，因此页面必须可在构建期枚举，帖子等实体详情采用客户端加载的静态壳路由或查询参数。
- 环境变量在静态构建时写入，API 域名变更需要重新构建前端。
- SQLite 数据不能迁移到 Vercel 本地磁盘；上线前必须建立 PostgreSQL、备份和恢复演练。
- Vercel 冷启动和执行时限不适合长任务，审核媒体、通知群发和搜索索引必须异步化。

## 验证

1. `npm run build --prefix apps/web` 生成 `apps/web/out/index.html`。
2. 在 `GITHUB_ACTIONS=true`、`GITHUB_REPOSITORY=owner/repo` 下构建后，HTML/CSS/JS 资源路径包含 `/repo/`。
3. 从 `apps/api` 安装项目后，可导入 `campus_wall_api.main:app` 并通过 `/health`。
4. GitHub Pages workflow 对缺失/非 HTTPS API URL 失败，对合法 URL 产出 artifact。
5. PostgreSQL 集成测试从空库运行迁移并执行 API 测试；该门禁在接入生产数据库阶段加入 CI。
