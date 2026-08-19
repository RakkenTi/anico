import { useState } from 'react'
import { useGame } from '../game/store'
import { sfx } from '../game/sound'
import type { RollGender } from '../game/types'

const POOL_OPTIONS = [
  { value: 1000, label: '~1,000 (household names only)' },
  { value: 5000, label: '~5,000 (popular characters)' },
  { value: 10000, label: '~10,000 (the standard pool)' },
  { value: 25000, label: '~25,000 (deep cuts included)' },
]

export default function SettingsView() {
  const settings = useGame((s) => s.settings)
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
              checked={settings.soundEnabled}
              onChange={(e) => {
                update({ soundEnabled: e.target.checked })
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
          <label>Volume: <b>{Math.round(settings.soundVolume * 100)}%</b></label>
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round(settings.soundVolume * 100)}
            disabled={!settings.soundEnabled}
            onChange={(e) => update({ soundVolume: Number(e.target.value) / 100 })}
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

      <div className="panel">
        <h2 className="section-title">Pacing</h2>
        <div className="setting-row">
          <label>
            Rolls per reset: <b>{settings.rollsPerReset}</b>
            {fx.extraRolls > 0 && <span className="bonus"> (+{fx.extraRolls} from badges)</span>}
          </label>
          <input
            type="range" min={3} max={30} step={1}
            value={settings.rollsPerReset}
            onChange={(e) => update({ rollsPerReset: Number(e.target.value) })}
          />
        </div>
        <div className="setting-row">
          <label>Roll reset interval: <b>{settings.rollResetMinutes} min</b></label>
          <input
            type="range" min={10} max={180} step={5}
            value={settings.rollResetMinutes}
            onChange={(e) => update({ rollResetMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="setting-row">
          <label>Claim cooldown: <b>{settings.claimIntervalMinutes} min</b></label>
          <input
            type="range" min={15} max={360} step={15}
            value={settings.claimIntervalMinutes}
            onChange={(e) => update({ claimIntervalMinutes: Number(e.target.value) })}
          />
          <p className="setting-hint">Interval changes apply to your next claim, not one already on cooldown.</p>
        </div>
      </div>

      <div className={`panel ${settings.testingMode ? 'panel-testing' : ''}`}>
        <h2 className="section-title">Testing</h2>
        <div className="setting-row">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.testingMode}
              onChange={(e) => update({ testingMode: e.target.checked })}
            />
            <span>Sandbox mode (skip all restrictions)</span>
          </label>
          <p className="setting-hint">
            Unlimited rolls, no claim cooldown, daily offering always available.
            For testing the loop; saves normally otherwise.
          </p>
        </div>
        {settings.testingMode && (
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

      <p className="attribution">
        Character data & images from <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>.
        Sound effects (CC0) from <a href="https://kenney.nl/assets" target="_blank" rel="noreferrer">Kenney</a>.
        A fan-made homage to Mudae's collecting loop.
      </p>
    </div>
  )
}
