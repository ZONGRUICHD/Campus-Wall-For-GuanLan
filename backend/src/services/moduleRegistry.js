const moduleDefinitions = Object.freeze([
  Object.freeze({
    id: 'home',
    version: 1,
    label: '首页',
    description: '校园墙首页与公告入口',
    route: '/',
    api_prefix: '/api',
    navigation: ['desktop', 'mobile', 'footer'],
    requires_login: false,
    enabled: true
  }),
  Object.freeze({
    id: 'wall',
    version: 1,
    label: '动态',
    description: '校园动态发布、互动与审核',
    route: '/wall',
    api_prefix: '/api/wall',
    navigation: ['desktop', 'mobile', 'footer'],
    requires_login: false,
    enabled: true
  }),
  Object.freeze({
    id: 'confessions',
    version: 1,
    label: '表白墙',
    description: 'Three.js 爱心便签与独立审核流',
    route: '/confessions',
    api_prefix: '/api/wall',
    navigation: ['desktop', 'mobile', 'footer'],
    requires_login: false,
    enabled: true
  }),
  Object.freeze({
    id: 'lost-found',
    version: 1,
    label: '失物招领',
    description: '公开浏览、登录后填写的失物招领',
    route: '/lost-found',
    api_prefix: '/api/user/lost-found',
    navigation: ['desktop', 'mobile', 'footer'],
    requires_login: false,
    enabled: true
  }),
  Object.freeze({
    id: 'topics',
    version: 1,
    label: '话题',
    description: '按精确标签索引的话题目录',
    route: '/p',
    api_prefix: '/api/topics',
    navigation: ['desktop'],
    requires_login: false,
    enabled: true
  }),
  Object.freeze({
    id: 'help',
    version: 1,
    label: '帮助反馈',
    description: '反馈、举报与社区规则',
    route: '/help',
    api_prefix: '/api/help',
    navigation: ['desktop', 'footer'],
    requires_login: false,
    enabled: true
  })
])

export const publicModuleManifest = () => moduleDefinitions.map((module) => ({ ...module }))

export const enabledModuleIds = () => new Set(
  moduleDefinitions.filter((module) => module.enabled).map((module) => module.id)
)
