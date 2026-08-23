# 校园墙 MVP 架构

## 产品边界

六个板块共用帖子、评论、点赞、收藏和媒体模型。失物招领通过结构化字段与私密认领表管理找回流程；二手交易通过商品明细与私密询价表管理价格、成色和交易状态。所有写操作绑定登录用户与 RBAC 权限；表白墙和树洞允许匿名展示，但后台审计仍保留责任主体。

## 请求路径

```text
Browser :3000  ── JSON/HTTP ──>  FastAPI :8000  ── short transaction ──>  SQLite/PostgreSQL
      │                                  │
      └── API 不可达时进入显式 demo 模式 └── Alembic 管理 schema，seed 幂等
```

Next.js 页面保留服务端外壳，筛选、发布、点赞和评论集中在客户端交互组件。API 每个写请求只持有一个短事务并在返回前完成提交；异常或取消由会话上下文回滚，不存在跨请求长事务。

## 数据与迁移

- `posts.board` 保存稳定业务字符串：`news`、`daily`、`lost_found`、`marketplace`、`confession`、`tree_hole`。
- 反应使用 `(post_id, actor)` 复合主键，`actor` 绑定登录用户，让点赞切换保持幂等。
- `marketplace_listings` 与帖子一对一保存商品字段，`marketplace_inquiries` 使用 `(post_id, buyer_user_id)` 唯一约束保存每位买家的私密对话状态。
- seed 使用稳定 `seed_key`，每条帖子单独提交；中断后重复执行不会产生副本。
- 首个迁移建立时没有旧 API 数据，因此只创建基础 schema。未来每个涉及已有业务字段含义的迁移，都必须同时给出明确的数据搬迁步骤；不会为了兼容一个已废弃实现保留双写或永久分支。

## 运行时

- Python 3.14。
- Node.js 24 / Next.js 16。
- 项目目前没有需要 C++ 的模块；若后续确有原生模块，语言基线为 C++23，不为满足版本号而引入空壳组件。
