import { useState } from 'react'
import { useGame } from '../game/store'
import { api } from '../api'
import { DEMO, DEMO_REPO } from '../game/demo'
import type { RolledCharacter } from '../game/types'
import CharacterCard from './CharacterCard'
import Locked from './Locked'

export default function WishesView() {
  const wishes = useGame((s) => s.wishes)
  const collection = useGame((s) => s.collection)
  const addWish = useGame((s) => s.addWish)
  const removeWish = useGame((s) => s.removeWish)
  const effects = useGame((s) => s.effects)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RolledCharacter[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fx = effects()
  const slotsFree = fx.wishSlots - wishes.length

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 2 || searching) return
    setSearching(true)
    setError(null)
    try {
      setResults((await api.search(q)).results)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  /*
   * Pinning a character means searching AniList by name, which is the only
   * call this app makes to anybody else at runtime. A demo that made it would
   * be pointing a public URL at somebody else's rate limit, so the page says
   * what it is for and stops there.
   */
  if (DEMO) {
    return (
      <div className="wishes-view">
        <Locked
          title="Wishes need an instance"
          href={DEMO_REPO}
        >
          A wish pins a character by name, so that they turn up in your pulls more often than
          the catalog would ever give them to you. Finding one means searching AniList, which
          is the only request this game makes to anybody else, and a public demo has no
          business making it on your behalf. Run your own instance and the search is yours.
        </Locked>
      </div>
    )
  }

  return (
    <div className="wishes-view">
      <div className="panel">
        <h2 className="section-title">Wishlist <span className="slot-count">{wishes.length} / {fx.wishSlots} slots</span></h2>
        <p className="section-sub">
          Wished characters have a chance to barge into your rolls, boosted by Silver and
          Ruby badges. Bronze IV pays +100 credits when you claim a wish.
        </p>
        {wishes.length === 0 ? (
          <div className="empty-state small">
            <p>No wishes yet. Search below and pin the characters you're hunting.</p>
          </div>
        ) : (
          <div className="wish-grid">
            {wishes.map((w) => {
              const owned = collection.some((c) => c.id === w.id)
              return (
                <CharacterCard
                  key={w.id}
                  character={w}
                  compact
                  footer={
                    <div className="wish-footer">
                      {owned && <span className="owned-chip">owned</span>}
                      <button className="btn btn-ghost" onClick={() => removeWish(w.id)}>
                        Release
                      </button>
                    </div>
                  }
                />
              )
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="section-title">Seek a character</h2>
        <form className="search-row" onSubmit={search}>
          <input
            className="input"
            type="search"
            placeholder="Search AniList by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-primary" disabled={searching || query.trim().length < 2}>
            {searching ? 'Seeking…' : 'Search'}
          </button>
        </form>
        {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}
        {results && results.length === 0 && (
          <div className="empty-state small"><p>No characters found.</p></div>
        )}
        {results && results.length > 0 && (
          <div className="wish-grid">
            {results.map((c) => {
              const wishedAlready = wishes.some((w) => w.id === c.id)
              const owned = collection.some((o) => o.id === c.id)
              return (
                <CharacterCard
                  key={c.id}
                  character={c}
                  compact
                  wished={wishedAlready}
                  footer={
                    <button
                      className="btn btn-wish"
                      disabled={wishedAlready || slotsFree <= 0}
                      onClick={() => addWish(c)}
                      title={slotsFree <= 0 && !wishedAlready ? 'No wish slots free. Bronze badges add more.' : undefined}
                    >
                      {wishedAlready ? 'Wished' : owned ? 'Wish (owned)' : slotsFree <= 0 ? 'Slots full' : 'Wish'}
                    </button>
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
