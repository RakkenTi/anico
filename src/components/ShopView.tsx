import { useMemo } from 'react'
import { useGame } from '../game/store'
import { BADGE_DEFS, BADGE_MAX, ROMAN, badgeCost, badgeUnlocked } from '../game/badges'
import { UPGRADE_DEFS, upgradeCost, upgradeMaxed } from '../game/upgrades'
import { RARITY_NAMES, packCost } from '../game/economy'
import { fmt, fmtCount } from '../game/format'
import Icon from './Icon'
import type { IconName } from '../game/icons'

/**
 * One purchasable thing, whichever shelf it came from.
 *
 * Badges and upgrades used to be two panels, one under the other, and the one
 * that mattered first was the one below the fold. They are one list now,
 * cheapest first, because "what can I afford next" is the only question anyone
 * brings to a shop in a game like this -- and the answer should be the first
 * thing on screen rather than a scroll away.
 */
interface Entry {
  id: string
  kind: 'badge' | 'upgrade'
  name: string
  icon: string
  color?: string
  /** Where this line stands, in words. */
  standing: string
  /** What owning it does now, and what the next level would do. */
  now: string
  next: string | null
  cost: number
  /** Badges only: filled rungs out of six. */
  pips?: number
  locked: string | null
  done: boolean
  buy: () => void
}

export default function ShopView() {
  const s = useGame()
  const myBadges = s.badges
  const myUpgrades = s.upgrades
  const buyBadge = s.buyBadge
  const buyUpgrade = s.buyUpgrade
  const fx = s.effects()
  const priceMult = fx.priceMult

  const entries = useMemo<Entry[]>(() => {
    const badges: Entry[] = BADGE_DEFS.map((def) => {
      const level = myBadges[def.key]
      const done = level >= BADGE_MAX
      const unlocked = badgeUnlocked(def.key, myBadges)
      return {
        id: `badge:${def.key}`,
        kind: 'badge',
        name: def.name,
        icon: def.icon,
        color: def.color,
        standing: done
          ? `Badge · complete at ${ROMAN[BADGE_MAX]}`
          : `Badge · ${level > 0 ? `${ROMAN[level]} of ${ROMAN[BADGE_MAX]}` : 'not forged'}`,
        now: level > 0 ? def.levels[level - 1] : 'nothing yet',
        next: done ? null : def.levels[level],
        cost: done ? 0 : badgeCost(def, level + 1, priceMult),
        pips: level,
        locked: unlocked ? null : def.prereq,
        done,
        buy: () => buyBadge(def.key),
      }
    })
    const upgrades: Entry[] = UPGRADE_DEFS.map((def) => {
      const level = myUpgrades[def.key] ?? 0
      const done = upgradeMaxed(def, level)
      return {
        id: `upgrade:${def.key}`,
        kind: 'upgrade',
        name: def.name,
        icon: def.icon,
        standing: done
          ? `Upgrade · finished at ${level}`
          : `Upgrade · ${level > 0 ? `level ${level}` : 'not bought'}${
              def.maxLevel ? ` of ${def.maxLevel}` : ' · endless'
            }`,
        now: def.effect(level),
        next: done ? null : def.effect(level + 1),
        cost: done ? 0 : upgradeCost(def, level, priceMult),
        locked: null,
        done,
        buy: () => buyUpgrade(def.key),
      }
    })
    // Cheapest first, with everything that cannot be bought pushed to the end:
    // a finished line and a locked one are both answers to a question nobody
    // is asking while they have credits burning a hole.
    return [...badges, ...upgrades].sort((a, b) => {
      const rank = (e: Entry) => (e.done ? 2 : e.locked ? 1 : 0)
      return rank(a) - rank(b) || a.cost - b.cost
    })
  }, [myBadges, myUpgrades, buyBadge, buyUpgrade, priceMult])

  const next = entries.find((e) => !e.done && !e.locked)

  return (
    <div className="shop-view">
      {/* What the shop has bought so far, in the numbers that decide how fast
          the next thing arrives. Progress is meant to be visible: this is the
          scoreboard the prices below are climbing against. */}
      <dl className="shop-status">
        <div>
          <dt>A pull</dt>
          <dd>
            {fx.packSize > 0 ? (
              <>
                <b>
                  {fx.packsPerPull > 1 ? `${fx.packsPerPull} × ` : ''}
                  {fmtCount(fx.packSize)}
                </b>{' '}
                cards for <b className="credits-text">{fmt(packCost(fx.cardsPerPull))}</b>
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

      <div className="panel shop-panel">
        <h2 className="section-title">The Shop</h2>
        <p className="section-sub">
          Badges are short ladders that change what the game <i>is</i>: whether packs exist, how
          many wishes you may pin, what a pack promises. Upgrades are the curve — most of them
          have no last level, and each one costs a good deal more than the one below it.
          {priceMult < 1 && (
            <b className="credits-text"> Ruby is knocking {Math.round((1 - priceMult) * 100)}% off.</b>
          )}
          {next && (
            <>
              {' '}Next up: <b>{next.name}</b> for{' '}
              <b className="credits-text">{fmt(next.cost)}</b>.
            </>
          )}
        </p>

        <div className="shop-grid">
          {entries.map((e) => {
            const affordable = !e.done && !e.locked && s.credits >= e.cost
            return (
              <article
                key={e.id}
                className={`shop-card kind-${e.kind} ${e.locked ? 'locked' : ''} ${e.done ? 'maxed' : ''} ${affordable ? 'affordable' : ''}`}
                style={e.color ? ({ ['--badge-color' as string]: e.color }) : undefined}
              >
                <header className="shop-head">
                  <span className="shop-medal">
                    <Icon name={e.icon as IconName} className="icon-lg" />
                  </span>
                  <div className="shop-title">
                    <span className="shop-name">{e.name}</span>
                    <span className="shop-standing">{e.standing}</span>
                    {e.pips !== undefined && (
                      <span className="badge-pips">
                        {Array.from({ length: BADGE_MAX }, (_, i) => (
                          <span key={i} className={`pip ${i < e.pips! ? 'filled' : ''}`} />
                        ))}
                      </span>
                    )}
                  </div>
                </header>

                <p className="shop-effect">
                  <span className="now">Now:</span> {e.now}
                  {e.next && (
                    <>
                      <br />
                      <span className="next">Next:</span> {e.next}
                    </>
                  )}
                </p>

                {e.locked && <div className="shop-req">🔒 {e.locked}</div>}

                <button
                  className="btn btn-buy"
                  disabled={e.done || !!e.locked || !affordable}
                  onClick={e.buy}
                >
                  {e.done ? 'Complete' : e.locked ? 'Locked' : `${fmt(e.cost)} credits`}
                </button>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
