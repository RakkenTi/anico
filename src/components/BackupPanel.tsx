import { useEffect, useState } from 'react'
import { api, backupUrl, type BackupConfig, type BackupFile } from '../api'
import { useGame } from '../game/store'

/**
 * Backups, for the admin.
 *
 * The instance copies its player data on a timer into a directory beside the
 * database, which on the compose file's bind mount means a directory on the
 * host you can rsync somewhere else. This is the dial for how often and how
 * many, plus the two things you want at three in the morning: a copy you can
 * download, and a way to put one back.
 */

const INTERVALS: { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Hourly' },
  { value: 6, label: 'Every 6 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Daily' },
  { value: 168, label: 'Weekly' },
]

const KEEPS = [5, 10, 25, 50, 100, 200].map((n) => ({ value: n, label: `${n} backups` }))
const CEILINGS = [
  { value: 256 * 1024 ** 2, label: '256 MB' },
  { value: 512 * 1024 ** 2, label: '512 MB' },
  { value: 1024 ** 3, label: '1 GB' },
  { value: 5 * 1024 ** 3, label: '5 GB' },
  { value: 20 * 1024 ** 3, label: '20 GB' },
]

const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`

// Seconds included: several backups a minute apart is the normal shape of a
// bad afternoon, and three rows all reading 06:49 PM tell you nothing.
const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

/**
 * The options for a value, with the value itself in them.
 *
 * A `select` whose value matches no option quietly shows the first one, which
 * is a control lying about the setting it is meant to be reporting. These
 * numbers can also arrive from the API, where the choices are wider.
 */
function withCurrent<T extends { value: number; label: string }>(options: T[], current: number, label: (n: number) => string) {
  if (options.some((o) => o.value === current)) return options
  return [...options, { value: current, label: label(current) }].sort((a, b) => a.value - b.value)
}

const WHY: Record<BackupFile['reason'], string> = {
  auto: 'on the timer',
  manual: 'by hand',
  safety: 'before a restore',
}

export default function BackupPanel() {
  const pushToast = useGame((s) => s.pushToast)
  const [config, setConfig] = useState<BackupConfig | null>(null)
  const [files, setFiles] = useState<BackupFile[]>([])
  const [bytes, setBytes] = useState(0)
  const [busy, setBusy] = useState(false)
  const [absent, setAbsent] = useState(false)
  /** The backup one password away from replacing everybody's progress. */
  const [restoring, setRestoring] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Bumping this re-runs the loader, which keeps the fetch inside the effect
  // where the cleanup can stop a late response from setting state.
  const [nonce, setNonce] = useState(0)
  const load = () => setNonce((n) => n + 1)

  useEffect(() => {
    let alive = true
    api
      .backups()
      .then((got) => {
        if (!alive) return
        setConfig(got.config)
        setFiles(got.files)
        setBytes(got.bytes)
      })
      // 501 from a build with nowhere to write. Nothing is wrong; there is
      // just nothing here.
      .catch(() => alive && setAbsent(true))
    return () => {
      alive = false
    }
  }, [nonce])

  if (absent) return null

  const patch = async (next: Partial<BackupConfig>) => {
    const got = await api.setBackupConfig(next)
    setConfig(got.config)
    load()
  }

  const takeOne = async () => {
    setBusy(true)
    try {
      const got = await api.takeBackup()
      setFiles(got.files)
      pushToast(`Backed up: ${size(got.file.bytes)}.`, 'alert')
      load()
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'The backup failed.', 'alert')
    } finally {
      setBusy(false)
    }
  }

  const restore = async (name: string) => {
    setBusy(true)
    setError(null)
    try {
      const got = await api.restoreBackup(name, password)
      pushToast(`Restored ${got.players} player(s). Everyone has been signed out.`, 'alert')
      setRestoring(null)
      setPassword('')
      // Every account's state, including this one's, is somebody else's now.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The restore failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setting-row">
      <label>Backups</label>
      <p className="setting-hint">
        A copy of the player data, beside the database. The catalog is left out on purpose:
        it is tens of thousands of characters that AniList will hand back, and copying it
        fifty times would spend the whole ceiling on the one part nobody would miss. The
        cards people actually own travel with the file, so a restore onto a bare machine
        shows a collection straight away.
      </p>

      <div className="backup-config">
        <label className="backup-field">
          <span>How often</span>
          <select
            className="input"
            value={config?.intervalHours ?? 6}
            onChange={(e) => void patch({ intervalHours: Number(e.target.value) })}
          >
            {withCurrent(INTERVALS, config?.intervalHours ?? 6, (n) => `Every ${n} hours`).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="backup-field">
          <span>Keep at most</span>
          <select
            className="input"
            value={config?.keep ?? 50}
            onChange={(e) => void patch({ keep: Number(e.target.value) })}
          >
            {withCurrent(KEEPS, config?.keep ?? 50, (n) => `${n} backups`).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="backup-field">
          <span>Size ceiling</span>
          <select
            className="input"
            value={config?.maxBytes ?? 1024 ** 3}
            onChange={(e) => void patch({ maxBytes: Number(e.target.value) })}
          >
            {withCurrent(CEILINGS, config?.maxBytes ?? 1024 ** 3, size).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="setting-hint">
        The oldest go first, by count and then by size, and five are always kept whatever
        the ceiling says: a limit that can empty the directory is not a limit. Currently{' '}
        <b>{files.length} on disk, {size(bytes)}</b>.
      </p>

      <button className="btn btn-quiet" onClick={takeOne} disabled={busy}>
        {busy ? 'Working…' : 'Back up now'}
      </button>

      <ul className="admin-list backup-list">
        {files.map((f) => (
          <li key={f.name}>
            <span className="backup-when">{when(f.at)}</span>
            <span className="admin-meta">
              {size(f.bytes)} · {WHY[f.reason]}
            </span>
            <div className="confirm-row">
              {/* An anchor, not a fetch: the browser is better at saving a
                  file than this page would be at holding one in memory. */}
              <a className="btn btn-ghost admin-action" href={backupUrl(f.name)} download>
                Download
              </a>
              <button
                className="btn btn-ghost admin-action"
                onClick={() => {
                  setRestoring(f.name)
                  setPassword('')
                  setError(null)
                }}
              >
                Restore
              </button>
              <button
                className="btn btn-ghost admin-action invite-revoke"
                onClick={async () => {
                  const got = await api.deleteBackup(f.name)
                  setFiles(got.files)
                  load()
                }}
              >
                Delete
              </button>
            </div>

            {restoring === f.name && (
              /* The most destructive control in the app: it replaces every
                 account, not just this one. Same shape as erasing a save,
                 because it is the same size of mistake. */
              <form
                className="reset-confirm"
                onSubmit={(e) => {
                  e.preventDefault()
                  void restore(f.name)
                }}
              >
                <p className="reset-warn">
                  This replaces <b>every</b> player's collection, credits and purchases with
                  the contents of this file, and signs everybody out. A copy of the current
                  state is taken first. Confirm with your password.
                </p>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {error && <p className="reset-error">{error}</p>}
                <div className="confirm-row">
                  <button className="btn btn-danger" disabled={busy || !password}>
                    {busy ? 'Restoring…' : 'Restore this backup'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setRestoring(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
        {files.length === 0 && <li className="admin-meta">No backups yet.</li>}
      </ul>
    </div>
  )
}
