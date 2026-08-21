import { useEffect, useState } from 'react'
import { fmt, fmtCount } from './game/format'
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
import { useAutomaton } from './components/useAutomaton'
import PressView from './components/PressView'
import FactoryView from './components/FactoryView'
import ExpeditionsView from './components/ExpeditionsView'
import ContractsView from './components/ContractsView'

type Tab =
  | 'roll'
  | 'collection'
  | 'press'
  | 'factory'
  | 'expeditions'
  | 'contracts'
  | 'wishes'
  | 'shop'
  | 'stats'
  | 'settings'

/* Icons are Kenney's CC0 art (see src/assets/icons/LICENSE.txt). The tabs
   used to carry typographic glyphs -- ✦ ▦ ★ ⚙ -- which every platform draws
   differently and some draw in colour. */
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'roll', label: 'Summon', icon: 'cards_fan' },
  { key: 'collection', label: 'Collection', icon: 'cards_collection' },
  { key: 'press', label: 'Press', icon: 'flask_full' },
  { key: 'factory', label: 'Factory', icon: 'gear' },
  { key: 'expeditions', label: 'Expeditions', icon: 'campfire' },
  { key: 'contracts', label: 'Contracts', icon: 'crown_a' },
  { key: 'wishes', label: 'Wishes', icon: 'star' },
  { key: 'shop', label: 'Shop', icon: 'pouch' },
  { key: 'stats', label: 'Stats', icon: 'chart' },
  { key: 'settings', label: 'Settings', icon: 'gear' },
]

/**
 * Whether the works have started for this account.
 *
 * All four tabs arrive together, because they are one system: the Press mills
 * duplicates into scrap, the Factory melts scrap into credits, expeditions
 * spend a lump of it for a bigger payout later, and contracts are the goal
 * board that pays for having built a collection at all.
 *
 * Shipping them from the first summon meant a new player's first look was four
 * empty machines and a shelf they could not afford, which is a tutorial in
 * being stuck. They open on the first spare -- the first copy landing on a
 * stack with any depth to it -- which is exactly when the summon stops being
 * the whole game.
 */
function worksOpen(s: ReturnType<typeof useGame.getState>): boolean {
  const w = s.works
  return w.spares > 0 || w.scrap > 0 || w.sparesPerPull > 0 || w.out.length > 0
}

/** The four tabs that arrive together when the works open. */
const WORKS = new Set<Tab>(['press', 'factory', 'expeditions', 'contracts'])

export default function App() {
  const [tab, setTab] = useState<Tab>('roll')
  const credits = useGame((s) => s.credits)
  const coinPops = useGame((s) => s.coinPops)
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

  // The machine keeps pressing whatever screen you are on. It only waits for a
  // wrapper to be torn while there is somebody watching it happen.
  useAutomaton(tab)

  /* Sticky for the session, so a board spent back down to nothing mid-visit
     does not take its own tab away underneath the player. Not persisted: the
     snapshot answers this correctly on every load, and a flag on the device
     would show the board to the next account to sign in here. */
  const opened = useGame(worksOpen)
  const [everOpen, setEverOpen] = useState(false)
  // Adjusted during render rather than in an effect: it is derived from what
  // this render already knows, and an effect would paint the tabs away and back.
  if (opened && !everOpen) setEverOpen(true)
  const tabs = opened || everOpen ? TABS : TABS.filter((t) => !WORKS.has(t.key))

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
            {fmt(credits)} <em>credits</em>
            {/* Coins are gathered where they fall; this is the receipt rising
                off the balance they already landed in. */}
            {coinPops.map((c) => (
              <span className="coin-pop" key={c.id}>
                <Icon name="token" /> +{fmt(c.amount)}
              </span>
            ))}
          </span>
          {/* What the shop has bought so far, which is the only number here
              that can go up by playing well rather than by playing more. */}
          <span className="stat" title={packSize > 0 ? 'Cards a pack holds, and what one costs' : 'Packs unlock with the Sapphire badge'}>
            {packSize > 0 ? `×${fmtCount(packSize)} packs` : 'packs locked'}
          </span>
          <span className="stat" title="Collection size">{fmtCount(collectionSize)} owned</span>
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
        {tabs.map((t) => (
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
        {tab === 'press' && <PressView />}
        {tab === 'factory' && <FactoryView />}
        {tab === 'expeditions' && <ExpeditionsView />}
        {tab === 'contracts' && <ContractsView />}
        {tab === 'wishes' && <WishesView />}
        {tab === 'shop' && <ShopView />}
        {tab === 'stats' && <StatsView />}
        {tab === 'settings' && <SettingsView />}
      </main>

      <ToastStack />
    </div>
  )
}
