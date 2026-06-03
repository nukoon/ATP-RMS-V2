import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthGate } from './components/AuthGate'
import { applyTheme } from './theme'

// Apply the persisted theme before first paint so CSS variables are set and
// there's no flash of unstyled colours.
try {
  const raw = localStorage.getItem('atp-rms-theme')
  applyTheme(raw && JSON.parse(raw)?.state?.theme === 'dark' ? 'dark' : 'light')
} catch { applyTheme('light') }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
)
