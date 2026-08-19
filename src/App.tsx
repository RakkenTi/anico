import { useEffect, useState } from 'react'
import { useGame, formatDuration } from './game/store'
import { DAILY_INTERVAL_H } from './game/economy'
import { sfx } from './game/sound'
import RollView from './components/RollView'
import CollectionView from './components/CollectionView'
import WishesView from './components/WishesView'
import ShopView from './components/ShopView'
import StatsView from './components/StatsView'
import SettingsView from './components/SettingsView'
import BarsIcon from './components/BarsIcon'
import BagIcon from './components/BagIcon'
import ToastStack from './components/ToastStack'

type Tab = 'roll' | 'collection' | 'wishes' | 'shop' | 'stats' | 'settings'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'roll', label: 'Summon', icon: '✦' },
  { key: 'collection', label: 'Collection', icon: '▦' },
  { key: 'wishes', label: 'Wishes', icon: '★' },
  { key: 'shop', label: 'Shop', icon: <BagIcon /> },
  { key: 'stats', label: 'Stats', icon: <BarsIcon /> },
  { key: 'settings', label: 'Settings', icon: '⚙' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('roll')
  const credits = useGame((s) => s.credits)
  const rollsLeft = useGame((s) => s.rollsLeft)
  const collectionSize = useGame((s) => s.collection.length)
  const now = useGame((s) => s.now)
  const nextClaimAt = useGame((s) => s.nextClaimAt)
  const lastDailyAt = useGame((s) => s.lastDailyAt)
  const dailyStreak = useGame((s) => s.dailyStreak)
  const testing = useGame((s) => s.settings.testingMode)
  const claimDaily = useGame((s) => s.claimDaily)
  const theme = useGame((s) => s.settings.theme)
  const layout = useGame((s) => s.settings.layout)
  const tick = useGame((s) => s.tick)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.layout = layout
  }, [theme, layout])

  useEffect(() => {
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])

  const claimReady = testing || now >= nextClaimAt
  const dailyAt = lastDailyAt + DAILY_INTERVAL_H * 3_600_000
  const dailyReady = testing || now >= dailyAt

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
          <span className="stat" title="Rolls remaining">{testing ? '∞' : rollsLeft} rolls</span>
          <span className={`stat ${claimReady ? 'stat-ready' : ''}`} title="Claim status">
            {claimReady ? 'claim ready' : `claim ${formatDuration(nextClaimAt - now)}`}
          </span>
          <span className="stat" title="Collection size">{collectionSize} owned</span>
          <button
            className={`stat stat-daily ${dailyReady ? 'stat-ready' : ''}`}
            disabled={!dailyReady}
            onClick={claimDaily}
            title={dailyReady ? 'Collect your daily offering' : `Daily offering in ${formatDuration(dailyAt - now)}`}
          >
            {dailyReady ? 'daily ready' : `daily ${formatDuration(dailyAt - now)}`}
            {dailyStreak > 1 && <span className="streak"> ×{dailyStreak}</span>}
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
            <span className="tab-kanji">{t.icon}</span>
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
