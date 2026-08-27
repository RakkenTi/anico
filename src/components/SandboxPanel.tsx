import { useState } from 'react'
import { useGame } from '../game/store'
import { SANDBOX_STAGES } from '../game/sandbox'
import { fmt, fmtCount } from '../game/format'

/**
 * The sandbox, and the controls for putting it somewhere.
 *
 * The sandbox used to be one switch and a button that granted a thousand
 * credits, which was a whole afternoon's play in the version that shipped it
 * and is a rounding error against a ten-billion-credit upgrade. Testing the
 * late game meant playing to it.
 *
 * A stage seeds the shadow profile and then stops: the summon it presses is
 * the summon everybody else presses. Nothing here is a mode.
 */
export default function SandboxPanel() {
  const sandbox = useGame((s) => s.sandbox)
  const setSandbox = useGame((s) => s.setSandbox)
  const applyStage = useGame((s) => s.applyStage)
  const setSandboxCredits = useGame((s) => s.setSandboxCredits)
  const stockSandbox = useGame((s) => s.stockSandbox)
  const pushToast = useGame((s) => s.pushToast)
  const [busy, setBusy] = useState<string | null>(null)
  const [credits, setCredits] = useState('1e12')
  const [count, setCount] = useState('20000')
  const [copies, setCopies] = useState('4096')

  /* Every control is a round trip that rewrites the profile, so they are
     disabled together while one is in flight rather than each on its own. */
  const run = async (label: string, fn: () => Promise<void>, done: string) => {
    setBusy(label)
    try {
      await fn()
      pushToast(done, 'credits')
    } finally {
      setBusy(null)
    }
  }

  const num = (s: string) => {
    const n = Number(s)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  return (
    <div className={`panel ${sandbox ? 'panel-testing' : ''}`}>
      <h2 className="section-title">Sandbox</h2>
      <p className="section-sub">
        A scratch profile with its own collection and its own credits. Nothing you do in
        it touches the collection you care about, and none of it is kept: switching back
        deletes it, and so does restarting the instance.
      </p>

      <div className="setting-row">
        <button
          className={`btn ${sandbox ? 'btn-danger' : 'btn-primary'}`}
          disabled={busy !== null}
          onClick={() => void setSandbox(!sandbox)}
        >
          {sandbox ? 'Leave the sandbox' : 'Enter the sandbox'}
        </button>
        <p className="setting-hint">
          {sandbox
            ? 'You are in the sandbox now. Your own collection is untouched and waiting.'
            : 'Your collection stays exactly as it is while you are in there.'}
        </p>
      </div>

      {sandbox && (
        <>
          <div className="setting-row">
            <label>Stage</label>
            <p className="setting-hint">
              Replaces the shop and the collection outright. Apply one as often as you
              like; it is the thing you are in here to do.
            </p>
            <div className="stage-grid">
              {SANDBOX_STAGES.map((s) => (
                <button
                  key={s.key}
                  className="btn btn-ghost stage-btn"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(s.key, () => applyStage(s.key), `Sandbox is at ${s.name}.`)
                  }
                >
                  <b>{busy === s.key ? 'Seeding…' : s.name}</b>
                  <span>{s.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="setting-row">
            <label>Credits</label>
            <div className="stage-inline">
              <input
                type="text"
                className="input"
                inputMode="decimal"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                aria-label="Credits to set"
              />
              <button
                className="btn btn-ghost"
                disabled={busy !== null || num(credits) === null}
                onClick={() => {
                  const n = num(credits)
                  if (n === null) return
                  void run('credits', () => setSandboxCredits(n), `Credits set to ${fmt(n)}.`)
                }}
              >
                Set
              </button>
            </div>
            <p className="setting-hint">
              Set, not added. Accepts <code>1e12</code>. Capped at what a double counts
              exactly, which is about 9.0Qa.
            </p>
          </div>

          <div className="setting-row">
            <label>Collection</label>
            <div className="stage-inline">
              <input
                type="text"
                className="input"
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                aria-label="Characters to hold"
              />
              <span className="stage-x">characters at</span>
              <input
                type="text"
                className="input"
                inputMode="numeric"
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
                aria-label="Copies of each"
              />
              <span className="stage-x">copies</span>
              <button
                className="btn btn-ghost"
                disabled={busy !== null || num(count) === null || num(copies) === null}
                onClick={() => {
                  const n = num(count)
                  const c = num(copies)
                  if (n === null || c === null) return
                  void run(
                    'stock',
                    () => stockSandbox(n, c),
                    n === 0 ? 'Collection emptied.' : `Holding ${fmtCount(n)} characters.`,
                  )
                }}
              >
                {busy === 'stock' ? 'Stocking…' : 'Stock'}
              </button>
            </div>
            <p className="setting-hint">
              Topped up rather than reset, so stocking twice deepens what is there. Two
              thirds are merged to the star those copies buy and the rest are left
              shallow, because a contract wants a breadth of a series at a depth and a
              collection of singles answers nothing. Zero empties it.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
