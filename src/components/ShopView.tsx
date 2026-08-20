import { useGame } from '../game/store'
import { BADGE_DEFS, ROMAN, badgeCost, badgeUnlocked } from '../game/badges'
import { UPGRADE_DEFS, upgradeCost, upgradeMaxed } from '../game/upgrades'
import { RARITY_NAMES, packCost } from '../game/economy'
import Icon from './Icon'
import type { IconName } from '../game/icons'

export default function ShopView() {
  const s = useGame()
  const discounted = s.badges.ruby >= 4
  const fx = s.effects()

  return (
    <div className="shop-view">
      {/* What the shop has bought so far, in the four numbers that decide how
          fast the next thing arrives. Progress is meant to be visible: this is
          the scoreboard the prices below are climbing against. */}
      <dl className="shop-status">
        <div>
          <dt>Pack</dt>
          <dd>
            {fx.packSize > 0 ? (
              <>
                <b>×{fx.packSize}</b> cards for{' '}
                <b className="credits-text">{packCost(fx.packSize).toLocaleString()}</b>
              </>
            ) : (
              <>Locked — <b>Sapphire I</b> opens packs</>
            )}
          </dd>
        </div>
        <div>
          <dt>Guarantee</dt>
          <dd>
            {fx.guaranteeRarity ? (
              <>
                a <b className="credits-text">{RARITY_NAMES[fx.guaranteeRarity]}</b> in every pack
              </>
            ) : (
              <>None — <b>Emerald</b> promises a floor</>
            )}
          </dd>
        </div>
        <div>
          <dt>Sale value</dt>
          <dd>
            <b>{Math.round(fx.sellMult * 100)}%</b> of a card's worth
          </dd>
        </div>
        <div>
          <dt>Opening speed</dt>
          <dd>
            <b>{Math.round(100 / fx.hasteMult)}%</b> of normal
          </dd>
        </div>
      </dl>

      <div className="panel">
        <h2 className="section-title">Upgrades</h2>
        <p className="section-sub">
          No last level worth reaching: each one costs a good deal more than the one before
          it, so what you can afford next is the whole of the difficulty curve.
          {discounted && <b className="credits-text"> Ruby IV is knocking 25% off.</b>}
        </p>
        <div className="upgrade-grid">
          {UPGRADE_DEFS.map((def) => {
            const level = s.upgrades[def.key] ?? 0
            const maxed = upgradeMaxed(def, level)
            const cost = upgradeCost(def, level, discounted)
            const affordable = s.credits >= cost
            return (
              <div className={`upgrade-card ${maxed ? 'maxed' : ''}`} key={def.key}>
                <div className="upgrade-head">
                  <Icon name={def.icon as IconName} className="icon-lg" />
                  <div className="upgrade-title">
                    <span className="upgrade-name">{def.name}</span>
                    <span className="upgrade-level">
                      {level > 0 ? `Level ${level}` : 'Not bought'}
                      {maxed && ' · maxed'}
                    </span>
                  </div>
                </div>
                <p className="upgrade-blurb">{def.blurb}</p>
                <p className="upgrade-effect">
                  <span className="now">Now:</span> {def.effect(level)}
                  {!maxed && (
                    <>
                      <br />
                      <span className="next">Next:</span> {def.effect(level + 1)}
                    </>
                  )}
                </p>
                <button
                  className="btn btn-buy"
                  disabled={maxed || !affordable}
                  onClick={() => s.buyUpgrade(def.key)}
                >
                  {maxed ? 'Complete' : `${cost.toLocaleString()} credits`}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">Credit Badges</h2>
        <p className="section-sub">
          Six short ladders, each rung three times the last. Bronze, Silver and Gold are open
          to all; Sapphire, Ruby and Emerald demand progress in the first three, or any two
          badges raised to IV.
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
                  <span className="badge-medal">
                    <Icon name={def.icon as IconName} className="icon-lg" />
                  </span>
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
                  {maxed
                    ? 'Complete'
                    : !unlocked
                      ? 'Locked'
                      : `Forge ${def.name} ${ROMAN[level + 1]} · ${cost.toLocaleString()} credits`}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
