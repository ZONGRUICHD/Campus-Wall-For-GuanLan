import { lazy } from 'react'

const Home = lazy(() => import('../pages/Home.jsx'))
const Wall = lazy(() => import('../pages/Wall.jsx'))
const ConfessionWall = lazy(() => import('../pages/ConfessionWall.jsx'))
const LostFound = lazy(() => import('../pages/LostFound.jsx'))
const MessageDetail = lazy(() => import('../pages/MessageDetail.jsx'))
const Partition = lazy(() => import('../pages/Partition.jsx'))
const Help = lazy(() => import('../pages/Help.jsx'))
const HelpForm = lazy(() => import('../pages/HelpForm.jsx'))
const HelpSuccess = lazy(() => import('../pages/HelpSuccess.jsx'))
const CommunityRules = lazy(() => import('../pages/CommunityRules.jsx'))
const Report = lazy(() => import('../pages/Report.jsx'))

const freezeModule = (module) => Object.freeze({ ...module })

export const featureModules = Object.freeze([
  freezeModule({
    id: 'home',
    path: '/',
    end: true,
    component: Home,
    label: '首页',
    icon: 'bi-house',
    mobileLabel: '首页',
    navigation: ['desktop', 'mobile', 'footer']
  }),
  freezeModule({
    id: 'wall',
    path: '/wall',
    component: Wall,
    label: '动态',
    footerLabel: '校园动态',
    icon: 'bi-chat-square-dots',
    mobileLabel: '动态',
    navigation: ['desktop', 'mobile', 'footer']
  }),
  freezeModule({
    id: 'confessions',
    path: '/confessions',
    component: ConfessionWall,
    label: '表白墙',
    icon: 'bi-heart',
    mobileLabel: '表白',
    navigation: ['desktop', 'mobile', 'footer']
  }),
  freezeModule({
    id: 'lost-found',
    path: '/lost-found',
    component: LostFound,
    label: '失物招领',
    icon: 'bi-search',
    mobileLabel: '失物',
    navigation: ['desktop', 'mobile', 'footer'],
    requiresUser: true
  }),
  freezeModule({
    id: 'topics',
    path: '/p',
    component: Partition,
    label: '话题',
    icon: 'bi-hash',
    navigation: ['desktop']
  }),
  freezeModule({
    id: 'help',
    path: '/help',
    component: Help,
    label: '帮助反馈',
    icon: 'bi-life-preserver',
    navigation: ['desktop', 'footer']
  })
])

export const supportingRoutes = Object.freeze([
  freezeModule({ id: 'wall', path: '/wall/message/:id', component: MessageDetail }),
  freezeModule({ id: 'topics', path: '/p/:tag', component: Partition }),
  freezeModule({ id: 'help', path: '/help/form', component: HelpForm }),
  freezeModule({ id: 'help', path: '/help/report/:id/comment/:commentId', component: Report }),
  freezeModule({ id: 'help', path: '/help/report/:id', component: Report }),
  freezeModule({ id: 'help', path: '/help/success', component: HelpSuccess }),
  freezeModule({ id: 'help', path: '/rules', component: CommunityRules })
])

export const navigationModules = (placement, enabledIds) => featureModules.filter((module) => (
  module.navigation?.includes(placement) && (!enabledIds || enabledIds.has(module.id))
))
