import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, useState } from 'react'
import api from './services/api'
import { firstAdminDestination } from './services/permissions.js'
import { AlertProvider } from './contexts/AlertContext.jsx'
import { PlatformProvider, usePlatform } from './contexts/PlatformContext.jsx'
import { useUser } from './contexts/UserContext.jsx'
import Layout from './components/Layout.jsx'
import { featureModules, supportingRoutes } from './modules/registry.jsx'

const Login = lazy(() => import('./pages/Login.jsx'))
const Me = lazy(() => import('./pages/Me.jsx'))
const MyPosts = lazy(() => import('./pages/MyPosts.jsx'))
const MyComments = lazy(() => import('./pages/MyComments.jsx'))
const SavedMessages = lazy(() => import('./pages/SavedMessages.jsx'))
const Notifications = lazy(() => import('./pages/Notifications.jsx'))
const UserProfile = lazy(() => import('./pages/UserProfile.jsx'))
const Admin = lazy(() => import('./pages/admin/Admin.jsx'))
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin.jsx'))
const AdminWall = lazy(() => import('./pages/admin/AdminWall.jsx'))
const AdminComments = lazy(() => import('./pages/admin/AdminComments.jsx'))
const AdminTrash = lazy(() => import('./pages/admin/AdminTrash.jsx'))
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit.jsx'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'))
const AdminNotifications = lazy(() => import('./pages/admin/AdminNotifications.jsx'))
const AdminNotice = lazy(() => import('./pages/admin/AdminNotice.jsx'))
const AdminFeedback = lazy(() => import('./pages/admin/AdminFeedback.jsx'))
const AdminReport = lazy(() => import('./pages/admin/AdminReport.jsx'))
const AdminLog = lazy(() => import('./pages/admin/AdminLog.jsx'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'))
const NotFound = lazy(() => import('./pages/NotFound.jsx'))

function ProtectedRoute({ children, requiredCapability = '' }) {
  const location = useLocation()
  const [state, setState] = useState({ status: 'checking', redirect: '' })
  const requiredKey = (Array.isArray(requiredCapability) ? requiredCapability : [requiredCapability].filter(Boolean)).join('\u0000')

  useEffect(() => {
    let alive = true
    setState({ status: 'checking', redirect: '' })
    api.adminVerify()
      .then((res) => {
        if (!alive) return
        if (!res.data?.success) {
          setState({ status: 'no', redirect: '' })
          return
        }
        const admin = res.data?.admin || null
        const allowed = new Set(admin?.capabilities || [])
        const required = requiredKey ? requiredKey.split('\u0000') : []
        setState(required.length > 0 && !required.some((capability) => allowed.has(capability))
          ? { status: 'forbidden', redirect: firstAdminDestination(admin) }
          : { status: 'ok', redirect: '' })
      })
      .catch(() => {
        if (alive) setState({ status: 'no', redirect: '' })
      })
    return () => {
      alive = false
    }
  }, [location.pathname, requiredKey])

  if (state.status === 'checking') {
    return (
      <div className="page-center">
        <div className="spinner" />
        <p className="text-muted">正在验证登录状态...</p>
      </div>
    )
  }

  if (state.status === 'no') return <Navigate to="/admin/login" replace state={{ from: location }} />
  if (state.status === 'forbidden') return state.redirect
    ? <Navigate to={state.redirect} replace />
    : <Navigate to="/" replace />
  return children
}

function UserProtectedRoute({ children }) {
  const location = useLocation()
  const { user, loading } = useUser()

  if (loading) {
    return (
      <div className="page-center">
        <div className="spinner" />
        <p className="text-muted">正在确认登录状态...</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

export default function App() {
  return (
    <AlertProvider>
      <PlatformProvider>
        <ApplicationRoutes />
      </PlatformProvider>
    </AlertProvider>
  )
}

function ApplicationRoutes() {
  const { enabledModuleIds } = usePlatform()
  const enabledFeatures = featureModules.filter((module) => enabledModuleIds.has(module.id))
  const enabledSupportingRoutes = supportingRoutes.filter((route) => enabledModuleIds.has(route.id))

  const renderModuleElement = (module) => {
    const Component = module.component
    const element = <Component />
    return module.requiresUser ? <UserProtectedRoute>{element}</UserProtectedRoute> : element
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<Layout />}>
          {enabledFeatures.map((module) => (
            module.path === '/'
              ? <Route key={module.id} index element={renderModuleElement(module)} />
              : <Route key={module.id} path={module.path} element={renderModuleElement(module)} />
          ))}
          {enabledSupportingRoutes.map((route) => {
            const Component = route.component
            return <Route key={`${route.id}:${route.path}`} path={route.path} element={<Component />} />
          })}
              <Route path="/login" element={<Login />} />
              <Route path="/me" element={<UserProtectedRoute><Me /></UserProtectedRoute>} />
              <Route path="/me/posts" element={<UserProtectedRoute><MyPosts /></UserProtectedRoute>} />
              <Route path="/me/comments" element={<UserProtectedRoute><MyComments /></UserProtectedRoute>} />
              <Route path="/me/favorites" element={<UserProtectedRoute><SavedMessages /></UserProtectedRoute>} />
              <Route path="/me/notifications" element={<UserProtectedRoute><Notifications /></UserProtectedRoute>} />
              <Route path="/user/:id" element={<UserProfile />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<ProtectedRoute requiredCapability="dashboard.read"><Admin /></ProtectedRoute>} />
              <Route path="/admin/wall" element={<ProtectedRoute requiredCapability="content.queue.read"><AdminWall key="posts" scope="posts" /></ProtectedRoute>} />
              <Route path="/admin/confessions" element={<ProtectedRoute requiredCapability="content.queue.read"><AdminWall key="confessions" scope="confessions" /></ProtectedRoute>} />
              <Route path="/admin/comments" element={<ProtectedRoute requiredCapability="content.comment.read"><AdminComments /></ProtectedRoute>} />
              <Route path="/admin/trash" element={<ProtectedRoute requiredCapability="content.trash.read"><AdminTrash /></ProtectedRoute>} />
              <Route path="/admin/managers" element={<Navigate to="/admin/users" replace />} />
              <Route path="/admin/users" element={<ProtectedRoute requiredCapability="users.read"><AdminUsers /></ProtectedRoute>} />
              <Route path="/admin/settings" element={<ProtectedRoute requiredCapability="settings.read"><AdminSettings /></ProtectedRoute>} />
              <Route path="/admin/notifications" element={<ProtectedRoute requiredCapability="settings.notifications.read"><AdminNotifications /></ProtectedRoute>} />
              <Route path="/admin/notice" element={<ProtectedRoute requiredCapability="notice.read"><AdminNotice /></ProtectedRoute>} />
              <Route path="/admin/feedback" element={<ProtectedRoute requiredCapability="feedback.read"><AdminFeedback /></ProtectedRoute>} />
              <Route path="/admin/report" element={<ProtectedRoute requiredCapability="report.read"><AdminReport /></ProtectedRoute>} />
              <Route path="/admin/log" element={<ProtectedRoute requiredCapability="logs.legacy_admin.read"><AdminLog type="admin" /></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute requiredCapability="audit.read"><AdminAudit /></ProtectedRoute>} />
              <Route path="/admin/error_log" element={<ProtectedRoute requiredCapability="logs.error.read"><AdminLog type="error" /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
    </Suspense>
  )
}

function RouteFallback() {
  return (
    <div className="page-center">
      <div className="spinner" />
    </div>
  )
}
