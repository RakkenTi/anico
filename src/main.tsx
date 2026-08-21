import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './layouts.css'
import App from './App.tsx'
import { DEMO } from './game/demo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable shell. Registration failures are not worth surfacing: the app
// works identically without it, since gameplay needs the instance anyway.
//
// Never in the demo. The worker caches the shell at the site root and bypasses
// /api, and the demo is served from a subpath with no /api to bypass -- so it
// would cache the wrong paths to give a visitor an offline copy of a game that
// deliberately keeps nothing.
if ('serviceWorker' in navigator && import.meta.env.PROD && !DEMO) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
