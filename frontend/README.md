# 观澜校园墙 React 前端

这是观澜校园墙的 React + Vite 前端，包含公开页面、用户中心和管理后台。

## 技术栈

- React 19
- React Router 7
- Tailwind CSS 4
- Vite
- dayjs
- Bootstrap Icons
- DOMPurify，按需用于公告和应用内容清洗

## 运行

推荐从仓库根目录统一启动：

```bash
npm run dev
```

仅启动前端：

```bash
npm --workspace frontend run dev
```

前端默认地址为 `http://localhost:5173`。开发环境会把 `/api`、`/static`、`/health` 代理到 `http://localhost:5412`。

## 构建

```bash
npm --workspace frontend run build
```

构建产物输出到 `frontend/dist`。

## 路由

当前 React Router 保留原 SPA 路由：

- `/`
- `/wall`
- `/wall/message/:id`
- `/p`
- `/p/:tag`
- `/login`
- `/me`
- `/me/favorites`
- `/me/posts`
- `/me/comments`
- `/me/notifications`
- `/user/:id`
- `/help`
- `/help/form`
- `/help/status`
- `/rules`
- `/help/report/:id`
- `/help/report/:id/comment/:commentId`
- `/help/success`
- `/apps`
- `/admin`
- `/admin/login`
- `/admin/wall`
- `/admin/comments`
- `/admin/trash`
- `/admin/users`
- `/admin/managers`
- `/admin/apps`
- `/admin/feedback`
- `/admin/settings`
- `/admin/notice`
- `/admin/report`
- `/admin/log`
- `/admin/audit`
- `/admin/error_log`

未知路径会进入 404 页面。

## 样式和静态资源

- 主样式在 `src/styles.css`。
- 视觉系统采用米色纸张公告栏、五板块便笺、桌面三栏与移动单栏布局。
- 通用 favicon 位于 `public/favicon.svg`。
- `public/static` 保留旧静态资源、旧 CSS 和应用配置，用于兼容现有资源 URL。

## 用户资料

- `/me` 支持维护头像、昵称、性别、最长 200 字的公开简介和登录密码。
- `/user/:id` 只展示公开昵称、头像、性别、简介、加入时间以及该账号的非匿名留言，不展示学号和真实姓名。

## 内容举报

- 留言卡片和评论操作区都提供举报入口，举报页会展示对应内容摘要。
- 提交成功会展示可复制的举报追踪码；`/help/status` 的“内容举报”视图可查询待处理状态、处置结果和管理员公开说明。
- `/admin/report` 按留言聚合待处理举报，并支持查看上下文、保留内容、将评论或留言移入回收站和填写公开处理说明。
- 同一页面的“处理记录”视图支持按关键词、举报对象和处理方式筛选历史审计记录，也会展示已公开的处理说明。

## 反馈工单

- `/help/form` 提交后会展示可复制的反馈追踪码。
- `/help/status` 可在“反馈工单”和“内容举报”之间切换；公开查询不展示邮箱、提交正文、内容摘要、内部备注或管理员身份。
- `/admin/feedback` 支持搜索、分类/状态筛选、公开回复、内部备注、状态流转和处理时间线。

## 社区运营设置

- `/rules` 展示管理员维护的社区公约和当前互动开放状态。
- `/admin/settings` 的“社区运营”分区可控制全站/游客发帖与评论、发帖预审、暂停说明、社区公约和敏感词。
- 首页快速发表、导航发布入口、校园墙发布弹窗和评论区会同步公开配置；真正的权限判断仍由后端完成。
- 开启预审后，发布成功提示会改为“等待审核”；登录作者可在 `/me/posts` 查看待审核内容，后台 `/admin/wall` 支持状态队列、勾选和批量审核/下架。
- `/admin/comments` 提供评论搜索、公开/下架筛选、批量下架与恢复；作者在 `/me/comments` 查看下架原因，公开留言页不会显示被下架评论或其原文引用。
- `/admin/trash` 集中管理已删除留言和评论，支持搜索、分类、批量恢复及二次确认后的永久删除。
- `/admin/audit` 展示 PostgreSQL 结构化管理员操作记录，支持按对象类型和关键词筛选；`/admin/log` 继续提供旧文本日志兼容视图。

## 管理员账号

- `/admin/managers` 支持新增管理员、分配功能权限、启用/停用账号、重置其他管理员密码和修改当前管理员密码。
- 后台侧栏和仪表盘快捷入口会按当前账号权限显示；后端对留言、用户、应用、公告、反馈、举报、日志、平台设置和管理员账号接口分别执行权限校验。
- 改密、重置密码或停用账号后，旧版本管理员会话会立即失效。

## 性能说明

- 页面组件使用路由级懒加载，管理后台和非当前页面不会打进首屏主包。
- `SafeHtml` 会按需动态加载富文本清洗逻辑，减少首屏不必要的依赖执行。
- API 层使用原生 `fetch`，不再引入 Axios。
- Bootstrap Icons 使用 `src/bootstrap-icons-subset.css` 维护图标子集，避免整套图标 CSS 进入首屏样式。
- Umami 统计脚本在生产环境空闲加载，不阻塞 HTML 首屏。
- 如果开发时出现 Vite `Outdated Optimize Dep`，可删除 `node_modules/.vite` 后使用 `--force` 重启前端。

```powershell
Remove-Item -Recurse -Force frontend/node_modules/.vite, frontend/node_modules/.vite-temp
npm --workspace frontend run dev -- --force
```
