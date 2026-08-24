import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, useState } from 'react'
import api from './services/api'
import { AlertProvider } from './contexts/AlertContext.jsx'
import { PlatformProvider } from './contexts/PlatformContext.jsx'
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
const HelpStatus = lazy(() => import('./pages/HelpStatus.jsx'))
const CommunityRules = lazy(() => import('./pages/CommunityRules.jsx'))
const Report = lazy(() => import('./pages/Report.jsx'))
const Admin = lazy(() => import('./pages/admin/Admin.jsx'))
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin.jsx'))
const AdminWall = lazy(() => import('./pages/admin/AdminWall.jsx'))
const AdminComments = lazy(() => import('./pages/admin/AdminComments.jsx'))
const AdminTrash = lazy(() => import('./pages/admin/AdminTrash.jsx'))
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit.jsx'))
const AdminManagers = lazy(() => import('./pages/admin/AdminManagers.jsx'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'))
const AdminNotice = lazy(() => import('./pages/admin/AdminNotice.jsx'))
const AdminFeedback = lazy(() => import('./pages/admin/AdminFeedback.jsx'))
const AdminReport = lazy(() => import('./pages/admin/AdminReport.jsx'))
const AdminLog = lazy(() => import('./pages/admin/AdminLog.jsx'))
const NotFound = lazy(() => import('./pages/NotFound.jsx'))

function ProtectedRoute({ children }) {
  const location = useLocation()
  const [state, setState] = useState('checking')

  useEffect(() => {
    let alive = true
    api.adminVerify()
      .then((res) => {
        if (alive) setState(res.data?.success ? 'ok' : 'no')
      })
      .catch(() => {
        if (alive) setState('no')
      })
    return () => {
      alive = false
    }
  }, [location.pathname])

  if (state === 'checking') {
    return (
      <div className="page-center">
        <div className="spinner" />
        <p className="text-muted">正在验证登录状态...</p>
      </div>
    )
  }

  if (state === 'no') return <Navigate to="/admin/login" replace state={{ from: location }} />
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
              <Route path="/lost-found" element={<LostFound />} />
              <Route path="/wall/message/:id" element={<MessageDetail />} />
              <Route path="/p" element={<Partition />} />
              <Route path="/p/:tag" element={<Partition />} />
              <Route path="/help" element={<Help />} />
              <Route path="/help/form" element={<HelpForm />} />
              <Route path="/help/report/:id/comment/:commentId" element={<Report />} />
              <Route path="/help/report/:id" element={<Report />} />
              <Route path="/help/success" element={<HelpSuccess />} />
              <Route path="/help/status" element={<HelpStatus />} />
              <Route path="/rules" element={<CommunityRules />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
              <Route path="/admin/wall" element={<ProtectedRoute><AdminWall /></ProtectedRoute>} />
              <Route path="/admin/comments" element={<ProtectedRoute><AdminComments /></ProtectedRoute>} />
              <Route path="/admin/trash" element={<ProtectedRoute><AdminTrash /></ProtectedRoute>} />
              <Route path="/admin/managers" element={<ProtectedRoute><AdminManagers /></ProtectedRoute>} />
              <Route path="/admin/settings" element={<ProtectedRoute><AdminSettings /></ProtectedRoute>} />
              <Route path="/admin/notice" element={<ProtectedRoute><AdminNotice /></ProtectedRoute>} />
              <Route path="/admin/feedback" element={<ProtectedRoute><AdminFeedback /></ProtectedRoute>} />
              <Route path="/admin/report" element={<ProtectedRoute><AdminReport /></ProtectedRoute>} />
              <Route path="/admin/log" element={<ProtectedRoute><AdminLog type="admin" /></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute><AdminAudit /></ProtectedRoute>} />
              <Route path="/admin/error_log" element={<ProtectedRoute><AdminLog type="error" /></ProtectedRoute>} />
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
