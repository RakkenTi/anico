import type { RolledCharacter } from '../game/types'
import { rarityOf } from '../game/economy'

const GENDER_META: Record<string, { symbol: string; label: string; className: string }> = {
  Female: { symbol: '♀', label: 'Female', className: 'gender-female' },
  Male: { symbol: '♂', label: 'Male', className: 'gender-male' },
  Other: { symbol: '⚧', label: 'Other', className: 'gender-other' },
}

interface Props {
  character: RolledCharacter
  footer?: React.ReactNode
  compact?: boolean
  wished?: boolean
  onClick?: () => void
}

export default function CharacterCard({ character, footer, compact, wished, onClick }: Props) {
  const gender = GENDER_META[character.gender] ?? GENDER_META.Other
  const rarity = rarityOf(character.creditValue)
  return (
    <div
      className={`char-card rarity-${rarity.key} ${compact ? 'compact' : ''} ${wished ? 'wished' : ''} ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="card-frame">
        <div className="char-image-wrap">
          <img src={character.image} alt={character.name} loading="lazy" draggable={false} />
          <span className={`gender-badge ${gender.className}`} title={gender.label}>
            {gender.symbol}
          </span>
          <span className="rarity-tag" title={`${rarity.name}, ${character.favourites.toLocaleString()} AniList favourites`}>
            <b>{rarity.kanji}</b> {rarity.name}
          </span>
          {wished && <span className="wish-mark" title="On your wishlist">★</span>}
        </div>
        <div className="char-info">
          {/* Hovering the name reveals native spelling + known aliases (Mudae-style) */}
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
            <span className="char-value" title="Credit value">{character.creditValue.toLocaleString()}</span>
          </div>
        </div>
        {footer && <div className="char-footer">{footer}</div>}
      </div>
    </div>
  )
}
