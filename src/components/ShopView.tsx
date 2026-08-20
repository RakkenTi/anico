import { useGame } from '../game/store'
import { BADGE_DEFS, ROMAN, badgeCost, badgeUnlocked } from '../game/badges'
import { RARITY_NAMES } from '../game/economy'

export default function ShopView() {
  const s = useGame()
  const discounted = s.badges.ruby >= 4
  const fx = s.effects()

  return (
    <div className="shop-view">
      <div className="panel">
        <h2 className="section-title">Credit Badges</h2>
        <p className="section-sub">
          Everything credits are for. Bronze, Silver and Gold are open to all; Sapphire,
          Ruby and Emerald demand progress in the first three, or any two badges raised
          to IV.
          {discounted && <b className="credits-text"> Ruby IV discount active: −25% on all badges.</b>}
        </p>
        {/* The two things a badge can buy that the game does not simply give
            away, said plainly before the tree: how many cards a pull is worth,
            and how good one of them is promised to be. */}
        <dl className="shop-status">
          <div>
            <dt>Pack size</dt>
            <dd>
              {fx.packSize > 0 ? (
                <>
                  <b>×{fx.packSize}</b> cards a pack, every one of them yours
                </>
              ) : (
                <>Locked — <b>Sapphire I</b> opens packs</>
              )}
            </dd>
          </div>
          <div>
            <dt>Pack guarantee</dt>
            <dd>
              {fx.guaranteeRarity ? (
                <>
                  every pack holds a{' '}
                  <b className="credits-text">{RARITY_NAMES[fx.guaranteeRarity]}</b> or better
                </>
              ) : (
                <>None — <b>Emerald</b> promises a rarity floor</>
              )}
            </dd>
          </div>
        </dl>
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
    </div>
  )
}
