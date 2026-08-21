import { useState, Fragment } from 'react'
import { useGame, useUi } from '../game/store'
import { BADGE_DEFS, BADGE_MAX, ROMAN, badgeCost, badgeUnlocked } from '../game/badges'
import { LATE_KEYS, UPGRADE_DEFS, bulkCost, upgradeCost, upgradeMaxed } from '../game/upgrades'
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
 *
 * One row buys as many levels as the amount switch says. Late on, a level of
 * an endless line is a fraction of a second's income and buying one at a time
 * is a repetitive strain injury with a progress bar; the switch buys ten,
 * twenty-five, or everything the balance covers, and the row prints what that
 * actually comes to rather than a per-level price times a number.
 */
type Shelf = 'upgrades' | 'badges'

/** What the amount switch offers. */
const AMOUNTS: (number | 'max')[] = [1, 10, 25, 'max']
const amountLabel = (a: number | 'max') => (a === 'max' ? 'Max' : `×${a}`)

export default function ShopView() {
  const s = useGame()
  const fx = s.effects()
  const priceMult = fx.priceMult
  const [shelf, setShelf] = useState<Shelf>('upgrades')
  const [open, setOpen] = useState<string | null>(null)
  const buyAmount = useUi((u) => u.buyAmount)
  const setUi = useUi((u) => u.set)

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

  /* What a press of a row would actually do, priced level by level against the
     balance: every level costs more than the last, so this is a sum. */
  const quote = (def: (typeof UPGRADE_DEFS)[number], level: number) =>
    bulkCost(def, level, s.credits, buyAmount, priceMult)

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
            <div className="buy-amount segmented" role="group" aria-label="Levels per purchase">
              {AMOUNTS.map((a) => (
                <button
                  key={String(a)}
                  className={`seg ${buyAmount === a ? 'active' : ''}`}
                  onClick={() => setUi({ buyAmount: a })}
                >
                  {amountLabel(a)}
                </button>
              ))}
            </div>
          </header>
          <ul className="shop-rows">
            {UPGRADE_DEFS.map((def, i) => {
              const level = s.upgrades[def.key] ?? 0
              const maxed = upgradeMaxed(def, level)
              const { levels, cost } = maxed ? { levels: 0, cost: 0 } : quote(def, level)
              const affordable = levels > 0
              // What one level costs, for the row that cannot afford even that.
              const nextCost = maxed ? 0 : upgradeCost(def, level, priceMult)
              const to = level + Math.max(1, levels)
              const id = `u:${def.key}`
              // Where the summon's lines end and the long game begins. Same
              // shop, same credits -- the rule is only that nothing is locked
              // behind anything (ADR 0014) -- but one flat run of fifteen rows
              // is a list nobody reads to the bottom of.
              const opensLate = LATE_KEYS.has(def.key) && !LATE_KEYS.has(UPGRADE_DEFS[i - 1]?.key)
              return (
                <Fragment key={def.key}>
                {opensLate && (
                  <li className="shelf-split">
                    <b>The long game</b>
                    <span>The contract board, and the ceilings your summon runs into.</span>
                  </li>
                )}
                <li className={`shop-row ${maxed ? 'maxed' : ''} ${affordable ? 'affordable' : ''}`}>
                  <button
                    className="row-buy"
                    disabled={maxed || !affordable}
                    onClick={() => s.buyUpgrade(def.key, buyAmount)}
                    title={def.blurb}
                  >
                    <span className="row-icon">
                      <Icon name={def.icon as IconName} />
                    </span>
                    <span className="row-main">
                      <span className="row-name">
                        {def.name}
                        {(maxed || level > 0) && (
                          <em className="row-lv">
                            {maxed ? 'max' : levels > 1 ? `Lv ${level} \u2192 ${to}` : `Lv ${level}`}
                          </em>
                        )}
                      </span>
                      <span className="row-effect">
                        {def.effect(level)}
                        {!maxed && (
                          <>
                            {' '}
                            <span className="row-arrow">&rsaquo;</span>{' '}
                            <b>{def.effect(to)}</b>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="row-cost">
                      {maxed ? 'done' : fmt(affordable ? cost : nextCost)}
                      {!maxed && levels > 1 && <em className="row-cost-n">{levels} levels</em>}
                    </span>
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
