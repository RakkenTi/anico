import { useEffect, useState } from 'react'
import { api, type PlayerProfile } from '../api'
import { fmt, fmtCount } from '../game/format'
import { BADGE_DEFS, type BadgeKey } from '../game/badges'
import { UPGRADE_DEFS, type UpgradeKey } from '../game/upgrades'
import { rarityOf } from '../game/economy'
import Icon from './Icon'
import type { IconName } from '../game/icons'

/**
 * Somebody else, opened from the leaderboard.
 *
 * A collection is the thing people build here, and until now the only evidence
 * that anybody else had one was a number in a column. This is the rest of it:
 * what they have bought, how far up each line they are, and the five best cards
 * they hold. Read-only and entirely public -- everything on it is a consequence
 * of playing, and none of it is about the account.
 */

const dateOf = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** The lines worth showing, in the order the shop sells them. */
const SHOWN: UpgradeKey[] = [
  'packs',
  'multipack',
  'appraisal',
  'fortune',
  'haste',
  'automaton',
  'nightshift',
  'alchemy',
  'divination',
  'depth',
  'hands',
  'table',
  'aim',
  'focus',
  'autoaim',
]

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-stat">
      <div className="profile-stat-value">{value}</div>
      <div className="profile-stat-label">{label}</div>
    </div>
  )
}

export default function PlayerCard({ id, onClose }: { id: number; onClose: () => void }) {
  const [who, setWho] = useState<PlayerProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  // No reset needed when `id` changes: the leaderboard keys this by id, so a
  // different player is a different component with its own empty state.
  useEffect(() => {
    let alive = true
    api
      .player(id)
      .then((p) => alive && setWho(p))
      .catch(() => alive && setError('That player could not be loaded.'))
    return () => {
      alive = false
    }
  }, [id])

  // Escape closes it, the way the character modal does.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal profile-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={who ? `${who.player}'s profile` : 'Player profile'}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {error && <p className="section-sub">{error}</p>}
        {!who && !error && <p className="section-sub">Looking them up…</p>}

        {who && (
          <>
            <header className="profile-head">
              <span className={`rank-dot ${who.online ? 'on' : ''}`} />
              <h2 className="profile-name">
                {who.player}
                {who.isAdmin && <span className="admin-tag">admin</span>}
                {who.you && <em className="rank-tag">you</em>}
              </h2>
              <p className="profile-since">
                {who.online ? 'Playing right now' : 'Away'} · here since {dateOf(who.joinedAt)}
              </p>
            </header>

            <div className="profile-stats">
              <Stat label="credits" value={fmt(who.credits)} />
              <Stat label="characters" value={fmtCount(who.characters)} />
              <Stat label="cards held" value={fmtCount(who.cards)} />
              <Stat label="summons" value={fmtCount(who.rolls)} />
              <Stat label="best stack" value={who.stars > 0 ? `${who.stars}★` : '—'} />
              <Stat label="daily streak" value={fmtCount(who.streak)} />
            </div>

            {who.best.length > 0 && (
              <section className="profile-section">
                <h3 className="profile-heading">Best cards</h3>
                <ul className="profile-cards">
                  {who.best.map((card) => (
                    <li key={card.id} className={`profile-card rarity-${rarityOf(card.credit_value).key}`}>
                      <img src={card.image} alt="" loading="lazy" decoding="async" />
                      <div className="profile-card-name">{card.name}</div>
                      <div className="profile-card-meta">
                        {card.stars > 0 && <span className="profile-card-stars">{card.stars}★</span>}
                        {fmt(card.credit_value)}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="profile-section">
              <h3 className="profile-heading">Badges</h3>
              <ul className="profile-badges">
                {BADGE_DEFS.map((def) => {
                  const level = who.badges[def.key as BadgeKey] ?? 0
                  return (
                    <li key={def.key} className={level > 0 ? 'has' : ''}>
                      <Icon name={def.icon as IconName} />
                      <span className="profile-badge-name">{def.name}</span>
                      {/* Tiers rather than a number: it is how the shop sells
                          them and how everybody already talks about them. */}
                      <span className="profile-badge-level">{level > 0 ? `${level}/6` : 'none'}</span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="profile-section">
              <h3 className="profile-heading">Upgrades</h3>
              <ul className="profile-upgrades">
                {SHOWN.map((key) => {
                  const def = UPGRADE_DEFS.find((u) => u.key === key)
                  if (!def) return null
                  const level = who.upgrades[key] ?? 0
                  return (
                    <li key={key} className={level > 0 ? 'has' : ''}>
                      <span className="profile-upgrade-name">{def.name}</span>
                      <span className="profile-upgrade-level">{level > 0 ? `Lv ${fmtCount(level)}` : '—'}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
