import { CONSUMABLES, useGame, type ConsumableKey } from '../game/store'
import { BADGE_DEFS, ROMAN, badgeCost, badgeUnlocked } from '../game/badges'

export default function ShopView() {
  const s = useGame()
  const discounted = s.badges.ruby >= 4

  return (
    <div className="shop-view">
      <div className="panel">
        <h2 className="section-title">Credit Badges</h2>
        <p className="section-sub">
          Mudae's badge tree, reforged. Bronze, Silver and Gold are open to all;
          Sapphire, Ruby and Emerald demand progress, or any two badges raised to IV.
          {discounted && <b className="credits-text"> Ruby IV discount active: −25% on all badges.</b>}
        </p>
        <div className="badge-grid">
          {BADGE_DEFS.map((def) => {
            const level = s.badges[def.key]
            const maxed = level >= 4
            const unlocked = badgeUnlocked(def.key, s.badges)
            const cost = maxed ? 0 : badgeCost(def, level + 1, discounted)
            const affordable = s.credits >= cost
            return (
              <div
                key={def.key}
                className={`badge-card ${!unlocked ? 'locked' : ''} ${maxed ? 'maxed' : ''}`}
                style={{ ['--badge-color' as string]: def.color }}
              >
                <div className="badge-head">
                  <span className="badge-medal" aria-hidden="true" />
                  <div>
                    <div className="badge-name">
                      {def.name} {level > 0 && <span className="badge-level">{ROMAN[level]}</span>}
                    </div>
                    <div className="badge-pips">
                      {[1, 2, 3, 4].map((i) => (
                        <span key={i} className={`pip ${i <= level ? 'filled' : ''}`} />
                      ))}
                    </div>
                  </div>
                </div>
                <ul className="badge-levels">
                  {def.levels.map((text, i) => (
                    <li key={i} className={i < level ? 'owned' : i === level ? 'next' : ''}>
                      <span className="lvl-roman">{ROMAN[i + 1]}</span> {text}
                    </li>
                  ))}
                </ul>
                {!unlocked && <div className="badge-req">🔒 {def.prereq}</div>}
                <button
                  className="btn btn-buy"
                  disabled={maxed || !unlocked || !affordable}
                  onClick={() => s.buyBadge(def.key)}
                >
                  {maxed ? 'Complete' : !unlocked ? 'Locked' : `Forge ${def.name} ${ROMAN[level + 1]} for ${cost.toLocaleString()} credits`}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">Offerings</h2>
        <p className="section-sub">One-shot items for the impatient.</p>
        <div className="item-grid">
          {(Object.keys(CONSUMABLES) as ConsumableKey[]).map((key) => {
            const item = CONSUMABLES[key]
            const unusable =
              key === 'rollRefill'
                ? s.rollsLeft >= s.maxRolls() || s.sandbox
                : s.claimReady()
            return (
              <div className="item-card" key={key}>
                <span className="item-icon">{item.icon}</span>
                <div className="item-body">
                  <div className="item-name">{item.name}</div>
                  <p className="item-desc">{item.description}</p>
                </div>
                <button
                  className="btn btn-buy"
                  disabled={s.credits < item.cost || unusable}
                  onClick={() => s.buyConsumable(key)}
                >
                  {unusable ? 'n/a' : `${item.cost.toLocaleString()} credits`}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
