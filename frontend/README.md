# 龙华区观澜中学校园墙 React 前端

这是龙华区观澜中学校园墙的 React + Vite 前端，包含公开校园墙、表白墙、登录后失物招领、个人中心与按角色授权的管理后台。

项目仓库：[ZONGRUICHD/Campus-Wall-For-GuanLan](https://github.com/ZONGRUICHD/Campus-Wall-For-GuanLan)

## 技术栈

- React 19
- React Router 7
- Tailwind CSS 4
- Vite
- Bootstrap Icons
- DOMPurify
- Three.js，用于表白墙粉色粒子爱心

## 运行与构建

推荐从仓库根目录启动：

```bash
npm run dev
```

仅启动前端：

```bash
npm --workspace frontend run dev
```

使用项目验收端口：

```bash
npm --workspace frontend run dev -- --port 1145
```

前端会把 `/api`、`/static`、`/health` 代理到 `http://localhost:5412`。

构建：

```bash
npm --workspace frontend run build
```

产物输出到 `frontend/dist`。

## 路由

公开路由：

- `/`
- `/wall`
- `/confessions`
- `/wall/message/:id`
- `/p`
- `/p/:tag`
- `/help`
- `/help/form`
- `/help/report/:id`
- `/help/report/:id/comment/:commentId`
- `/help/success`
- `/rules`
- `/login`
- `/user/:id`

登录后路由：

- `/lost-found`
- `/me`
- `/me/posts`
- `/me/comments`
- `/me/favorites`
- `/me/notifications`

后台路由：

- `/admin/login`
- `/admin`
- `/admin/wall`
- `/admin/comments`
- `/admin/trash`
- `/admin/users`
- `/admin/settings`
- `/admin/notice`
- `/admin/feedback`
- `/admin/report`
- `/admin/log`
- `/admin/audit`
- `/admin/error_log`

未知路径进入 404 页面。登录后路由会保存来源位置，完成登录后返回原目标页。

## 注册与登录

- 登录页提供“登录 / 注册”切换。
- 用户使用任意合规用户名和密码注册，不依赖外部身份名单。
- 用户名支持 2–24 位中文、字母、数字、点、下划线或短横线；密码长度为 8–128 个字符。
- 注册成功后写入用户会话并进入个人中心或原目标页。
- 导航栏根据会话显示登录入口或个人中心入口。
- 个人中心支持资料、头像、密码、发布、评论、收藏和通知。

## 发布与审核

- 普通校园墙允许游客匿名发帖。
- 游客与普通 `user` 发布普通校园动态后显示“等待审核”，审核通过前不会出现在公开内容中。
- 登录用户可以选择匿名或展示昵称。
- `reviewer`、`admin`、`super_admin` 初次发布普通校园动态后立即公开，不显示等待审核，也不进入审核队列。
- 游客与普通 `user` 提交表白便签后进入待审，页面返回待审回执；便签在审核通过前不会出现在粒子爱心中，也不会立即重新拉取为可见内容。
- `reviewer`、`admin`、`super_admin` 的表白便签初次发布免审并立即公开。
- 审核详情使用可读字段展示作者类型、提交时间、正文、标签、附件、投票与状态，不展示原始 JSON。
- 后台审核列表展示所有实际待审内容：初次发布时包括游客/普通用户的普通动态与表白便签；任何免审内容被管理端明确退回后也会带 `review_hold` 进入队列，作者编辑不能自行重新公开。

## 失物招领

- `/lost-found` 由用户路由守卫保护，未登录访问会跳转到 `/login`。
- 登录后可以筛选、查看和发布寻物或招领启事。
- 页面调用专用登录接口，不复用公共校园墙列表来绕过访问边界。
- 初次发布成功后立即公开给已登录用户，不进入审核队列；未登录访问限制保持不变。若管理端随后明确退回，作者编辑后仍需审核员再次通过。

## 角色管理

前端识别四种角色：

| 角色 | 界面能力 |
| --- | --- |
| `user` | 个人中心与登录后专区 |
| `reviewer` | 帖子审核队列 |
| `admin` | 内容与运营管理，不显示角色分配操作 |
| `super_admin` | 显示用户权限管理并可分配四种角色 |

`/admin/users` 的角色控件只对超级管理员显示。所有权限仍由后端复核，不能依赖前端隐藏来阻止越权。

## 反馈与举报

- `/help/form` 提交反馈后进入简洁成功页。
- 留言和评论可以从对应详情发起举报。
- 前台不提供处理状态页面；反馈、举报、内部备注与处置记录由有权限的后台页面管理。

## 样式和静态资源

- 主样式位于 `src/styles.css`。
- Apple 风格设计令牌通过 CSS 变量统一亮色与深色主题。
- 通用 favicon 位于 `public/favicon.svg`。
- `public/static` 仅保留兼容现有资源 URL 所需的旧静态文件。
- 页面组件按路由懒加载；Three.js 仅在进入表白墙时加载。
- Bootstrap Icons 使用本地图标字体，避免外部字体加载失败出现缺失符号。
- Umami 统计脚本仅在生产环境空闲时加载。

## 开发排错

如果出现 Vite 依赖预构建缓存失效，可停止前端后执行：

```powershell
Remove-Item -Recurse -Force frontend/node_modules/.vite, frontend/node_modules/.vite-temp
npm --workspace frontend run dev -- --force
```

然后在浏览器按 `Ctrl + F5` 强制刷新。

## 验证重点

- 桌面与手机端首页、导航和主题切换
- 任意用户名注册、登录、退出与来源页返回
- 游客和普通用户发布普通动态进入待审核状态
- reviewer/admin/super_admin 初次发布普通动态立即公开且不进入审核列表
- 游客/普通用户提交表白便签后收到待审回执，便签不立即进入爱心；管理角色表白便签立即公开且初次不进入审核列表
- 未登录访问失物招领跳转登录，登录后初次发布立即可见且不进入审核列表
- 免审内容被明确退回后进入队列，作者编辑仍保持待审；审核详情可读，所有审核员能处理全部实际待审内容
- 超级管理员可分配角色，其他角色看不到并且无法调用该能力
- 反馈与举报成功页不出现公开状态入口
- 浏览器控制台无错误，Vite 错误浮层不存在
