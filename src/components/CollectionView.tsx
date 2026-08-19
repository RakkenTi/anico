import { useMemo, useState } from 'react'
import { useGame } from '../game/store'
import { SERIES_MILESTONES, rarityOf } from '../game/economy'
import type { OwnedCharacter } from '../game/types'
import CharacterCard from './CharacterCard'
import CharacterModal from './CharacterModal'

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
  const wishes = useGame((s) => s.wishes)
  const sell = useGame((s) => s.sell)
  const sellMany = useGame((s) => s.sellMany)
  const testing = useGame((s) => s.settings.testingMode)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('value')
  const [gender, setGender] = useState<GenderFilter>('all')
  const [rarity, setRarity] = useState<RarityFilter>('all')
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<OwnedCharacter | null>(null)

  const seriesCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of collection) m.set(c.series, (m.get(c.series) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [collection])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = collection.filter(
      (c) =>
        (gender === 'all' || c.gender === gender) &&
        (rarity === 'all' || rarityOf(c.creditValue).key === rarity) &&
        (seriesFilter === null || c.series === seriesFilter) &&
        (q === '' || c.name.toLowerCase().includes(q) || c.series.toLowerCase().includes(q)),
    )
    switch (sort) {
      case 'value':
        return [...list].sort((a, b) => b.creditValue - a.creditValue)
      case 'newest':
        return [...list].sort((a, b) => b.claimedAt - a.claimedAt)
      case 'name':
        return [...list].sort((a, b) => a.name.localeCompare(b.name))
    }
  }, [collection, search, sort, gender, rarity, seriesFilter])

  const totalWorth = collection.reduce((s, c) => s + c.creditValue, 0)
  // Bulk sell acts on exactly what the filters are showing, so "sell every
  // common" is a filter away; with no filters on, it empties the collection.
  const narrowed =
    search.trim() !== '' || gender !== 'all' || rarity !== 'all' || seriesFilter !== null
  const shownWorth = filtered.reduce((s, c) => s + c.creditValue, 0)

  return (
    <div className="collection-view">
      {/* Hierarchy: title + key numbers first, controls second, filters
          third (quiet until active), then the grid itself. */}
      <header className="col-head">
        <div className="col-title">
          <h2>Collection</h2>
          <p className="col-meta">
            <b>{collection.length}</b> characters · worth{' '}
            <b className="credits-text">{totalWorth.toLocaleString()} credits</b>
          </p>
        </div>
        <div className="col-controls">
          <input
            className="input"
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
          {testing && collection.length > 0 && (
            confirmBulk ? (
              <span className="confirm-row">
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    sellMany(filtered.map((c) => c.id))
                    setConfirmBulk(false)
                  }}
                >
                  Sell {filtered.length} for {shownWorth.toLocaleString()} credits
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmBulk(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className="btn btn-ghost"
                disabled={filtered.length === 0}
                onClick={() => setConfirmBulk(true)}
                title={
                  narrowed
                    ? 'Sandbox: sell every character matching the current filters'
                    : 'Sandbox: sell your entire collection'
                }
              >
                Sell all{narrowed ? ' shown' : ''} ({filtered.length})
              </button>
            )
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
        <div className="collection-grid">
          {filtered.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              compact
              wished={wishes.some((w) => w.id === c.id)}
              onClick={() => setSelected(c)}
            />
          ))}
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
