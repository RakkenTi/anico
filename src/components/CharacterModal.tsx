import { useState } from 'react'
import type { OwnedCharacter } from '../game/types'
import { MAX_STARS, STAR_NAMES, rarityOf } from '../game/economy'
import { sfx } from '../game/sound'
import { fmt, fmtCount } from '../game/format'

interface Props {
  character: OwnedCharacter
  onClose: () => void
  onSell: () => void
}

export default function CharacterModal({ character, onClose, onSell }: Props) {
  const rarity = rarityOf(character.creditValue)
  const copies = character.copies ?? 1
  const stars = character.stars ?? 0
  // Portrait first, then any series artwork we have (AniList only stores one
  // image per character, so the "set" is portrait + series covers).
  const images = [character.image, ...(character.covers ?? [])]
  const [imgIdx, setImgIdx] = useState(0)
  const aliases = [character.nativeName, ...(character.aliases ?? [])].filter(Boolean) as string[]

  const cycle = (dir: 1 | -1) => {
    setImgIdx((i) => (i + dir + images.length) % images.length)
    sfx.tap()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal rarity-${rarity.key}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="modal-body">
          <div className="carousel">
            <img
              className="modal-art"
              src={images[imgIdx]}
              alt={imgIdx === 0 ? character.name : `${character.series} artwork`}
            />
            {images.length > 1 && (
              <>
                <button className="car-arrow car-prev" onClick={() => cycle(-1)} aria-label="Previous image">‹</button>
                <button className="car-arrow car-next" onClick={() => cycle(1)} aria-label="Next image">›</button>
                <div className="car-dots">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      className={`car-dot ${i === imgIdx ? 'active' : ''}`}
                      onClick={() => { setImgIdx(i); sfx.tap() }}
                      aria-label={`Image ${i + 1}`}
                    />
                  ))}
                </div>
                {imgIdx > 0 && <span className="car-caption">series artwork</span>}
              </>
            )}
          </div>
          <div className="modal-info">
            <div className={`modal-rarity rarity-text-${rarity.key}`}>
              {rarity.name}
            </div>
            <h2
              className="modal-name"
              title={aliases.length > 0 ? aliases.join(' · ') : undefined}
            >
              {character.name}
            </h2>
            {aliases.length > 0 && (
              <div className="modal-aliases" title={aliases.join(' · ')}>
                a.k.a. {aliases.slice(0, 3).join(' · ')}
                {aliases.length > 3 && ' …'}
              </div>
            )}
            <dl className="modal-facts">
              <dt>Series</dt><dd>{character.series}</dd>
              <dt>Gender</dt><dd>{character.gender}</dd>
              <dt>Credit value</dt><dd>{fmt(character.creditValue)} each</dd>
              <dt>Copies held</dt>
              <dd>
                {fmtCount(copies)}
                {stars > 0 && (
                  <span className="modal-star">
                    {' '}· {STAR_NAMES[Math.min(stars, MAX_STARS)]} {'★'.repeat(Math.min(stars, 5))}
                  </span>
                )}
              </dd>
              <dt>AniList favourites</dt><dd>{character.favourites.toLocaleString()}</dd>
              <dt>Claimed</dt><dd>{new Date(character.claimedAt).toLocaleDateString()}</dd>
            </dl>
            {/* Selling takes the whole stack, so the button says so rather
                than quoting one card's worth of a pile of eight. */}
            <button className="btn btn-sell" onClick={onSell}>
              Sell {copies > 1 ? `all ${copies}` : ''} for{' '}
              {fmt(character.stackValue ?? character.creditValue)} credits
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
