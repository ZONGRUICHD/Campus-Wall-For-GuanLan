import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const AlertContext = createContext(null)

const typeStyles = {
  success: {
    className: 'toast-success',
    icon: 'bi-check-circle-fill text-emerald-500',
    titleColor: 'text-emerald-600 dark:text-emerald-400'
  },
  warning: {
    className: 'toast-warning',
    icon: 'bi-exclamation-triangle-fill text-amber-500',
    titleColor: 'text-amber-600 dark:text-amber-400'
  },
  danger: {
    className: 'toast-danger',
    icon: 'bi-x-circle-fill text-rose-500',
    titleColor: 'text-rose-600 dark:text-rose-400'
  },
  error: {
    className: 'toast-error',
    icon: 'bi-x-circle-fill text-rose-500',
    titleColor: 'text-rose-600 dark:text-rose-400'
  },
  info: {
    className: 'toast-info',
    icon: 'bi-info-circle-fill text-blue-500',
    titleColor: 'text-blue-600 dark:text-blue-400'
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
      <div className="alert-stack">
        {alerts.map((alert) => {
          const style = typeStyles[alert.type] || typeStyles.info
          return (
            <div key={alert.id} className={`toast-card ${style.className} flex items-start gap-3`}>
              <i className={`bi ${style.icon} mt-0.5 text-lg shrink-0`} />
              <div className="min-w-0 flex-1">
                {alert.title ? (
                  <div className={`text-sm font-bold leading-tight ${style.titleColor}`}>
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
                <i className="bi bi-x" />
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
