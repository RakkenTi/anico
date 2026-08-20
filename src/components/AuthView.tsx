import { useState } from 'react'
import { useGame } from '../game/store'

/** An invite link lands as /?invite=CODE and opens straight into signup. */
const inviteFromUrl = new URLSearchParams(window.location.search).get('invite') ?? ''

/**
 * Sign in, or create an account. A fresh instance has no accounts, so the
 * first person through this screen becomes the admin and needs no invite;
 * everyone after them does.
 */
export default function AuthView() {
  const needsSetup = useGame((s) => s.needsSetup)
  const signIn = useGame((s) => s.signIn)
  const signUp = useGame((s) => s.signUp)
  const [mode, setMode] = useState<'in' | 'up'>(needsSetup || inviteFromUrl ? 'up' : 'in')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState(inviteFromUrl)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const message =
      mode === 'in'
        ? await signIn(username, password)
        : await signUp(username, password, invite.trim() || undefined)
    setBusy(false)
    if (message) setError(message)
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">ANICO</div>
        <p className="auth-tagline">
          {needsSetup
            ? 'A new instance. The first account created is the admin.'
            : mode === 'in'
              ? 'Sign in to this instance.'
              : 'Create an account with an invite from the admin.'}
        </p>

        <form onSubmit={submit} className="auth-form">
          <label>
            <span>Username</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </label>
          {mode === 'up' && !needsSetup && (
            <label>
              <span>Invite code</span>
              <input
                className="input"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="From the instance admin"
                required
              />
            </label>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'in' ? 'Sign in' : needsSetup ? 'Create the admin account' : 'Create account'}
          </button>
        </form>

        {!needsSetup && (
          <button
            className="auth-switch"
            onClick={() => {
              setMode(mode === 'in' ? 'up' : 'in')
              setError(null)
            }}
          >
            {mode === 'in' ? 'Have an invite? Create an account' : 'Already have an account? Sign in'}
          </button>
        )}
      </div>
    </div>
  )
}
