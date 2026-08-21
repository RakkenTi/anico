import { useState } from 'react'
import { useGame, useUi } from '../game/store'
import { POOL_OPTIONS } from '../game/pool'
import { sfx } from '../game/sound'
import AdminPanel from './AdminPanel'
import type { RollGender, LayoutKey, ThemeKey } from '../game/types'
import type { ServerSettings } from '../api'

const THEMES: { key: ThemeKey; name: string; swatch: string[] }[] = [
  { key: 'arcade', name: 'Arcade', swatch: ['#0a0e12', '#2ac2a8', '#ffb454'] },
  { key: 'festival', name: 'Festival', swatch: ['#0b0d17', '#e04a35', '#d4af37'] },
  { key: 'daybreak', name: 'Daybreak', swatch: ['#f4ecda', '#c2402e', '#8a6d1a'] },
]

const LAYOUTS: { key: LayoutKey; name: string; note: string }[] = [
  { key: 'stage', name: 'Stage', note: 'Cards front and centre' },
  { key: 'classic', name: 'Classic', note: 'Plain and roomy' },
  { key: 'scroll', name: 'Scroll', note: 'Taller cards, softer edges' },
  { key: 'ledger', name: 'Ledger', note: 'Square corners, more per screen' },
]

/**
 * Settings.
 *
 * Three groups, in the order anybody looks for them: how the game plays, how it
 * looks, and the two things you would only do on purpose. What used to sit here
 * as well was a table of numbers the shop already shows, and the character pool,
 * which is not a preference (see `instancePool` on the server): a narrow pool is
 * a richer game, so it belongs to the instance and is set below by its admin.
 */
