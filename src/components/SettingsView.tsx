import { useState } from 'react'
import { useGame, useUi } from '../game/store'
import { RARITY_NAMES } from '../game/economy'
import { fmt, fmtCount } from '../game/format'
import { POOL_OPTIONS } from '../game/pool'
import { sfx } from '../game/sound'
import AdminPanel from './AdminPanel'
import type { RollGender } from '../game/types'
import type { ServerSettings } from '../api'

export default function SettingsView() {
  const settings = useGame((s) => s.settings)
  const packSize = useGame((s) => s.packSize)
  const packPrice = useGame((s) => s.packPrice)
  const sandbox = useGame((s) => s.sandbox)
  const isAdmin = useGame((s) => s.isAdmin)
  const ui = useUi()
  const effects = useGame((s) => s.effects)
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

  const fx = effects()

  return (
    <div className="settings-view">
      <div className="panel">
        <h2 className="section-title">Sound</h2>
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
            Card deals, coin handles and chimes. A pack deals every card in
            sequence. No music, nothing loops.
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

      <div className="panel">
        <h2 className="section-title">Rolling</h2>
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
          <p className="setting-hint">Who shows up when you roll. "Everyone" includes characters with unknown or non-binary gender.</p>
        </div>

        <div className="setting-row">
          <label>Character pool</label>
          <select
            className="input"
            value={settings.poolSize}
            onChange={(e) => update({ poolSize: Number(e.target.value) })}
          >
            {POOL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="setting-hint">
            Rolls draw from the instance's catalog, ranked by AniList favourites. The
            whole catalog is the default; a smaller pool keeps rolls to characters you
            are more likely to recognise.
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
            <option value="rare">Sell anything below Rare</option>
            <option value="epic">Sell anything below Epic</option>
            <option value="legendary">Sell anything below Legendary</option>
            <option value="mythic">Sell anything below Mythic</option>
          </select>
          <p className="setting-hint">
            Sells pulls as they land, so a pack of a hundred does not become a hundred
            things to tidy up. It never sells a wish come true, and never a stack that has
            started to merge — those are the two things worth keeping.
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
            Leave this off if you want to merge. A duplicate joins that character's stack,
            and every doubling of a stack merges it a star higher — worth far more sold
            whole than the copies ever were apart.
          </p>
        </div>
      </div>

      {/* What used to be two panels of timers: a mode switch and a pacing
          table. Neither has anything to say now that summoning and claiming
          cost nothing, so what is left is the one number the shop moves. */}
      <div className="panel">
        <h2 className="section-title">Summoning</h2>
        <p className="section-sub">
          Nothing is on a cooldown and nothing is rationed. Credits are the pacing: a
          single summon is free, and a pack costs what its cards are nearly worth.
        </p>
        <dl className="pacing-list">
          <div>
            <dt>Single summon</dt>
            <dd>free, always available, one card, yours to claim or leave</dd>
          </div>
          <div>
            <dt>Packs</dt>
            <dd>
              {packSize > 0
                ? `sealed, ×${fmtCount(packSize)} cards for ${fmt(packPrice)} credits, and every card in one is granted`
                : 'locked until the Sapphire badge in the shop opens them'}
            </dd>
          </div>
          <div>
            <dt>Pack guarantee</dt>
            <dd>
              {fx.guaranteeRarity
                ? `every pack holds a ${RARITY_NAMES[fx.guaranteeRarity]} or better (Emerald)`
                : 'none yet — the Emerald badge promises a rarity floor'}
            </dd>
          </div>
          <div>
            <dt>The Automaton</dt>
            <dd>
              {fx.autoSpinMs > 0
                ? `tears, swipes and presses again every ${(fx.autoSpinMs / 1000).toFixed(2)}s while it is switched on`
                : 'not bought — the shop sells a machine that presses the button for you'}
            </dd>
          </div>
          <div>
            <dt>Opening speed</dt>
            <dd>{fx.cardRate} cards a second (Swift Hands)</dd>
          </div>
          <div>
            <dt>Night shift</dt>
            <dd>
              {fx.offlineRate > 0
                ? `the Automaton keeps ${Math.round(fx.offlineRate * 100)}% of its speed with the tab closed, for up to ${fx.offlineHours} hours`
                : 'the machine stops when you close the tab — Night Shift in the shop changes that'}
            </dd>
          </div>
        </dl>
      </div>

      <div className={`panel ${sandbox ? 'panel-testing' : ''}`}>
        <h2 className="section-title">Sandbox</h2>
        {!sandboxAllowed ? (
          <div className="setting-row">
            <p className="setting-hint">
              Sandbox is off for your account. It is a privilege the instance admin grants,
              because the server enforces every limit it lifts.
            </p>
          </div>
        ) : (
          <>
            <p className="section-sub">
              A scratch profile with its own credits and its own empty collection. Nothing you
              do in it touches the collection you actually care about, and none of it is kept:
              switching back deletes it, and so does restarting the instance.
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
          </>
        )}
      </div>

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
                This erases your collection, credits, wishes and badges. There is no undo.
                Confirm with the username and password for this account.
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
                Erases your collection, credits, wishes and badges. There is no undo, so it asks
                for your password.
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
