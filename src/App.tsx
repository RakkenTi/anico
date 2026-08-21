import { useEffect, useState } from 'react'
import { fmt, fmtCount } from './game/format'
import { useGame, useUi, formatDuration } from './game/store'
import { DAILY_INTERVAL_H } from './game/economy'
import { DEMO, DEMO_NOTE, DEMO_REPO } from './game/demo'
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
import ContractsView from './components/ContractsView'
import LeaderboardView from './components/LeaderboardView'
import { api } from './api'

type Tab =
  | 'roll'
  | 'collection'
  | 'contracts'
  | 'wishes'
  | 'shop'
  | 'stats'
  | 'ranks'
  | 'settings'

/* Icons are Kenney's CC0 art (see src/assets/icons/LICENSE.txt). The tabs
   used to carry typographic glyphs -- ✦ ▦ ★ ⚙ -- which every platform draws
   differently and some draw in colour. */
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'roll', label: 'Summon', icon: 'cards_fan' },
  { key: 'collection', label: 'Collection', icon: 'cards_collection' },
  { key: 'contracts', label: 'Contracts', icon: 'crown_a' },
  { key: 'wishes', label: 'Wishes', icon: 'star' },
  { key: 'shop', label: 'Shop', icon: 'pouch' },
  { key: 'stats', label: 'Stats', icon: 'cards_seek' },
  { key: 'ranks', label: 'Ranks', icon: 'podium' },
  { key: 'settings', label: 'Settings', icon: 'gear' },
]

/**
 * Whether the contract board has anything to say yet.
 *
 * A contract asks for a breadth of one series at a depth of stars, so a
 * collection of four cards can answer none of them and a board of five refusals
 * is a tutorial in being stuck. It opens once there is a collection to measure
 * against -- a few pulls in, and exactly when the summon stops being the whole
 * game.
 *
 * Counted from `totalClaims`, which the server sends in every snapshot, rather
 * than from the collection this device is holding: the collection is fetched
 * separately and only when the Collection view asks for it, so a player who
 * pulled twenty packs without opening that tab had earned the board and could
 * not see it. It is also the honest measure of the two -- distinct characters
 * ever claimed, which does not go away when you sell them.
 */
const BOARD_OPENS_AT = 40

function boardOpen(s: ReturnType<typeof useGame.getState>): boolean {
  return s.totalClaims >= BOARD_OPENS_AT
}

/** Tabs that wait for the board to open. */
const LATE = new Set<Tab>(['contracts'])

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
  const noteBuild = useGame((s) => s.noteBuild)
  const updateReady = useGame((s) => s.updateReady)
  // Anything on screen that would be thrown away by a reload: a pull in
  // flight, a wrapper not torn, a muster still being read out.
  const midHand = useGame((s) => s.rolling || s.packBusy() || s.muster !== null)
  const theme = useUi((s) => s.theme)
  const tick = useGame((s) => s.tick)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    /* Stamped rather than read: there is one layout now, and a device that
       still has an older one in its stored settings would otherwise ask for a
       stylesheet that no longer exists. */
    document.documentElement.dataset.layout = 'stage'
  }, [theme])

  useEffect(() => {
    void boot()
  }, [boot])

  /*
   * Come back to a tab that has been in the background for a week and the
   * stream may well have died somewhere in a proxy without saying so. Asking
   * once on the way back costs a header and covers the case the stream misses.
   */
  useEffect(() => {
    const ask = () => {
      if (document.visibilityState === 'visible') {
        void api.version().then((v) => noteBuild(v.build)).catch(() => {})
      }
    }
    ask()
    document.addEventListener('visibilitychange', ask)
    return () => document.removeEventListener('visibilitychange', ask)
  }, [noteBuild])

  /*
   * A new build is live, so this page is last week's. It goes as soon as there
   * is nothing on the table -- with a beat first, so the line below is read
   * rather than glimpsed.
   */
  useEffect(() => {
    if (!updateReady || midHand) return
    const id = setTimeout(() => location.reload(), 1800)
    return () => clearTimeout(id)
  }, [updateReady, midHand])

  useEffect(() => {
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])

  // The machine keeps pressing whatever screen you are on. It only waits for a
  // wrapper to be torn while there is somebody watching it happen.
  useAutomaton(tab)

  // No stickiness needed: the count it reads only ever goes up.
  const tabs = useGame(boardOpen) ? TABS : TABS.filter((t) => !LATE.has(t.key))

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
          {/* No account in the demo, so the slot that would sign you out is
              the one place every visitor looks: it points at the real thing. */}
          {DEMO ? (
            <a
              className="stat stat-user"
              href={DEMO_REPO}
              target="_blank"
              rel="noreferrer noopener"
              title={DEMO_NOTE}
            >
              demo <em>get the real thing</em>
            </a>
          ) : (
            <button className="stat stat-user" onClick={signOut} title="Sign out of this instance">
              {username} <em>sign out</em>
            </button>
          )}
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
        {tab === 'contracts' && <ContractsView />}
        {tab === 'wishes' && <WishesView />}
        {tab === 'shop' && <ShopView />}
        {tab === 'stats' && <StatsView />}
        {tab === 'ranks' && <LeaderboardView />}
        {tab === 'settings' && <SettingsView />}
      </main>

      {updateReady && (
        <div className="update-note" role="status">
          A new version of Anico is live{midHand ? ', loading when this hand is done' : ', reloading'}…
        </div>
      )}

      {DEMO && (
        <p className="demo-note">
          {DEMO_NOTE}{' '}
          <a href={DEMO_REPO} target="_blank" rel="noreferrer noopener">
            Run your own instance
          </a>
        </p>
      )}

      <ToastStack />
    </div>
  )
}
