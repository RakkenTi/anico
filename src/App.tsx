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
import BarsIcon from './components/BarsIcon'
import BagIcon from './components/BagIcon'
import AuthView from './components/AuthView'
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
  const testing = useGame((s) => s.sandbox)
  const settings = useGame((s) => s.settings)
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

  const fun = settings.mode === 'fun'
  const free = testing || fun
  const claimReady = free || now >= nextClaimAt
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
          <span className="stat" title="Summons remaining">{free ? '∞' : rollsLeft} summons</span>
          <span className={`stat ${claimReady ? 'stat-ready' : ''}`} title="Claim status">
            {free ? 'claim any time' : claimReady ? 'claim ready' : `claim ${formatDuration(nextClaimAt - now)}`}
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
