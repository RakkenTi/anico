import { useEffect, useMemo, useState } from 'react'
import { useGame } from '../game/store'
import { fmt } from '../game/format'
import { rarityOf } from '../game/economy'
import type { Rarity } from '../game/economy'
import CharacterModal from './CharacterModal'
import Icon from './Icon'
import type { OwnedCharacter } from '../game/types'

/* Chart palettes, validated (dataviz six checks) against the arcade
   surface #12181e: lightness band, chroma, CVD + normal-vision
   separation, contrast. Every bar/segment is also direct-labeled,
   so identity never rides on color alone. */
const RARITY_COLORS: Record<Rarity['key'], string> = {
  common: '#a87428',
  rare: '#2f8fbf',
  epic: '#8a4bdf',
  legendary: '#c8820a',
  mythic: '#d4569f',
}
const RARITY_ORDER: Rarity['key'][] = ['common', 'rare', 'epic', 'legendary', 'mythic']
const GENDER_COLORS: Record<string, string> = {
  Female: '#d45a86',
  Male: '#4d84d9',
  Other: '#1fa189',
}

/** Eased count-up for hero numbers. */
function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

function Tile({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  const v = useCountUp(value)
  return (
    <div className="stat-tile">
      <div className="stat-tile-value">
        {fmt(v)}
        {suffix && <span className="stat-tile-suffix">{suffix}</span>}
      </div>
      <div className="stat-tile-label">{label}</div>
    </div>
  )
}

interface Row {
  key: string
  label: string
  count: number
  color: string
}

/** Horizontal category bars: direct-labeled rows, animated in. */
function BarChart({ rows, max }: { rows: Row[]; max: number }) {
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div
          className="bar-row"
          key={r.key}
          title={`${r.label}: ${r.count.toLocaleString()}`}
        >
          <span className="bar-label">{r.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${max > 0 ? (r.count / max) * 100 : 0}%`,
                background: r.color,
                animationDelay: `${i * 70}ms`,
              }}
            />
          </div>
          <span className="bar-value">{r.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

/** Animated donut with a hole label; 2-unit gaps separate segments. */
function Donut({ rows, total, holeLabel }: { rows: Row[]; total: number; holeLabel: string }) {
  // precompute each segment's start offset without render-scope mutation
  const segs = rows.reduce<{ list: (Row & { pct: number; start: number })[]; acc: number }>(
    (state, r) => {
      const pct = total > 0 ? (r.count / total) * 100 : 0
      state.list.push({ ...r, pct, start: state.acc })
      return { list: state.list, acc: state.acc + pct }
    },
    { list: [], acc: 0 },
  ).list
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 120 120" className="donut" role="img" aria-label={holeLabel}>
        <circle className="donut-ring" cx="60" cy="60" r="45" />
        <g transform="rotate(-90 60 60)">
          {segs.map((r) => {
            const gap = r.pct > 4 ? 2 : 0 // 2-unit surface gap between fills
            return (
              <circle
                key={r.key}
                className="donut-seg"
                cx="60" cy="60" r="45"
                pathLength={100}
                stroke={r.color}
                strokeDasharray={`${Math.max(r.pct - gap, 0.5)} ${100 - r.pct + gap}`}
                strokeDashoffset={-r.start - gap / 2}
              >
                <title>{`${r.label}: ${r.count.toLocaleString()} (${Math.round(r.pct)}%)`}</title>
              </circle>
            )
          })}
        </g>
        <text x="60" y="57" className="donut-num">{total.toLocaleString()}</text>
        <text x="60" y="72" className="donut-cap">{holeLabel}</text>
      </svg>
      <ul className="donut-legend">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="swatch" style={{ background: r.color }} />
            {r.label} <b>{r.count.toLocaleString()}</b>
            <span className="legend-pct">
              {total > 0 ? Math.round((r.count / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function StatsView() {
  const collection = useGame((st) => st.collection)
  const wishes = useGame((st) => st.wishes)
  const credits = useGame((st) => st.credits)
  const totalRolls = useGame((st) => st.totalRolls)
  const totalClaims = useGame((st) => st.totalClaims)
  const dailyStreak = useGame((st) => st.dailyStreak)
  const [selected, setSelected] = useState<OwnedCharacter | null>(null)
  const sell = useGame((st) => st.sell)

  const worth = useMemo(() => collection.reduce((s, c) => s + c.creditValue, 0), [collection])

  const rarityRows: Row[] = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of collection) {
      const k = rarityOf(c.creditValue).key
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return RARITY_ORDER.map((k) => ({
      key: k,
      label: k[0].toUpperCase() + k.slice(1),
      count: counts.get(k) ?? 0,
      color: RARITY_COLORS[k],
    }))
  }, [collection])

  const genderRows: Row[] = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of collection) counts.set(c.gender, (counts.get(c.gender) ?? 0) + 1)
    return (['Female', 'Male', 'Other'] as const)
      .map((g) => ({ key: g, label: g, count: counts.get(g) ?? 0, color: GENDER_COLORS[g] }))
      .filter((r) => r.count > 0)
  }, [collection])

  const seriesRows: Row[] = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of collection) counts.set(c.series, (counts.get(c.series) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([series, count]) => ({
        key: series,
        label: series,
        count,
        color: 'var(--accent)', // magnitude, one measure → single hue
      }))
  }, [collection])

  const topFive = useMemo(
    () => [...collection].sort((a, b) => b.creditValue - a.creditValue).slice(0, 5),
    [collection],
  )

  const claimRate = totalRolls > 0 ? Math.round((totalClaims / totalRolls) * 100) : 0
  const maxRarity = Math.max(...rarityRows.map((r) => r.count), 1)
  const maxSeries = Math.max(...seriesRows.map((r) => r.count), 1)

  if (collection.length === 0 && totalRolls === 0) {
    return (
      <div className="stats-view">
        <div className="empty-state">
          <div className="empty-glyph"><Icon name="chart" /></div>
          <p>No story to tell yet. Summon a few characters and come back.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="stats-view">
      <div className="stat-tiles">
        <Tile label="characters collected" value={collection.length} />
        <Tile label="collection worth" value={worth} />
        <Tile label="credits on hand" value={credits} />
        <Tile label="lifetime rolls" value={totalRolls} />
        <Tile label="claims made" value={totalClaims} />
        <Tile label="claim rate" value={claimRate} suffix="%" />
      </div>

      <div className="stat-grid">
        <div className="panel stat-panel">
          <h2 className="section-title">Rarity spread</h2>
          <p className="section-sub">How deep your pulls run, from common to mythic.</p>
          <BarChart rows={rarityRows} max={maxRarity} />
        </div>

        <div className="panel stat-panel">
          <h2 className="section-title">Who you collect</h2>
          <p className="section-sub">Your collection by character gender.</p>
          {genderRows.length > 0 ? (
            <Donut rows={genderRows} total={collection.length} holeLabel="claimed" />
          ) : (
            <div className="empty-state small"><p>Claim someone first.</p></div>
          )}
        </div>

        <div className="panel stat-panel stat-panel-wide">
          <h2 className="section-title">Top series</h2>
          <p className="section-sub">Where your loyalty lies. The biggest sets in your collection.</p>
          {seriesRows.length > 0 ? (
            <BarChart rows={seriesRows} max={maxSeries} />
          ) : (
            <div className="empty-state small"><p>No sets yet.</p></div>
          )}
        </div>

        <div className="panel stat-panel stat-panel-wide">
          <h2 className="section-title">Hall of fame</h2>
          <p className="section-sub">Your five most valuable claims. Click to inspect.</p>
          {topFive.length > 0 ? (
            <div className="fame-row">
              {topFive.map((c, i) => (
                <button className="fame-card" key={c.id} onClick={() => setSelected(c)}>
                  <span className="fame-rank">#{i + 1}</span>
                  <img src={c.image} alt={c.name} loading="lazy" />
                  <span className="fame-name">{c.name}</span>
                  <span className="fame-value" title="Credit value">{fmt(c.creditValue)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state small"><p>Claim someone first.</p></div>
          )}
        </div>

        <div className="panel stat-panel stat-panel-wide stat-footnotes">
          <span title="Days in a row you have collected the daily offering">
            daily streak <b>{dailyStreak || 0}</b>
          </span>
          <span className="dot">·</span>
          <span>wishes pinned <b>{wishes.length}</b></span>
          <span className="dot">·</span>
          <span>
            average value{' '}
            <b>{collection.length > 0 ? Math.round(worth / collection.length) : 0}</b>
          </span>
        </div>
      </div>

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
