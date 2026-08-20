import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './layouts.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable shell. Registration failures are not worth surfacing: the app
// works identically without it, since gameplay needs the instance anyway.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
