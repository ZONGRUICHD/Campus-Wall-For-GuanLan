# 生产部署手册

> 当前分支仍在按 `docs/production-requirements.md` 补齐上线门禁。在治理、隐私政策和学校授权完成前，只能部署到受限测试环境，不能面向全校公开。

## 1. 准备托管服务

1. 建立外部 PostgreSQL，强制 TLS、自动备份和时间点恢复。
2. 在 Vercel 建立 API 项目，Root Directory 选择 `apps/api`。
3. 在 GitHub 仓库 Settings → Pages 中选择 **GitHub Actions**。
4. 推荐配置学校自有域名：
   - Web：`wall.<school-domain>`
   - API：`api.wall.<school-domain>`

Vercel Function 文件系统不是持久存储，禁止把生产 `DATABASE_URL` 指向 SQLite。媒体上传接入对象存储前，不开放图片和视频功能。

## 2. Vercel API 环境变量

在 Production 和 Preview 环境分别配置：

| 变量 | 要求 |
| --- | --- |
| `APP_ENV` | 生产固定为 `production` |
| `DATABASE_URL` | PostgreSQL TLS 连接串；使用连接池兼容端点 |
| `CORS_ORIGINS` | 精确 HTTPS 前端 origin，多个以逗号分隔；禁止 `*` |
| `JWT_SECRET` | 密钥管理器生成的独立随机值，至少 32 字符 |
| `BOOTSTRAP_ADMIN_USERNAME` | `admin` |
| `BOOTSTRAP_ADMIN_PASSWORD` | 项目所有者指定的一次性初始密码；只存 Vercel/GitHub secret |

同一组运行时变量也要在 Vercel 项目中配置；GitHub Actions 的变量只负责迁移与部署，不能自动替代 Vercel运行时设置。

## 3. GitHub Actions 配置

Repository secrets：

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `DATABASE_URL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Repository variables：

- `NEXT_PUBLIC_API_URL`：Vercel API 的 HTTPS 根地址，不带尾部 `/`

工作流：

- `ci.yml`：SQLite API 回归、PostgreSQL 迁移/回退/全链路、Web lint/build、工具测试。
- `deploy-api.yml`：测试 → Vercel build → Alembic migrate → 幂等管理员引导 → production deploy。
- `deploy-pages.yml`：静态导出并发布 GitHub Pages。

`deploy-api.yml` 不运行演示数据 seed。管理员引导重复执行不会重置现有密码。

## 4. 首次上线顺序

1. 创建受限 Preview 环境并配置 Preview 数据库。
2. 运行 CI，确认 PostgreSQL upgrade → downgrade → upgrade 与应用回路通过。
3. 手动触发 API workflow，检查 `/health` 与 OpenAPI。
4. 将 API URL 写入 `NEXT_PUBLIC_API_URL` repository variable。
5. 触发 Pages workflow，检查登录、注册、刷新、退出和 CORS。
6. 使用初始 `admin` 凭据登录；系统必须只显示首次改密页面。
7. 修改初始密码并启用 2FA（2FA 门禁实现前不得公开生产后台）。
8. 创建普通测试学生，从注册到发帖、举报、审核、删除执行全链路验收。
9. 完成域名、CSP、监控、备份恢复和学校人工发布门禁后，才切换生产入口。

## 5. 回滚

- 前端：在 GitHub Actions 重新运行最后一个已知正常提交的 Pages workflow。
- API：Vercel 回滚到上一 deployment；数据库迁移只在对应 downgrade 已验证且没有新业务数据语义损失时回退。
- 数据库：破坏性故障优先从时间点备份恢复到隔离实例，验证后再切换连接串；不得直接在生产库试错。
- 密钥泄露：立即轮换 JWT、Vercel、数据库和对象存储密钥，吊销全部会话并检查审计日志。
