import { useEffect, useState } from 'react'
import { api, type CatalogStatus, type Invite } from '../api'
import { useGame } from '../game/store'
import { POOL_OPTIONS } from '../game/pool'
import BackupPanel from './BackupPanel'

/**
 * How many people one link lets in.
 *
 * Zero is a standing link, which is the shape a group chat wants: one URL
 * pasted once, rather than the admin minting a code per person and then
 * working out which of six strangers used which.
 */
const SEAT_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1 use' },
  { value: 5, label: '5 uses' },
  { value: 25, label: '25 uses' },
  { value: 0, label: 'No limit' },
]

const linkFor = (code: string) => `${location.origin}/?invite=${encodeURIComponent(code)}`

/** What a link has left on it, in the words the row wants. */
function seats(i: Invite): string {
  if (i.revoked_at) return 'revoked'
  if (i.max_uses === 0) return `${i.uses} joined, no limit`
  const left = Math.max(0, i.max_uses - i.uses)
  if (left === 0) return `used up (${i.uses}/${i.max_uses})`
  return `${i.uses}/${i.max_uses} used`
}

/**
 * Instance administration, shown only to the admin account: who can join, who
 * has sandbox, and how the catalog crawl is getting on.
 */
export default function AdminPanel() {
  const pushToast = useGame((s) => s.pushToast)
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.adminUsers>>['users']>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [seatCount, setSeatCount] = useState(1)
  // The link most recently copied, so the row can say so rather than relying
  // on a toast the phone has been told not to show.
  const [copied, setCopied] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogStatus | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumping this re-runs the loader; it keeps the fetch inside the effect,
  // where the cleanup can stop a late response from setting state.
  const [nonce, setNonce] = useState(0)
  // The player whose sign-out is one click from happening, following the same
  // two-click pattern as the danger zone rather than a browser confirm().
  const [confirmSignOut, setConfirmSignOut] = useState<number | null>(null)
  const poolSize = useGame((s) => s.poolSize)
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

  /**
   * Put a link on the clipboard, and say so where it was asked for.
   *
   * `navigator.clipboard` is only there on a secure origin and can be refused
   * even then, so the link is always in a field on the row as well: the button
   * is the convenience, the field is the guarantee.
   */
  const copyLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(code))
      setCopied(code)
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 2500)
    } catch {
      pushToast('Could not reach the clipboard. Copy the link from the field.', 'alert')
    }
  }

  const newInvite = async () => {
    setBusy(true)
    const { invite } = await api.createInvite(seatCount).finally(() => setBusy(false))
    await copyLink(invite.code)
    refresh()
  }

  const signOutEverywhere = async (id: number, username: string) => {
    setConfirmSignOut(null)
    const { revoked } = await api.revokeSessions(id)
    // Revoking your own sessions is allowed and logs you out on the next call;
    // it is the honest way to end a session opened somewhere you no longer trust.
    pushToast(
      revoked === 0
        ? `${username} had no active sessions.`
        : `Signed ${username} out of ${revoked} ${revoked === 1 ? 'session' : 'sessions'}.`,
      'info',
    )
    refresh()
  }

  const mb = (bytes: number) =>
    bytes >= 1024 * 1024 * 1024
      ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
      : `${Math.max(1, Math.round(bytes / 1048576))} MB`

  const pct = catalog && catalog.total > 0 ? Math.round((catalog.page / catalog.total) * 100) : 0

  return (
    <div className="panel admin-panel">
      <h2 className="section-title">Instance</h2>
      <p className="section-sub">You are the admin of this instance.</p>

      {/* The one game rule an admin owns rather than a player: a narrow pool
          is a richer game, so it cannot be a personal preference. */}
      <div className="setting-row">
        <label>Character pool</label>
        <select
          className="input"
          value={poolSize}
          onChange={(e) => {
            const next = Number(e.target.value)
            void api.setPool(next).then(async () => {
              refresh()
              // The pool lives on the snapshot, so the whole app hears about it.
              await useGame.getState().refreshState()
              pushToast('Character pool updated for the whole instance.', 'info')
            })
          }}
        >
          {POOL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="setting-hint">
          How wide a net every roll on this instance casts, ranked by AniList favourites.
          The whole catalog is the default. A smaller pool means everybody meets characters
          they recognise, and everybody's cards are worth more.
        </p>
      </div>

      <div className="setting-row">
        <label>Catalog</label>
        {catalog ? (
          <>
            <div className="hp-bar catalog-bar" title={`step ${catalog.page} of ${catalog.total}`}>
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
          Rolls draw from this local catalog, so AniList is only reached while it fills. The
          crawl walks four sweeps (anime then manga, headline cast then supporting) because
          no single AniList query reaches past 5,000 entries. It is deliberately slow, takes
          a few hours from empty, and resumes where it left off across restarts.
        </p>
        {catalog && (
          <p className="setting-hint">
            Database {mb(catalog.bytes)} of a {mb(catalog.maxBytes)} ceiling. A full catalog
            settles well under 100 MB; the crawl stops rather than pass the ceiling.
          </p>
        )}
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
              <span className="admin-meta">
                {u.claims} claimed
                {u.sessions > 0 && `, ${u.sessions} signed in`}
              </span>
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
              {confirmSignOut === u.id ? (
                <div className="confirm-row">
                  <button
                    className="btn btn-danger admin-action"
                    onClick={() => void signOutEverywhere(u.id, u.username)}
                  >
                    Yes, end every session
                  </button>
                  <button className="btn btn-ghost admin-action" onClick={() => setConfirmSignOut(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-ghost admin-action"
                  disabled={u.sessions === 0}
                  onClick={() => setConfirmSignOut(u.id)}
                >
                  Sign out everywhere
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="setting-hint">
          Signing a player out ends every session they hold, on every device. It is the
          only way to take back a session token that has leaked.
        </p>
      </div>

      <div className="setting-row">
        <label>Invites</label>
        <div className="invite-new">
          <select
            className="input"
            value={seatCount}
            onChange={(e) => setSeatCount(Number(e.target.value))}
          >
            {SEAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button className="btn btn-quiet" onClick={newInvite} disabled={busy}>
            {busy ? 'Minting…' : 'Create an invite link'}
          </button>
        </div>
        <ul className="admin-list invite-list">
          {invites.map((i) => {
            const spent = !!i.revoked_at || (i.max_uses > 0 && i.uses >= i.max_uses)
            return (
              <li key={i.code} className={spent ? 'invite-spent' : ''}>
                {/* The whole link, not the code: what somebody pastes into a
                    chat is a URL, and the code alone made every admin build
                    one by hand. Read-only and selectable, so the clipboard
                    button is a convenience rather than the only way through. */}
                <input
                  className="input invite-link"
                  value={linkFor(i.code)}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={`Invite link ${i.code}`}
                />
                <span className="admin-meta invite-seats">{seats(i)}</span>
                {i.used_by.length > 0 && (
                  <span className="admin-meta invite-joined">{i.used_by.join(', ')}</span>
                )}
                {/* A link that cannot let anybody else in is a record, not a
                    control: nothing to copy and nothing left to withdraw. */}
                {!spent && (
                  <div className="confirm-row">
                    <button className="btn btn-ghost admin-action" onClick={() => void copyLink(i.code)}>
                      {copied === i.code ? 'Copied' : 'Copy link'}
                    </button>
                    <button
                      className="btn btn-ghost admin-action invite-revoke"
                      title="Withdraw this invite so the link stops working"
                      onClick={async () => {
                        await api.deleteInvite(i.code)
                        pushToast('Invite withdrawn. That link no longer works.', 'alert')
                        refresh()
                      }}
                    >
                      Withdraw
                    </button>
                  </div>
                )}
              </li>
            )
          })}
          {invites.length === 0 && <li className="admin-meta">No invites yet.</li>}
        </ul>
        <p className="setting-hint">
          Registration is closed to anyone without a link. A link can carry one seat or
          twenty-five, or none at all, in which case it lets anybody in until you withdraw
          it. Withdrawing a link nobody used deletes it; withdrawing one people joined
          through keeps the row, because it is the record of how those accounts exist.
        </p>
      </div>

      <BackupPanel />
    </div>
  )
}
