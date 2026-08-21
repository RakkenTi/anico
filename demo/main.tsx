/**
 * The demo's entry point.
 *
 * The only thing it does that `src/main.tsx` does not is stand an instance up
 * in the tab and point the client at it before React mounts. Everything after
 * that is the ordinary app talking to an ordinary server that happens to be a
 * function call away.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import '../src/layouts.css'
import App from '../src/App'
import { useInstance } from '../src/api'
import { startInstance } from './instance'

const root = createRoot(document.getElementById('root')!)

/** A loading state worth looking at: the wasm and the catalog take a moment. */
function boot(message: string) {
  root.render(
    <div className="auth-shell">
      <div className="boot-note">{message}</div>
    </div>,
  )
}

boot('Starting an instance in your browser…')

startInstance()
  .then((instance) => {
    useInstance(instance)
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((err: unknown) => {
    console.error(err)
    boot(`The demo could not start: ${err instanceof Error ? err.message : String(err)}`)
  })
