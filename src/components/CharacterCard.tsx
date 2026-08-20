import type { RolledCharacter } from '../game/types'
import { MAX_STARS, STAR_NAMES, rarityOf } from '../game/economy'
import { fmt } from '../game/format'

const GENDER_META: Record<string, { symbol: string; label: string; className: string }> = {
  Female: { symbol: '♀', label: 'Female', className: 'gender-female' },
  Male: { symbol: '♂', label: 'Male', className: 'gender-male' },
  Other: { symbol: '⚧', label: 'Other', className: 'gender-other' },
}

interface Props {
  character: RolledCharacter
  /** Copies held, and the star they have merged to. */
  copies?: number
  stars?: number
  /** What to show as the card's worth. Defaults to one card's credit value;
   *  a collection quotes the whole stack instead, which is what it sells for. */
  value?: number
  footer?: React.ReactNode
  compact?: boolean
  wished?: boolean
  /** Painted on the artwork: the spread's new/dupe/wish tag lives here so it
   *  cannot come to rest on top of the name, series or value. */
  overlay?: React.ReactNode
  /** Bulk mode: the card carries a checkbox instead of opening a detail view. */
  selectable?: boolean
  selected?: boolean
  onClick?: () => void
}

export default function CharacterCard({
  character,
  copies,
  stars = 0,
  value,
  footer,
  compact,
  wished,
  overlay,
  selectable,
  selected,
  onClick,
}: Props) {
  const gender = GENDER_META[character.gender] ?? GENDER_META.Other
  const rarity = rarityOf(character.creditValue)
  return (
    <div
      className={`char-card rarity-${rarity.key} ${compact ? 'compact' : ''} ${wished ? 'wished' : ''} ${onClick ? 'clickable' : ''} ${selectable ? 'selectable' : ''} ${selected ? 'picked' : ''} ${stars > 0 ? `starred star-${Math.min(stars, 6)}` : ''}`}
      onClick={onClick}
      role={selectable ? 'checkbox' : onClick ? 'button' : undefined}
      aria-checked={selectable ? !!selected : undefined}
    >
      <div className="card-frame">
        <div className="char-image-wrap">
          <img src={character.image} alt={character.name} loading="lazy" draggable={false} />
          <span className={`gender-badge ${gender.className}`} title={gender.label}>
            {gender.symbol}
          </span>
          <span className="rarity-tag" title={`${rarity.name}, ${character.favourites.toLocaleString()} AniList favourites`}>
            <b>{rarity.kanji}</b> <span className="tag-word">{rarity.name}</span>
          </span>
          {wished && <span className="wish-mark" title="On your wishlist">★</span>}
          {overlay}
          {stars > 0 && (
            <span className="star-mark" title={`${STAR_NAMES[Math.min(stars, MAX_STARS)]} · ${copies ?? 0} copies merged`}>
              {'★'.repeat(Math.min(stars, 5))}
              {stars > 5 && `+${stars - 5}`}
            </span>
          )}
          {!stars && (copies ?? 0) > 1 && <span className="copy-mark">×{copies}</span>}
          {selectable && (
            <span className={`pick-mark ${selected ? 'on' : ''}`} aria-hidden="true">
              {selected ? '✓' : ''}
            </span>
          )}
        </div>
        <div className="char-info">
          {/* Hovering the name reveals native spelling and known aliases. */}
          <div
            className="char-name"
            title={
              [character.nativeName, ...(character.aliases ?? [])]
                .filter(Boolean)
                .join(' · ') || undefined
            }
          >
            {character.name}
          </div>
          <div className="char-sub">
            <span className="char-series" title={character.series}>{character.series}</span>
            <span
              className="char-value"
              title={value !== undefined && value !== character.creditValue ? 'What this stack sells for' : 'Credit value'}
            >
              {fmt(value ?? character.creditValue)}
            </span>
          </div>
        </div>
        {footer && <div className="char-footer">{footer}</div>}
      </div>
    </div>
  )
}
