import { useEffect, useState } from 'react'
import { api, type CatalogStatus } from '../api'
import { useGame } from '../game/store'

/**
 * Instance administration, shown only to the admin account: who can join, who
 * has sandbox, and how the catalog crawl is getting on.
 */
export default function AdminPanel() {
  const pushToast = useGame((s) => s.pushToast)
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.adminUsers>>['users']>([])
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof api.adminInvites>>['invites']>([])
  const [catalog, setCatalog] = useState<CatalogStatus | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumping this re-runs the loader; it keeps the fetch inside the effect,
  // where the cleanup can stop a late response from setting state.
  const [nonce, setNonce] = useState(0)
  const refresh = () => setNonce((n) => n + 1)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [u, i, c] = await Promise.all([
        api.adminUsers().catch(() => ({ users: [] })),
        api.adminInvites().catch(() => ({ invites: [] })),
        api.catalog().catch(() => null),
      ])
      if (!alive) return
      setUsers(u.users)
      setInvites(i.invites)
      setCatalog(c)
    }
    void load()
    // The crawl moves slowly; polling its status every few seconds is plenty.
    const id = setInterval(() => {
      void api
        .catalog()
        .then((c) => alive && setCatalog(c))
        .catch(() => {})
    }, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [nonce])

  const newInvite = async () => {
    setBusy(true)
    const { code } = await api.createInvite()
    setBusy(false)
    await navigator.clipboard
      ?.writeText(`${location.origin}/?invite=${code}`)
      .then(() => pushToast('Invite link copied to the clipboard.', 'info'))
      .catch(() => pushToast(`Invite code: ${code}`, 'info'))
    refresh()
  }

  const pct = catalog && catalog.total > 0 ? Math.round((catalog.page / catalog.total) * 100) : 0

  return (
    <div className="panel admin-panel">
      <h2 className="section-title">Instance</h2>
      <p className="section-sub">You are the admin of this instance.</p>

      <div className="setting-row">
        <label>Catalog</label>
        {catalog ? (
          <>
            <div className="hp-bar catalog-bar" title={`${catalog.page} of ${catalog.total} pages`}>
              <div className="catalog-fill" style={{ width: `${catalog.done ? 100 : pct}%` }} />
              <span className="catalog-text">
                {catalog.characters.toLocaleString()} characters
                {catalog.done ? ' (complete)' : catalog.running ? ` (crawling, ${pct}%)` : ' (paused)'}
              </span>
            </div>
            {catalog.error && <p className="setting-hint">Last error: {catalog.error}</p>}
          </>
        ) : (
          <p className="setting-hint">Status unavailable.</p>
        )}
        <p className="setting-hint">
          Rolls draw from this local catalog, so AniList is only reached while it fills.
        </p>
        <button
          className="btn btn-ghost"
          onClick={() => void api.recrawl().then(() => pushToast('Catalog refresh started.', 'info'))}
        >
          Refresh the catalog
        </button>
      </div>

      <div className="setting-row">
        <label>Players</label>
        <ul className="admin-list">
          {users.map((u) => (
            <li key={u.id}>
              <span className="admin-name">
                {u.username}
                {!!u.is_admin && <span className="admin-tag">admin</span>}
              </span>
              <span className="admin-meta">{u.claims} claimed</span>
              <label className="toggle-row admin-toggle">
                <input
                  type="checkbox"
                  checked={!!u.sandbox}
                  onChange={async (e) => {
                    await api.setSandbox(u.id, e.target.checked)
                    refresh()
                  }}
                />
                <span>sandbox</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="setting-row">
        <label>Invites</label>
        <button className="btn btn-quiet" onClick={newInvite} disabled={busy}>
          Create an invite link
        </button>
        <ul className="admin-list">
          {invites.map((i) => (
            <li key={i.code}>
              <code className="invite-code">{i.code}</code>
              <span className="admin-meta">
                {i.used_by ? `used by ${i.used_by}` : 'unused'}
              </span>
            </li>
          ))}
          {invites.length === 0 && <li className="admin-meta">No invites yet.</li>}
        </ul>
        <p className="setting-hint">
          Each invite works once. Registration is closed to anyone without one.
        </p>
      </div>
    </div>
  )
}
