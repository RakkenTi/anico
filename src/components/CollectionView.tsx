import { useCallback, useEffect, useMemo, useState } from 'react'
import { useGame } from '../game/store'
import { SERIES_MILESTONES, rarityOf } from '../game/economy'
import type { OwnedCharacter } from '../game/types'
import CharacterCard from './CharacterCard'
import CharacterModal from './CharacterModal'
import { useVirtualGrid } from './useVirtualGrid'
import { fmt, fmtCount } from '../game/format'

type SortKey = 'value' | 'newest' | 'name'
type GenderFilter = 'all' | 'Female' | 'Male' | 'Other'
type RarityFilter = 'all' | 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

const RARITY_CHIPS: { key: RarityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mythic', label: 'Mythic' },
  { key: 'legendary', label: 'Legendary' },
  { key: 'epic', label: 'Epic' },
  { key: 'rare', label: 'Rare' },
  { key: 'common', label: 'Common' },
]

export default function CollectionView() {
  const collection = useGame((s) => s.collection)
  // Another device may have sold, locked or claimed something while this one
  // was elsewhere; the snapshot that told us so did not carry the cards.
  const collectionRev = useGame((s) => s.collectionRev)
  const refreshCollection = useGame((s) => s.refreshCollection)
  useEffect(() => {
    void refreshCollection()
  }, [collectionRev, refreshCollection])
  const wishes = useGame((s) => s.wishes)
  // Appraisal raises what a card fetches, so the totals here quote the payout
  // rather than the sticker price: the number on the sell button is the number
  // that lands in the balance.
  const sellMult = useGame((s) => s.effects().sellMult)
  const sell = useGame((s) => s.sell)
  const sellMany = useGame((s) => s.sellMany)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('value')
  const [starsOnly, setStarsOnly] = useState(false)
  const [gender, setGender] = useState<GenderFilter>('all')
  const [rarity, setRarity] = useState<RarityFilter>('all')
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<OwnedCharacter | null>(null)
  /**
   * Bulk mode: tapping a card picks it instead of opening it.
   *
   * Selling one card at a time meant a modal and two taps each, which is fine
   * for a mistake and unusable for a cull. The mode is explicit rather than a
   * long-press, because on a phone a long-press is also how you scroll by
   * accident.
   */
  const [bulk, setBulk] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)

  // The server already quotes a stack's worth with Appraisal folded in.
  const worth = useCallback(
    (c: OwnedCharacter) => c.stackValue ?? Math.round(c.creditValue * sellMult),
    [sellMult],
  )

  const seriesCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of collection) m.set(c.series, (m.get(c.series) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [collection])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = collection.filter(
      (c) =>
        (!starsOnly || c.stars > 0) &&
        (gender === 'all' || c.gender === gender) &&
        (rarity === 'all' || rarityOf(c.creditValue).key === rarity) &&
        (seriesFilter === null || c.series === seriesFilter) &&
        (q === '' || c.name.toLowerCase().includes(q) || c.series.toLowerCase().includes(q)),
    )
    switch (sort) {
      case 'value':
        return [...list].sort((a, b) => worth(b) - worth(a))
      case 'newest':
        return [...list].sort((a, b) => b.claimedAt - a.claimedAt)
      case 'name':
        return [...list].sort((a, b) => a.name.localeCompare(b.name))
    }
  }, [collection, search, sort, gender, rarity, seriesFilter, starsOnly, worth])

  /**
   * Only the rows on screen are mounted. A collection is the one list here
   * that grows without bound, and every card in it is an image.
   */
  const { outerRef, innerRef, start, end, totalHeight, offset } = useVirtualGrid(
    filtered.length,
    `${search}|${sort}|${gender}|${rarity}|${seriesFilter}|${starsOnly}`,
  )

  const totalWorth = collection.reduce((s, c) => s + worth(c), 0)
  const copiesHeld = collection.reduce((s, c) => s + (c.copies ?? 1), 0)
  const pickedWorth = collection.reduce((s, c) => (picked.has(c.id) ? s + worth(c) : s), 0)
  // "Select all" means all of what is on screen, so a filter is how you say
  // "every common" or "everything from this series" without tapping each one.
  const sellable = filtered.filter((c) => !c.locked)
  const allShownPicked = sellable.length > 0 && sellable.every((c) => picked.has(c.id))

  const leaveBulk = () => {
    setBulk(false)
    setPicked(new Set())
    setConfirming(false)
  }

  const toggle = (id: number) => {
    // A locked card cannot be sold, so it cannot be picked for a sale either.
    if (collection.find((c) => c.id === id)?.locked) return
    setConfirming(false)
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={`collection-view ${bulk ? 'is-bulk' : ''} ${collection.length > 40 ? 'hushed' : ''}`}>
      {/* Hierarchy: title + key numbers first, controls second, filters
          third (quiet until active), then the grid itself. */}
      <header className="col-head">
        <div className="col-title">
          <h2>Collection</h2>
          <p className="col-meta">
            <b>{fmtCount(collection.length)}</b> characters · {fmtCount(copiesHeld)} cards · worth{' '}
            <b className="credits-text">{fmt(totalWorth)}</b> credits
          </p>
        </div>
        <div className="col-controls">
          <input
            className="input col-search"
            type="search"
            placeholder="Search name or series…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input" value={gender} onChange={(e) => setGender(e.target.value as GenderFilter)}>
            <option value="all">All genders</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Other">Other</option>
          </select>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="value">Highest value</option>
            <option value="newest">Newest first</option>
            <option value="name">Name A–Z</option>
          </select>
          {collection.length > 0 && (
            <button
              className={`btn ${bulk ? 'btn-quiet' : 'btn-ghost'} col-bulk-toggle`}
              onClick={() => (bulk ? leaveBulk() : setBulk(true))}
            >
              {bulk ? 'Done' : 'Select'}
            </button>
          )}
        </div>
      </header>

      <div className="col-filters">
        <div className="chip-row">
          <span className="chip-row-label">Rarity</span>
          {RARITY_CHIPS.map((r) => (
            <button
              key={r.key}
              className={`chip ${rarity === r.key ? 'active' : ''}`}
              onClick={() => setRarity(r.key)}
            >
              {r.label}
            </button>
          ))}
          {/* Merged stacks are the thing worth finding in a collection of
              thousands, and nothing else in these filters can find them. */}
          <button
            className={`chip chip-star ${starsOnly ? 'active' : ''}`}
            onClick={() => setStarsOnly(!starsOnly)}
            title="Only stacks that have merged at least once"
          >
            ★ Merged
          </button>
        </div>

        {seriesCounts.length > 0 && (
          <div className="chip-row series-row">
            <span className="chip-row-label">Series sets</span>
            {seriesCounts.slice(0, 8).map(([series, count]) => {
              const next = SERIES_MILESTONES.find((m) => count < m.count)
              return (
                <button
                  key={series}
                  className={`chip series-chip ${seriesFilter === series ? 'active' : ''}`}
                  onClick={() => setSeriesFilter(seriesFilter === series ? null : series)}
                  title={next ? `${count}/${next.count} toward +${next.reward} credits` : 'Set complete!'}
                >
                  {series} <b>×{count}</b>
                  {next && <span className="set-progress">{count}/{next.count}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {collection.length === 0 ? (
        <div className="empty-state">
          <div className="empty-glyph">✧</div>
          <p>Your collection is empty. Summon and claim someone.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>No characters match your filters.</p></div>
      ) : (
        <div
          className="collection-scroller"
          ref={outerRef}
          style={{ height: totalHeight }}
        >
          <div
            className="collection-grid"
            ref={innerRef}
            style={{ transform: `translateY(${offset}px)` }}
          >
            {filtered.slice(start, end).map((c) => (
              <CharacterCard
                key={c.id}
                character={c}
                compact
                copies={c.copies}
                stars={c.stars}
                value={worth(c)}
                wished={wishes.some((w) => w.id === c.id)}
                locked={c.locked}
                selectable={bulk && !c.locked}
                selected={picked.has(c.id)}
                onClick={() => (bulk ? toggle(c.id) : setSelected(c))}
              />
            ))}
          </div>
        </div>
      )}

      {/* The bar rides the bottom of the screen while bulk mode is on, because
          the selection happens at the top of a long scroll and the decision
          about it happens wherever you finish. */}
      {bulk && (
        <div className="bulk-bar" role="region" aria-label="Bulk selection">
          <div className="bulk-count">
            <b>{picked.size}</b> selected
            {picked.size > 0 && (
              <span className="credits-text"> · +{fmt(pickedWorth)} credits</span>
            )}
          </div>
          <div className="bulk-actions">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setConfirming(false)
                setPicked((prev) => {
                  const next = new Set(prev)
                  if (allShownPicked) sellable.forEach((c) => next.delete(c.id))
                  else sellable.forEach((c) => next.add(c.id))
                  return next
                })
              }}
            >
              {allShownPicked ? 'Clear shown' : `Select all (${fmtCount(sellable.length)})`}
            </button>
            <button
              className="btn btn-danger"
              disabled={picked.size === 0}
              onClick={() => {
                if (!confirming) {
                  setConfirming(true)
                  return
                }
                sellMany([...picked])
                leaveBulk()
              }}
            >
              {confirming
                ? `Confirm: sell ${fmtCount(picked.size)}`
                : `Sell ${fmtCount(picked.size)} · +${fmt(pickedWorth)}`}
            </button>
            <button className="btn btn-quiet" onClick={leaveBulk}>
              Done
            </button>
          </div>
        </div>
      )}

      {selected && (
        <CharacterModal
          character={selected}
          onClose={() => setSelected(null)}
          onSell={() => {
            sell(selected.id)
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}
