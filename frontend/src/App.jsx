import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, useState } from 'react'
import api from './services/api'
import { AlertProvider } from './contexts/AlertContext.jsx'
import { PlatformProvider } from './contexts/PlatformContext.jsx'
import { useUser } from './contexts/UserContext.jsx'
import Layout from './components/Layout.jsx'

const Home = lazy(() => import('./pages/Home.jsx'))
const Wall = lazy(() => import('./pages/Wall.jsx'))
const ConfessionWall = lazy(() => import('./pages/ConfessionWall.jsx'))
const LostFound = lazy(() => import('./pages/LostFound.jsx'))
const MessageDetail = lazy(() => import('./pages/MessageDetail.jsx'))
const Partition = lazy(() => import('./pages/Partition.jsx'))
const Help = lazy(() => import('./pages/Help.jsx'))
const HelpForm = lazy(() => import('./pages/HelpForm.jsx'))
const HelpSuccess = lazy(() => import('./pages/HelpSuccess.jsx'))
const CommunityRules = lazy(() => import('./pages/CommunityRules.jsx'))
const Report = lazy(() => import('./pages/Report.jsx'))
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
const AdminNotice = lazy(() => import('./pages/admin/AdminNotice.jsx'))
const AdminFeedback = lazy(() => import('./pages/admin/AdminFeedback.jsx'))
const AdminReport = lazy(() => import('./pages/admin/AdminReport.jsx'))
const AdminLog = lazy(() => import('./pages/admin/AdminLog.jsx'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'))
const NotFound = lazy(() => import('./pages/NotFound.jsx'))

function ProtectedRoute({ children, requiredPermission = '' }) {
  const location = useLocation()
  const [state, setState] = useState('checking')

  useEffect(() => {
    let alive = true
    api.adminVerify()
      .then((res) => {
        if (!alive) return
        if (!res.data?.success) {
          setState('no')
          return
        }
        const permissions = new Set((res.data?.admin?.permissions || []).map((permission) => permission.name))
        const required = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission].filter(Boolean)
        setState(required.length > 0 && !required.some((permission) => permissions.has(permission)) ? 'forbidden' : 'ok')
      })
      .catch(() => {
        if (alive) setState('no')
      })
    return () => {
      alive = false
    }
  }, [location.pathname, requiredPermission])

  if (state === 'checking') {
    return (
      <div className="page-center">
        <div className="spinner" />
        <p className="text-muted">正在验证登录状态...</p>
      </div>
    )
  }

  if (state === 'no') return <Navigate to="/admin/login" replace state={{ from: location }} />
  if (state === 'forbidden') return <Navigate to="/admin" replace />
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
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="/wall" element={<Wall />} />
              <Route path="/confessions" element={<ConfessionWall />} />
              <Route path="/lost-found" element={<UserProtectedRoute><LostFound /></UserProtectedRoute>} />
              <Route path="/wall/message/:id" element={<MessageDetail />} />
              <Route path="/p" element={<Partition />} />
              <Route path="/p/:tag" element={<Partition />} />
              <Route path="/help" element={<Help />} />
              <Route path="/help/form" element={<HelpForm />} />
              <Route path="/help/report/:id/comment/:commentId" element={<Report />} />
              <Route path="/help/report/:id" element={<Report />} />
              <Route path="/help/success" element={<HelpSuccess />} />
              <Route path="/rules" element={<CommunityRules />} />
              <Route path="/login" element={<Login />} />
              <Route path="/me" element={<UserProtectedRoute><Me /></UserProtectedRoute>} />
              <Route path="/me/posts" element={<UserProtectedRoute><MyPosts /></UserProtectedRoute>} />
              <Route path="/me/comments" element={<UserProtectedRoute><MyComments /></UserProtectedRoute>} />
              <Route path="/me/favorites" element={<UserProtectedRoute><SavedMessages /></UserProtectedRoute>} />
              <Route path="/me/notifications" element={<UserProtectedRoute><Notifications /></UserProtectedRoute>} />
              <Route path="/user/:id" element={<UserProfile />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
              <Route path="/admin/wall" element={<ProtectedRoute requiredPermission={['manage_wall_message', 'review_posts']}><AdminWall key="posts" scope="posts" /></ProtectedRoute>} />
              <Route path="/admin/confessions" element={<ProtectedRoute requiredPermission={['manage_wall_message', 'review_posts']}><AdminWall key="confessions" scope="confessions" /></ProtectedRoute>} />
              <Route path="/admin/comments" element={<ProtectedRoute requiredPermission="manage_wall_message"><AdminComments /></ProtectedRoute>} />
              <Route path="/admin/trash" element={<ProtectedRoute requiredPermission="manage_wall_message"><AdminTrash /></ProtectedRoute>} />
              <Route path="/admin/managers" element={<Navigate to="/admin/users" replace />} />
              <Route path="/admin/users" element={<ProtectedRoute requiredPermission={['manage_users', 'manage_roles']}><AdminUsers /></ProtectedRoute>} />
              <Route path="/admin/settings" element={<ProtectedRoute requiredPermission="manage_settings"><AdminSettings /></ProtectedRoute>} />
              <Route path="/admin/notice" element={<ProtectedRoute requiredPermission="notice"><AdminNotice /></ProtectedRoute>} />
              <Route path="/admin/feedback" element={<ProtectedRoute requiredPermission="view_user_log"><AdminFeedback /></ProtectedRoute>} />
              <Route path="/admin/report" element={<ProtectedRoute requiredPermission="view_report"><AdminReport /></ProtectedRoute>} />
              <Route path="/admin/log" element={<ProtectedRoute requiredPermission="view_admin_log"><AdminLog type="admin" /></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute requiredPermission="view_admin_log"><AdminAudit /></ProtectedRoute>} />
              <Route path="/admin/error_log" element={<ProtectedRoute requiredPermission="view_log"><AdminLog type="error" /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </Suspense>
      </PlatformProvider>
    </AlertProvider>
  )
}

function RouteFallback() {
  return (
    <div className="page-center">
      <div className="spinner" />
    </div>
  )
}
