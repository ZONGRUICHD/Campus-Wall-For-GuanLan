import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { UserProvider } from './contexts/UserContext.jsx'
import './styles.css'

const loadAnalytics = () => {
  const script = document.createElement('script')
  script.defer = true
  script.src = 'https://cloud.umami.is/script.js'
  script.dataset.websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID || 'dd522469-2b45-4814-812e-202678ccee7a'
  document.head.append(script)
}

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <UserProvider>
          <App />
        </UserProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)

if (import.meta.env.PROD) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(loadAnalytics, { timeout: 5000 })
  } else {
    window.setTimeout(loadAnalytics, 3000)
  }
}
