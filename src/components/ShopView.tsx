import { useState } from 'react'
import { useGame } from '../game/store'
import { BADGE_DEFS, BADGE_MAX, ROMAN, badgeCost, badgeUnlocked } from '../game/badges'
import { UPGRADE_DEFS, upgradeCost, upgradeMaxed } from '../game/upgrades'
import { RARITY_NAMES, packCost } from '../game/economy'
import { fmt, fmtCount } from '../game/format'
import Icon from './Icon'
import type { IconName } from '../game/icons'

/**
 * The shop.
 *
 * Two shelves, each in a fixed order, side by side where there is room and one
 * at a time where there is not.
 *
 * It was one list sorted by price, which sounded helpful and read as chaos:
 * every purchase re-sorted the grid, so the card you were about to buy moved,
 * and the thing you had been looking at a second ago was somewhere else. A
 * shop should be a place you learn the shape of. Badges and upgrades are also
 * different kinds of thing -- one ends, one does not -- and giving them the
 * same card made them look like one ladder with two naming conventions.
 */
type Shelf = 'upgrades' | 'badges'

export default function ShopView() {
  const s = useGame()
  const fx = s.effects()
  const priceMult = fx.priceMult
  const [shelf, setShelf] = useState<Shelf>('upgrades')

  const badgeReady = BADGE_DEFS.some((def) => {
    const level = s.badges[def.key]
    return (
      level < BADGE_MAX &&
      badgeUnlocked(def.key, s.badges) &&
      s.credits >= badgeCost(def, level + 1, priceMult)
    )
  })
  const upgradeReady = UPGRADE_DEFS.some((def) => {
    const level = s.upgrades[def.key] ?? 0
    return !upgradeMaxed(def, level) && s.credits >= upgradeCost(def, level, priceMult)
  })

  return (
    <div className="shop-view">
      {/* What the shop has bought so far, in the numbers that decide how fast
          the next thing arrives. Progress is meant to be visible: this is the
          scoreboard the prices below are climbing against. */}
      <dl className="shop-status">
        <div>
          <dt>A pack</dt>
          <dd>
            {fx.packSize > 0 ? (
              <>
                <b>{fmtCount(fx.packSize)}</b> cards for{' '}
                <b className="credits-text">{fmt(packCost(fx.packSize))}</b>
                {fx.packsPerPull > 1 && <> · {fx.packsPerPull} at a press</>}
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
                {fx.guaranteeCount > 1
                  ? `${fx.guaranteeCount} × `
                  : /^[AEIOU]/.test(RARITY_NAMES[fx.guaranteeRarity])
                    ? 'an '
                    : 'a '}
                <b className="credits-text">{RARITY_NAMES[fx.guaranteeRarity]}</b> in every pack
              </>
            ) : (
              <>None — <b>Emerald</b> promises a floor</>
            )}
          </dd>
        </div>
        <div>
          <dt>Sale value</dt>
          <dd>
            <b>{fmt(Math.round(fx.sellMult * 100))}%</b> of a card's worth
          </dd>
        </div>
        <div>
          <dt>Hands</dt>
          <dd>
            <b>{fx.cardRate}</b> cards a second
          </dd>
        </div>
        <div>
          <dt>The Automaton</dt>
          <dd>
            {fx.autoSpinMs > 0 ? (
              <>
                a press every <b>{(fx.autoSpinMs / 1000).toFixed(2)}s</b>
                {fx.offlineRate > 0 && <> · {Math.round(fx.offlineRate * 100)}% away</>}
              </>
            ) : (
              <>Not bought</>
            )}
          </dd>
        </div>
      </dl>

      {/* Only on narrow screens: wide ones show both shelves at once. */}
      <div className="shop-switch segmented" role="group" aria-label="Shop shelf">
        <button
          className={`seg ${shelf === 'upgrades' ? 'active' : ''}`}
          onClick={() => setShelf('upgrades')}
        >
          Upgrades {upgradeReady && <span className="ready-dot" aria-label="affordable" />}
        </button>
        <button
          className={`seg ${shelf === 'badges' ? 'active' : ''}`}
          onClick={() => setShelf('badges')}
        >
          Badges {badgeReady && <span className="ready-dot" aria-label="affordable" />}
        </button>
      </div>

      <div className={`shop-shelves show-${shelf}`}>
        <section className="panel shop-col col-upgrades">
          <h2 className="section-title">Upgrades</h2>
          <p className="section-sub">
            The curve. Six of these have no last level, and every level costs a fixed multiple
            of the one below it — so what you can afford next is the whole of the difficulty.
            The first few rungs are sold cheap on purpose.
            {priceMult < 1 && (
              <b className="credits-text"> Ruby is knocking {Math.round((1 - priceMult) * 100)}% off.</b>
            )}
          </p>
          <div className="upgrade-list">
            {UPGRADE_DEFS.map((def) => {
              const level = s.upgrades[def.key] ?? 0
              const maxed = upgradeMaxed(def, level)
              const cost = upgradeCost(def, level, priceMult)
              const affordable = !maxed && s.credits >= cost
              return (
                <article
                  className={`upgrade-card ${maxed ? 'maxed' : ''} ${affordable ? 'affordable' : ''}`}
                  key={def.key}
                >
                  <header className="upgrade-head">
                    <span className="upgrade-icon">
                      <Icon name={def.icon as IconName} className="icon-lg" />
                    </span>
                    <div className="upgrade-title">
                      <span className="upgrade-name">{def.name}</span>
                      <span className="upgrade-level">
                        {level > 0 ? `Level ${level}` : 'Not bought'}
                        {def.maxLevel ? ` of ${def.maxLevel}` : ' · endless'}
                      </span>
                    </div>
                  </header>
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
                    {maxed ? 'Complete' : `${fmt(cost)} credits`}
                  </button>
                </article>
              )
            })}
          </div>
        </section>

        <section className="panel shop-col col-badges">
          <h2 className="section-title">Credit Badges</h2>
          <p className="section-sub">
            The shape. Six short ladders of six rungs that decide what the game <i>is</i>:
            whether packs exist, how many wishes you may pin, what a pack promises. Sapphire,
            Ruby and Emerald want progress in the first three, or any two badges at IV.
          </p>
          <div className="badge-list">
            {BADGE_DEFS.map((def) => {
              const level = s.badges[def.key]
              const maxed = level >= BADGE_MAX
              const unlocked = badgeUnlocked(def.key, s.badges)
              const cost = maxed ? 0 : badgeCost(def, level + 1, priceMult)
              const affordable = !maxed && unlocked && s.credits >= cost
              return (
                <article
                  key={def.key}
                  className={`badge-card ${!unlocked ? 'locked' : ''} ${maxed ? 'maxed' : ''} ${affordable ? 'affordable' : ''}`}
                  style={{ ['--badge-color' as string]: def.color }}
                >
                  <header className="badge-head">
                    <span className="badge-medal">
                      <Icon name={def.icon as IconName} className="icon-lg" />
                    </span>
                    <div>
                      <div className="badge-name">
                        {def.name} {level > 0 && <span className="badge-level">{ROMAN[level]}</span>}
                      </div>
                      <div className="badge-pips">
                        {Array.from({ length: BADGE_MAX }, (_, i) => (
                          <span key={i} className={`pip ${i < level ? 'filled' : ''}`} />
                        ))}
                      </div>
                    </div>
                  </header>
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
                        : `Forge ${def.name} ${ROMAN[level + 1]} · ${fmt(cost)}`}
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
