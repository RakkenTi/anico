import { useEffect, useState } from 'react'
import { useGame, useUi, formatDuration } from './game/store'
import { DAILY_INTERVAL_H } from './game/economy'
import { sfx } from './game/sound'
import RollView from './components/RollView'
import CollectionView from './components/CollectionView'
import WishesView from './components/WishesView'
import ShopView from './components/ShopView'
import StatsView from './components/StatsView'
import SettingsView from './components/SettingsView'
import Icon from './components/Icon'
import type { IconName } from './game/icons'
import AuthView from './components/AuthView'
import ToastStack from './components/ToastStack'

type Tab = 'roll' | 'collection' | 'wishes' | 'shop' | 'stats' | 'settings'

/* Icons are Kenney's CC0 art (see src/assets/icons/LICENSE.txt). The tabs
   used to carry typographic glyphs -- ✦ ▦ ★ ⚙ -- which every platform draws
   differently and some draw in colour. */
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'roll', label: 'Summon', icon: 'cards_fan' },
  { key: 'collection', label: 'Collection', icon: 'cards_collection' },
  { key: 'wishes', label: 'Wishes', icon: 'star' },
  { key: 'shop', label: 'Shop', icon: 'pouch' },
  { key: 'stats', label: 'Stats', icon: 'chart' },
  { key: 'settings', label: 'Settings', icon: 'gear' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('roll')
  const credits = useGame((s) => s.credits)
  const packSize = useGame((s) => s.packSize)
  const collectionSize = useGame((s) => s.collection.length)
  const now = useGame((s) => s.now)
  const lastDailyAt = useGame((s) => s.lastDailyAt)
  const dailyStreak = useGame((s) => s.dailyStreak)
  const testing = useGame((s) => s.sandbox)
  const username = useGame((s) => s.username)
  const claimDaily = useGame((s) => s.claimDaily)
  const booting = useGame((s) => s.booting)
  const authed = useGame((s) => s.authed)
  const boot = useGame((s) => s.boot)
  const signOut = useGame((s) => s.signOut)
  const theme = useUi((s) => s.theme)
  const layout = useUi((s) => s.layout)
  const tick = useGame((s) => s.tick)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.layout = layout
  }, [theme, layout])

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])

  const dailyAt = lastDailyAt + DAILY_INTERVAL_H * 3_600_000
  const dailyReady = testing || now >= dailyAt

  if (booting) {
    return (
      <div className="auth-shell">
        <div className="boot-note">Reaching the instance…</div>
      </div>
    )
  }
  if (!authed) return <AuthView />

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-name">ANICO</span>
          {testing && <span className="sandbox-tag">SANDBOX</span>}
        </div>
        <div className="header-stats">
          <span className="stat stat-credits" title="Credit balance">
            {credits.toLocaleString()} <em>credits</em>
          </span>
          {/* What the shop has bought so far, which is the only number here
              that can go up by playing well rather than by playing more. */}
          <span className="stat" title={packSize > 0 ? 'Cards a pack holds, and what one costs' : 'Packs unlock with the Sapphire badge'}>
            {packSize > 0 ? `×${packSize} packs` : 'packs locked'}
          </span>
          <span className="stat" title="Collection size">{collectionSize} owned</span>
          {/* Reads as a button rather than another read-out: the old version sat
              in a row of plain stats and nobody could tell it was clickable. */}
          <button
            className={`stat stat-daily ${dailyReady ? 'daily-ready' : ''}`}
            disabled={!dailyReady}
            onClick={claimDaily}
            title={dailyReady ? 'Collect your daily offering' : `Daily offering in ${formatDuration(dailyAt - now)}`}
          >
            <Icon name="token" className="daily-coin" />
            {dailyReady ? 'collect daily' : `daily ${formatDuration(dailyAt - now)}`}
            {dailyStreak > 1 && <span className="streak"> ×{dailyStreak}</span>}
          </button>
          <button className="stat stat-user" onClick={signOut} title="Sign out of this instance">
            {username} <em>sign out</em>
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => {
              if (t.key !== tab) sfx.tap()
              setTab(t.key)
            }}
          >
            <Icon name={t.icon} className="tab-kanji" />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === 'roll' && <RollView />}
        {tab === 'collection' && <CollectionView />}
        {tab === 'wishes' && <WishesView />}
        {tab === 'shop' && <ShopView />}
        {tab === 'stats' && <StatsView />}
        {tab === 'settings' && <SettingsView />}
      </main>

      <ToastStack />
    </div>
  )
}
