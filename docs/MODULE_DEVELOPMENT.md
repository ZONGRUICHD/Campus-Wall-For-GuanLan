# 功能与板块扩展指南

## 1. 目标和边界

项目采用“**编译期组件注册表 + 后端受控模块清单 API**”。新板块应当能由人类或 agent 在明确边界内增量开发，而不用再往多个文件复制导航、路由和权限字符串。

安全边界：

- API 只能返回已编译模块的 ID、版本、路由、能力和启用状态。
- API **不得**返回 JavaScript URL、本地文件路径或用户可控的 `import()` 字符串。
- 不从数据库、URL、Webhook 或管理员文本框加载可执行代码。
- 新模块仍需代码审查、构建、测试和部署；运行时只能启停已编译的模块。

## 2. 当前已落地的基础

```text
backend/src/services/moduleRegistry.js   # 后端受控模块清单
frontend/src/modules/registry.jsx        # 前端编译期页面/路由/导航注册
GET /api/modules                         # 公开、可缓存的安全清单
```

`GET /api/modules` 返回：

```json
{
  "success": true,
  "schema_version": 1,
  "modules": [
    {
      "id": "topics",
      "version": 1,
      "label": "话题",
      "route": "/p",
      "api_prefix": "/api/topics",
      "navigation": ["desktop"],
      "requires_login": false,
      "enabled": true
    }
  ]
}
```

前端 `PlatformContext` 获取清单并对已编译模块做启用过滤。API 无法访问时，前端使用内置安全默认集，不会因为清单网络故障让站点空白。

## 3. 新增一个前台板块

以 `clubs` 为例。

### 3.1 定义数据和 API

1. 建立独立 service，不把数据访问塞进 Router。
2. 在独立 Router 中实现 handler，输入必须做长度、类型、枚举和权限校验。
3. 新 API 优先使用带版本的路径：

```http
GET    /api/v1/modules/clubs
GET    /api/v1/modules/clubs/:id
POST   /api/user/v1/modules/clubs
GET    /api/admin/v1/modules/clubs
PATCH  /api/admin/v1/modules/clubs/:id
```

4. 统一响应建议：

```json
{
  "success": true,
  "data": {},
  "meta": {
    "api_version": 1,
    "module": "clubs",
    "request_id": "..."
  }
}
```

5. 旧 API 需保留时，新旧 Router 直接调用同一个 service/handler，不能在服务器内部通过 localhost HTTP 相互代理。

### 3.2 登记后端清单

在 `backend/src/services/moduleRegistry.js` 增加静态项：

```js
{
  id: 'clubs',
  version: 1,
  label: '社团',
  description: '校内社团与活动',
  route: '/clubs',
  api_prefix: '/api/v1/modules/clubs',
  navigation: ['desktop', 'footer'],
  requires_login: false,
  enabled: true
}
```

ID 只用小写 ASCII 和短横线，全局唯一。注册表中不存 Secret、数据库地址或管理内部路径。

### 3.3 建立前端页面和注册

新建 `frontend/src/pages/Clubs.jsx`，然后在 `frontend/src/modules/registry.jsx` 中只注册一次：

```jsx
const Clubs = lazy(() => import('../pages/Clubs.jsx'))

freezeModule({
  id: 'clubs',
  path: '/clubs',
  component: Clubs,
  label: '社团',
  icon: 'bi-people',
  mobileLabel: '社团',
  navigation: ['desktop', 'footer']
})
```

路由、桌面导航、移动导航和页脚均从注册表派生。不得在 `App.jsx` 和 `Layout.jsx` 各复制一份。如果页面需要登录，设置 `requiresUser: true`；后端 API 仍必须独立验证会话，前端路由保护不是安全边界。

### 3.4 扩展前端 API

新功能暂时在 `frontend/src/services/api.js` 保留兼容 facade：

```js
clubs: {
  list(params) { return http.get('/api/v1/modules/clubs', { params }) },
  detail(id) { return http.get(`/api/v1/modules/clubs/${encodeURIComponent(id)}`) }
}
```

长期应将内部 `request/http` 抽到 `frontend/src/services/http.js`，各模块使用自己的 `api.js`，根 `api.js` 只重新导出旧名称。不要一次性重写所有调用点。

## 4. 新增后台能力

1. 在权限目录添加稳定 key，例如：

```text
clubs.read
clubs.create
clubs.update
clubs.archive
```

2. 除 `super_admin` 外，任何角色都必须显式列出默认权限。新权限不能因为“不在排除列表”就自动授予管理员。
3. 后台 Router 必须经过登录、Trusted Origin、细权限、限流和管理审计。
4. 不仅隐藏前端按钮；每个后端动作都要校验对应 key。
5. 列表读取、创建、编辑、归档和永久删除分开；不要用一个 `manage_everything` 权限包住所有动作。

## 5. 模块注册器必须拒绝的状态

未来将清单升级为完整后端注册器时，启动阶段必须 fail fast：

- 重复模块 ID；
- 公开/用户/后台路由冲突；
- 模块引用未声明权限；
- 循环依赖；
- 非核心模块声明 `/`、`/api`、`/api/admin` 等越权根路径；`home` 是唯一允许使用 `/` 与兼容 `/api` 前缀的保留核心模块；
- 从数据库或 URL 动态加载代码；
- 必要迁移未执行却尝试开启模块；
- 对外显示“健康”但依赖存储/外部服务实际不可用。

## 6. 模块文档模板

每个模块应在同目录附带 `README.md`，至少包含：

```markdown
# 模块名称

- ID / owner / version
- 用户价值和明确非目标
- 公开、用户、后台 API
- 数据表和迁移
- 权限清单和默认角色
- 发布/订阅事件
- 处理的隐私数据与保留期
- 速率限制和容量边界
- 测试命令与验收用例
- 部署顺序、监控、回滚和数据恢复
- 已知限制与后续任务
```

## 7. 完成定义

一个新模块只有在以下条件全部满足时才算完成：

- [ ] 公共 API 契约和错误码有文档；
- [ ] 后端权限、Trusted Origin、限流和审计已验证；
- [ ] 前端路由/导航只在注册表声明一次；
- [ ] 数据迁移向前兼容，回滚不会造成权限升级；
- [ ] 桌面和移动端、浅/深/多配色、键盘和 reduced-motion 均可用；
- [ ] 模块关闭或 API 暂时不可用时有可预期降级；
- [ ] 自动测试、构建和生产冒烟验收通过；
- [ ] README 和 `HANDOFF.md` 与代码同一次提交更新。
