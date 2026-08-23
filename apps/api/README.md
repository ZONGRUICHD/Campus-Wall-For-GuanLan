# Campus Wall Python API

观澜校园墙的 FastAPI + SQLAlchemy 2 后端，提供校园资讯、校园日常、失物招领、表白墙和树洞五个板块。API 字段统一使用 `snake_case`，本地默认 SQLite，通过 `DATABASE_URL` 可切换 PostgreSQL（psycopg 3）。

## 环境与安装

项目目标运行时为 Python 3.14。进入本目录后执行：

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
campus-wall-api install
uvicorn campus_wall_api.main:app --reload
```

`install` 是统一、幂等的安装入口：执行 Alembic 到 `head`，再幂等写入五条演示数据。中途中断后可直接重新运行；seed 以单条演示帖子为事务粒度，已经完成的记录不会重复。可再生缓存由仓库级 `tools/campusctl.py` 自动维护，API 安装不会抖动仍然有效的依赖缓存。

CLI 按以下顺序定位 `alembic.ini` 和 `migrations/`：`CAMPUS_WALL_API_ROOT` 指定目录、当前工作目录、源码项目目录。容器内使用非 editable pip 安装时，可让 `WORKDIR /app` 同时包含这两个资产，或设置 `CAMPUS_WALL_API_ROOT=/app`；找不到资产时命令会列出检查位置和修复方式。

也可以独立运行：

```powershell
campus-wall-api migrate
campus-wall-api seed
campus-wall-api clean
```

不提供单独的 `update`：重复执行 `install` 即是安装和更新的统一入口。`clean` 只移除 `apps/api` 内的 Python、pytest、Ruff、mypy 和 coverage 缓存，不删除数据库。

PostgreSQL 示例：

```powershell
$env:DATABASE_URL = "postgresql+psycopg://campus:campus@localhost:5432/campus_wall"
campus-wall-api install
```

通用的 `postgresql://` 和 `postgres://` URL 也会规范化为 psycopg 3 驱动。

浏览器跨域默认允许 `http://localhost:3000` 和 `http://127.0.0.1:3000`。部署时可使用逗号分隔的 `CORS_ORIGINS` 覆盖，例如 `https://wall.example.edu,https://wall-admin.example.edu`。

## API

- `GET /health` → `{"status":"ok"}`
- `GET /api/v1/posts`
- `POST /api/v1/posts`
- `GET /api/v1/posts/me`
- `PATCH /api/v1/posts/{id}`
- `POST /api/v1/posts/{id}/reactions`
- `POST /api/v1/posts/{id}/comments`
- `PATCH /api/v1/posts/{id}/resolution`
- `POST /api/v1/lost-found/{id}/claims`
- `GET /api/v1/lost-found/{id}/claims`
- `GET /api/v1/lost-found/claims/me`
- `PATCH /api/v1/lost-found/{id}/claims/{claim_id}`
- `DELETE /api/v1/lost-found/{id}/claims/{claim_id}`

板块值固定为：`news`、`daily`、`lost_found`、`confession`、`tree_hole`。

列表参数：

- `board`：板块筛选。
- `query`：搜索标题、正文、作者、地点和标签。
- `sort`：`latest`（默认）、`oldest`、`popular`。
- `lost_found_state`：`all`、`unresolved`、`resolved`；指定后只返回失物招领贴。
- `lost_found_category`：按证件、电子产品、钥匙、衣物、书籍或其他物品筛选。
- `occurred_after` / `occurred_before`：按丢失或拾获时间筛选；起止顺序错误返回 `422`。
- `cursor`：服务端返回的不透明键集游标。
- `limit`：1–100，默认 20。

列表响应：

```json
{
  "items": [],
  "next_cursor": null
}
```

创建普通帖子：

```json
{
  "title": "今天的校园晚霞",
  "body": "操场边很好看。",
  "board": "daily",
  "author_name": "观澜同学",
  "anonymous": false,
  "tags": ["摄影", "校园日常"]
}
```

`news` 和 `lost_found` 必须提供非空标题；`daily`、`confession`、`tree_hole` 可以省略标题，此时响应中的 `title` 为 `null`。失物招领贴必须同时提供 `kind`（`lost` / `found`）、`item_category`、`location` 和 `occurred_at`，且发生时间不能在未来；这些字段对其他板块无效。匿名内容返回的 `author_name` 为“匿名同学”，前端无需再次替换。

失物认领线索不会进入公开评论区。登录用户可为他人尚未解决的失物贴提交一条线索；发布者或具备 `content:moderate` 权限的审核员可查看并接受/拒绝。接受一条线索会在同一事务内将帖子标记为已解决，并自动拒绝其余待核对线索。匿名线索向普通发布者隐藏提交者昵称，审核员仍可按治理职责查看；任何审核员都不能审核自己的线索。

评论请求接受 `body`、`author_name`、`anonymous`。点赞、评论、收藏、状态更新和线索操作都绑定当前登录身份。更新招领状态的请求体为 `{"resolved": true}`；只有作者或内容审核员可以更新 `lost_found` 帖子。

交互文档运行后位于 `/docs`。

## 数据库与事务边界

应用启动不会调用 `create_all`，数据库结构只由 Alembic 管理。每个写请求在一个短 `Session.begin()` 中完成并立即提交；异常或取消会回滚，会话依赖在路径函数结束时释放。列表查询只在 SQL 执行和响应模型物化期间持有短只读事务，不跨响应发送或请求持有事务。

基础迁移 `20260824_0001` 使用稳定的业务字符串和数据库约束保存板块/招领类型，不依赖 Python 枚举序号。加入该迁移时仓库中不存在 `apps/api`、API 数据库或 API 旧业务数据，因此它只创建基础 schema，没有伪造旧数据回填。未来若已有业务数据，后续迁移必须显式编写相应的数据迁移逻辑。

## 测试

```powershell
pytest
```

测试从空 SQLite 文件执行真实 Alembic migration，覆盖空状态、幂等 seed、五类帖子创建、搜索和筛选、游标、内容生命周期、身份权限、评论，以及失物结构化字段和私密认领状态机。
