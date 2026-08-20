import { useState } from 'react'
import { useGame, useUi } from '../game/store'
import { sfx } from '../game/sound'
import AdminPanel from './AdminPanel'
import type { RollGender } from '../game/types'

const POOL_OPTIONS = [
  { value: 1000, label: '~1,000 (household names only)' },
  { value: 5000, label: '~5,000 (popular characters)' },
  { value: 10000, label: '~10,000 (the standard pool)' },
  { value: 25000, label: '~25,000 (deep cuts included)' },
]

export default function SettingsView() {
  const settings = useGame((s) => s.settings)
  const maxRolls = useGame((s) => s.rollsMax)
  const multiSize = useGame((s) => s.multiSize)
  const sandbox = useGame((s) => s.sandbox)
  const isAdmin = useGame((s) => s.isAdmin)
  const ui = useUi()
  const badges = useGame((s) => s.badges)
  const effects = useGame((s) => s.effects)
  const update = useGame((s) => s.updateSettings)
  const resetSave = useGame((s) => s.resetSave)
  const grantCredits = useGame((s) => s.grantCredits)
  const pushToast = useGame((s) => s.pushToast)
  const [confirmReset, setConfirmReset] = useState(false)

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
            Card deals, coin handles and chimes. A ×10 summon deals all ten cards
            in sequence. No music, nothing loops.
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
          <p className="setting-hint">Rolls draw characters from the most popular series on AniList. Bigger pools reach deeper, more obscure series.</p>
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
          <p className="setting-hint">When off, duplicates pay 10% of the character's value{badges.silver >= 4 ? ' (20% with Silver IV)' : ''}.</p>
        </div>
      </div>

      {/* Pacing is the instance's, not the player's. It used to be three sliders,
          which on a shared instance just meant everyone set their own difficulty. */}
      <div className="panel">
        <h2 className="section-title">Pacing</h2>
        <p className="section-sub">
          The same for everyone on this instance. Summon more by earning it in the shop,
          not by moving a slider.
        </p>
        <dl className="pacing-list">
          <div>
            <dt>Single summon</dt>
            <dd>
              <b>{maxRolls}</b> per hour
              {fx.extraRolls > 0 && <span className="bonus"> (+{fx.extraRolls} from badges)</span>}
            </dd>
          </div>
          <div>
            <dt>×{multiSize} summon</dt>
            <dd>once a day, and it costs no hourly summons</dd>
          </div>
          <div>
            <dt>Claim</dt>
            <dd>once an hour</dd>
          </div>
        </dl>
        <p className="setting-hint">
          Sapphire and Ruby badges raise the hourly count. A Roll Refill tops it back up,
          and Claim Incense clears a claim cooldown early.
        </p>
      </div>

      <div className={`panel ${sandbox ? 'panel-testing' : ''}`}>
        <h2 className="section-title">Testing</h2>
        <div className="setting-row">
          <p className="setting-hint">
            {sandbox
              ? 'Sandbox is enabled for your account: unlimited rolls, no cooldowns, and bulk operations.'
              : 'Sandbox is off for your account. It is a privilege the instance admin grants, not a switch, because the server enforces every limit it lifts.'}
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

      <div className="panel">
        <h2 className="section-title">Danger zone</h2>
        <div className="setting-row">
          {confirmReset ? (
            <div className="confirm-row">
              <button
                className="btn btn-danger"
                onClick={() => {
                  resetSave()
                  setConfirmReset(false)
                }}
              >
                Yes, erase everything
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>
              Reset save data
            </button>
          )}
          <p className="setting-hint">Erases your collection, credits, wishes and badges. There is no undo.</p>
        </div>
      </div>

      {isAdmin && <AdminPanel />}

      <p className="attribution">
        Character data & images from <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>.
        Sound effects (CC0) from <a href="https://kenney.nl/assets" target="_blank" rel="noreferrer">Kenney</a>.
        A fan-made homage to Mudae's collecting loop.
      </p>
    </div>
  )
}
