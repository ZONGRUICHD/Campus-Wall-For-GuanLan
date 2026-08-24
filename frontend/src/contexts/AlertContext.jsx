import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const AlertContext = createContext(null)

const typeStyles = {
  success: {
    className: 'toast-success',
    icon: 'bi-check-circle-fill'
  },
  warning: {
    className: 'toast-warning',
    icon: 'bi-exclamation-triangle-fill'
  },
  danger: {
    className: 'toast-danger',
    icon: 'bi-x-circle-fill'
  },
  error: {
    className: 'toast-error',
    icon: 'bi-x-circle-fill'
  },
  info: {
    className: 'toast-info',
    icon: 'bi-info-circle-fill'
  }
}

export function AlertProvider({ children }) {
  const [alerts, setAlerts] = useState([])

  const removeAlert = useCallback((id) => {
    setAlerts((items) => items.filter((item) => item.id !== id))
  }, [])

  const pushAlert = useCallback((msg, type = 'info', title = '', duration = 3000) => {
    const id = `${Date.now()}_${Math.random()}`
    setAlerts((items) => [...items, { id, msg, type, title }])
    if (duration !== 0) {
      window.setTimeout(() => {
        setAlerts((items) => items.filter((item) => item.id !== id))
      }, duration)
    }
  }, [])

  const value = useMemo(() => ({
    showCenterAlert: pushAlert,
    showTopRightAlert: pushAlert,
    showBottomRightAlert: pushAlert,
    showBelowAlert: (_id, msg, type, title, duration) => pushAlert(msg, type, title, duration)
  }), [pushAlert])

  return (
    <AlertContext.Provider value={value}>
      {children}
      <div className="alert-stack" role="region" aria-label="通知">
        {alerts.map((alert) => {
          const style = typeStyles[alert.type] || typeStyles.info
          const liveRole = ['warning', 'danger', 'error'].includes(alert.type) ? 'alert' : 'status'
          return (
            <div key={alert.id} className={`toast-card ${style.className} flex items-start gap-3`}>
              <i className={`bi ${style.icon} toast-icon mt-0.5 text-lg shrink-0`} aria-hidden="true" />
              <div className="min-w-0 flex-1" role={liveRole} aria-atomic="true">
                {alert.title ? (
                  <div className="toast-title text-sm font-bold leading-tight">
                    {alert.title}
                  </div>
                ) : null}
                <div className="mt-0.5 text-xs text-[var(--text-primary)] leading-relaxed">
                  {alert.msg}
                </div>
              </div>
              <button
                type="button"
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] -mr-1 -mt-1 p-1 text-sm"
                onClick={() => removeAlert(alert.id)}
                aria-label="关闭提示"
              >
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </AlertContext.Provider>
  )
}

export function useAlert() {
  const value = useContext(AlertContext)
  if (!value) {
    return {
      showCenterAlert: window.alert,
      showTopRightAlert: window.alert,
      showBottomRightAlert: window.alert,
      showBelowAlert: (_id, msg) => window.alert(msg)
    }
  }
  return value
}