export default function SettingsView() {
  const settings = useGame((s) => s.settings)
  const poolSize = useGame((s) => s.poolSize)
  const sandbox = useGame((s) => s.sandbox)
  const isAdmin = useGame((s) => s.isAdmin)
  const ui = useUi()
  const update = useGame((s) => s.updateSettings)
  const resetSave = useGame((s) => s.resetSave)
  const grantCredits = useGame((s) => s.grantCredits)
  const pushToast = useGame((s) => s.pushToast)
  const sandboxAllowed = useGame((s) => s.sandboxAllowed)
  const setSandbox = useGame((s) => s.setSandbox)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetName, setResetName] = useState('')
  const [resetPass, setResetPass] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const closeReset = () => {
    setConfirmReset(false)
    setResetName('')
    setResetPass('')
    setResetError(null)
  }

  const pool = POOL_OPTIONS.find((o) => o.value === poolSize)

  return (
    <div className="settings-view">
      <div className="panel">
        <h2 className="section-title">Play</h2>

        <div className="setting-row">
          <label>Roll for</label>
          <div className="segmented">
            {(
              [
                ['female', '♀ Waifus'],
                ['male', '♂ Husbandos'],
                ['everyone', 'Everyone'],
              ] as [RollGender, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={`seg ${settings.rollGender === value ? 'active' : ''}`}
                onClick={() => {
                  update({ rollGender: value })
                  sfx.tap()
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="setting-hint">
            Who shows up when you summon. "Everyone" includes characters with unknown or
            non-binary gender.
          </p>
        </div>

        <div className="setting-row">
          <label>Auto-sell</label>
          <select
            className="input"
            value={settings.autoSell}
            onChange={(e) => update({ autoSell: e.target.value as ServerSettings['autoSell'] })}
          >
            <option value="off">Keep everything</option>
            <option value="rare">Sell below Rare</option>
            <option value="epic">Sell below Epic</option>
            <option value="legendary">Sell below Legendary</option>
            <option value="mythic">Sell below Mythic</option>
          </select>
          <p className="setting-hint">
            Cards below this rarity are marked for sale and sold when you next summon, so
            you have until then to lock anything you want to keep. Wishes and merged stacks
            are never sold.
          </p>
        </div>

        <div className="setting-row">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.skipOwned}
              onChange={(e) => update({ skipOwned: e.target.checked })}
            />
            <span>Skip characters I already own</span>
          </label>
          <p className="setting-hint">
            Leave this off if you want to merge. Duplicates stack, and every doubling merges
            a stack a star higher, which is worth far more than the copies were apart. It
            also closes the contract board: a pull with this on deals no duplicates, so no
            stack ever grows past ★0 and nothing on the board can be answered.
          </p>
        </div>

        <div className="setting-row">
          <label>Character pool</label>
          <p className="setting-hint">
            <b>{pool?.label ?? `Top ${poolSize.toLocaleString()}`}</b>. Set for the whole
            instance by its admin, because a smaller pool means better cards for everyone
            drawing from it.
          </p>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">Look and sound</h2>

        <div className="setting-row">
          <label>Theme</label>
          <div className="swatch-row">
            {THEMES.map((t) => (
              <button
                key={t.key}
                className={`theme-swatch ${ui.theme === t.key ? 'active' : ''}`}
                onClick={() => {
                  ui.set({ theme: t.key })
                  sfx.tap()
                }}
                title={t.name}
              >
                <span className="swatch-chips">
                  {t.swatch.map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </span>
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <label>Layout</label>
          <div className="segmented wrap">
            {LAYOUTS.map((l) => (
              <button
                key={l.key}
                className={`seg ${ui.layout === l.key ? 'active' : ''}`}
                onClick={() => {
                  ui.set({ layout: l.key })
                  sfx.tap()
                }}
                title={l.note}
              >
                {l.name}
              </button>
            ))}
          </div>
          <p className="setting-hint">
            {LAYOUTS.find((l) => l.key === ui.layout)?.note}. Themes only recolour; layouts
            change spacing, corners and how much fits on a screen.
          </p>
        </div>

        <div className="setting-row">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={ui.soundEnabled}
              onChange={(e) => {
                ui.set({ soundEnabled: e.target.checked })
                if (e.target.checked) sfx.daily()
              }}
            />
            <span>Sound effects</span>
          </label>
          <p className="setting-hint">
            Card deals, coins and chimes. No music, nothing loops.
          </p>
        </div>

        <div className="setting-row">
          <label>Volume: <b>{Math.round(ui.soundVolume * 100)}%</b></label>
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round(ui.soundVolume * 100)}
            disabled={!ui.soundEnabled}
            onChange={(e) => ui.set({ soundVolume: Number(e.target.value) / 100 })}
            onPointerUp={() => sfx.payout()}
            onKeyUp={() => sfx.payout()}
          />
        </div>
      </div>

      {sandboxAllowed && (
        <div className={`panel ${sandbox ? 'panel-testing' : ''}`}>
          <h2 className="section-title">Sandbox</h2>
          <p className="section-sub">
            A scratch profile with its own credits and its own empty collection. Nothing you
            do in it touches the collection you care about, and none of it is kept: switching
            back deletes it, and so does restarting the instance.
          </p>
          <div className="setting-row">
            <button
              className={`btn ${sandbox ? 'btn-danger' : 'btn-primary'}`}
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
            <div className="setting-row">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  grantCredits(1000)
                  pushToast('+1000 credits (sandbox)', 'credits')
                }}
              >
                +1000 credits (debug)
              </button>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <h2 className="section-title">Danger zone</h2>
        <div className="setting-row">
          {confirmReset ? (
            /* Typing the account's own credentials, rather than clicking twice:
               this erases a collection built over weeks and cannot be undone. */
            <form
              className="reset-confirm"
              onSubmit={async (e) => {
                e.preventDefault()
                if (resetting) return
                setResetting(true)
                setResetError(null)
                const failure = await resetSave(resetName, resetPass)
                setResetting(false)
                if (failure) setResetError(failure)
                else closeReset()
              }}
            >
              <p className="reset-warn">
                This erases your collection, credits, wishes and everything the shop sold
                you. There is no undo. Confirm with the username and password for this
                account.
              </p>
              <input
                type="text"
                autoComplete="username"
                placeholder="Username"
                value={resetName}
                onChange={(e) => setResetName(e.target.value)}
              />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={resetPass}
                onChange={(e) => setResetPass(e.target.value)}
              />
              {resetError && <p className="reset-error">{resetError}</p>}
              <div className="confirm-row">
                <button
                  className="btn btn-danger"
                  disabled={resetting || !resetName.trim() || !resetPass}
                >
                  {resetting ? 'Erasing…' : 'Erase everything'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={closeReset}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>
                Reset save data
              </button>
              <p className="setting-hint">
                Erases your collection, credits, wishes, badges and upgrades. There is no
                undo, so it asks for your password.
              </p>
            </>
          )}
        </div>
      </div>

      {isAdmin && <AdminPanel />}

      <p className="version-line">
        Anico <b>v{__APP_VERSION__}</b>
      </p>

      <p className="attribution">
        Character data & images from <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>.
        Icons and sound effects (CC0) from <a href="https://kenney.nl/assets" target="_blank" rel="noreferrer">Kenney</a>.
        An unaffiliated fan project.
      </p>
    </div>
  )
}
