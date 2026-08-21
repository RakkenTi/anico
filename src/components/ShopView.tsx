import { useState, Fragment } from 'react'
import { useGame } from '../game/store'
import { BADGE_DEFS, BADGE_MAX, ROMAN, badgeCost, badgeUnlocked } from '../game/badges'
import { UPGRADE_DEFS, WORKS_KEYS, upgradeCost, upgradeMaxed } from '../game/upgrades'
import { RARITY_NAMES, packCost } from '../game/economy'
import { fmt, fmtCount } from '../game/format'
import Icon from './Icon'
import type { IconName } from '../game/icons'

/**
 * The shop.
 *
 * Rows, not cards. Fifteen things are for sale and a player checks all of them
 * every time they have money, so the whole list wants to be on one screen: the
 * card version was three hundred pixels a purchase and turned "what can I
 * afford" into a scrolling exercise. Each row carries the four things that
 * decide a purchase (what it is, where it stands, what the next level does,
 * what it costs); everything else is behind the arrow on the right.
 *
 * Rows never re-order. Sorting by price meant the thing you were reaching for
 * moved the moment you bought something else.
 */
type Shelf = 'upgrades' | 'badges'

export default function ShopView() {
  const s = useGame()
  const fx = s.effects()
  const priceMult = fx.priceMult
  const [shelf, setShelf] = useState<Shelf>('upgrades')
  const [open, setOpen] = useState<string | null>(null)

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
      {/* Where the shop has got you so far. */}
      <dl className="shop-status">
        <div>
          <dt>Pack</dt>
          <dd>
            {fx.packSize > 0 ? (
              <>
                <b>{fmtCount(fx.packSize)}</b> cards, <b className="credits-text">{fmt(packCost(fx.packSize))}</b>
                {fx.packsPerPull > 1 && <> ({fx.packsPerPull} at a press)</>}
              </>
            ) : (
              <>Locked. <b>Sapphire I</b> opens packs</>
            )}
          </dd>
        </div>
        <div>
          <dt>Guarantee</dt>
          <dd>
            {fx.guaranteeRarity ? (
              /* "or better" reads as a bonus and this is the opposite: past a
                 few wrappers there are no Mythics left in the world to deal,
                 and the wrapper is filled from the next tier down instead. */
              <span title="Falls to the next tier down when the catalog has no more of them">
                <b className="credits-text">
                  {fx.guaranteeCount > 1 ? `${fx.guaranteeCount} ` : ''}
                  {RARITY_NAMES[fx.guaranteeRarity]}
                </b>{' '}
                per pack, or the best left
              </span>
            ) : (
              <>None yet</>
            )}
          </dd>
        </div>
        <div>
          <dt>Sell value</dt>
          <dd>
            <b>{fmt(Math.round(fx.sellMult * 100))}%</b>
          </dd>
        </div>
        <div>
          <dt>Open speed</dt>
          <dd>
            <b>{fmtCount(fx.cardRate)}</b> cards/sec
          </dd>
        </div>
        <div>
          <dt>Auto summon</dt>
          <dd>
            {fx.autoSpinMs > 0 ? (
              <>
                <b>{(fx.autoSpinMs / 1000).toFixed(2)}s</b>
                {fx.offlineRate > 0 && <> ({Math.round(fx.offlineRate * 100)}% offline)</>}
              </>
            ) : (
              <>Not bought</>
            )}
          </dd>
        </div>
      </dl>

      {/* Narrow screens show one shelf at a time; wide ones show both. */}
      <div className="shop-switch segmented" role="group" aria-label="Shop section">
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
        <section className="shop-col col-upgrades">
          <header className="shelf-head">
            <h2>Upgrades</h2>
            <p>
              Buy levels to raise your rates. Most have no maximum level, and every level
              costs more than the last.
              {priceMult < 1 && (
                <b className="credits-text"> Ruby: {Math.round((1 - priceMult) * 100)}% off.</b>
              )}
            </p>
          </header>
          <ul className="shop-rows">
            {UPGRADE_DEFS.map((def, i) => {
              const level = s.upgrades[def.key] ?? 0
              const maxed = upgradeMaxed(def, level)
              const cost = upgradeCost(def, level, priceMult)
              const affordable = !maxed && s.credits >= cost
              const id = `u:${def.key}`
              // Where the summon's lines end and the works' begin. Same shop,
              // same credits -- the rule is only that nothing is locked behind
              // anything (ADR 0014) -- but eighteen rows in one run is a list
              // nobody reads to the bottom of.
              const opensWorks = WORKS_KEYS.has(def.key) && !WORKS_KEYS.has(UPGRADE_DEFS[i - 1]?.key)
              return (
                <Fragment key={def.key}>
                {opensWorks && (
                  <li className="shelf-split">
                    <b>The works</b>
                    <span>The Press, the Factory, expeditions, and the ceilings your summon runs into.</span>
                  </li>
                )}
                <li className={`shop-row ${maxed ? 'maxed' : ''} ${affordable ? 'affordable' : ''}`}>
                  <button
                    className="row-buy"
                    disabled={maxed || !affordable}
                    onClick={() => s.buyUpgrade(def.key)}
                    title={def.blurb}
                  >
                    <span className="row-icon">
                      <Icon name={def.icon as IconName} />
                    </span>
                    <span className="row-main">
                      <span className="row-name">
                        {def.name}
                        {(maxed || level > 0) && (
                          <em className="row-lv">{maxed ? 'max' : `Lv ${level}`}</em>
                        )}
                      </span>
                      <span className="row-effect">
                        {def.effect(level)}
                        {!maxed && (
                          <>
                            {' '}
                            <span className="row-arrow">&rsaquo;</span>{' '}
                            <b>{def.effect(level + 1)}</b>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="row-cost">{maxed ? 'done' : fmt(cost)}</span>
                  </button>
                  <button
                    className="row-more"
                    aria-expanded={open === id}
                    aria-label={`About ${def.name}`}
                    onClick={() => setOpen(open === id ? null : id)}
                  >
                    ?
                  </button>
                  {open === id && (
                    <p className="row-detail">
                      {def.blurb}{' '}
                      {def.maxLevel ? `Stops at level ${def.maxLevel}.` : 'No maximum level.'}
                    </p>
                  )}
                </li>
                </Fragment>
              )
            })}
          </ul>
        </section>

        <section className="shop-col col-badges">
          <header className="shelf-head">
            <h2>Badges</h2>
            <p>
              One-off unlocks that change how the game works. Six tiers each. Sapphire, Ruby
              and Emerald need progress in Bronze, Silver and Gold.
            </p>
          </header>
          <ul className="shop-rows">
            {BADGE_DEFS.map((def) => {
              const level = s.badges[def.key]
              const maxed = level >= BADGE_MAX
              const unlocked = badgeUnlocked(def.key, s.badges)
              const cost = maxed ? 0 : badgeCost(def, level + 1, priceMult)
              const affordable = !maxed && unlocked && s.credits >= cost
              const id = `b:${def.key}`
              return (
                <li
                  key={def.key}
                  className={`shop-row is-badge ${!unlocked ? 'locked' : ''} ${maxed ? 'maxed' : ''} ${affordable ? 'affordable' : ''}`}
                  style={{ ['--badge-color' as string]: def.color }}
                >
                  <button
                    className="row-buy"
                    disabled={maxed || !unlocked || !affordable}
                    onClick={() => s.buyBadge(def.key)}
                    title={unlocked ? def.levels[Math.min(level, BADGE_MAX - 1)] : def.prereq ?? ''}
                  >
                    <span className="row-icon badge-icon">
                      <Icon name={def.icon as IconName} />
                    </span>
                    <span className="row-main">
                      <span className="row-name">
                        {def.name}
                        {(maxed || level > 0) && (
                          <em className="row-lv">{maxed ? 'max' : ROMAN[level]}</em>
                        )}
                        <span className="badge-pips">
                          {Array.from({ length: BADGE_MAX }, (_, i) => (
                            <span key={i} className={`pip ${i < level ? 'filled' : ''}`} />
                          ))}
                        </span>
                      </span>
                      <span className="row-effect">
                        {maxed ? (
                          'All six tiers bought'
                        ) : !unlocked ? (
                          def.prereq
                        ) : (
                          <>
                            <span className="row-arrow">{ROMAN[level + 1]}</span>{' '}
                            <b>{def.levels[level]}</b>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="row-cost">
                      {maxed ? 'done' : !unlocked ? 'locked' : fmt(cost)}
                    </span>
                  </button>
                  <button
                    className="row-more"
                    aria-expanded={open === id}
                    aria-label={`All ${def.name} tiers`}
                    onClick={() => setOpen(open === id ? null : id)}
                  >
                    ?
                  </button>
                  {open === id && (
                    <ol className="row-detail badge-levels">
                      {def.levels.map((text, i) => (
                        <li key={i} className={i < level ? 'owned' : i === level ? 'next' : ''}>
                          <span className="lvl-roman">{ROMAN[i + 1]}</span> {text}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
