import { useEffect, useRef } from 'react'
import { useGame, useUi } from '../game/store'
import { ROUTES } from '../game/industry'

const distanceOf = (key: string) => ROUTES.find((r) => r.key === key)?.distance ?? Infinity

/**
 * The Automaton's loop.
 *
 * A plain interval that presses the same button a player would, so it can
 * never do anything a player could not: the server charges it for every pull
 * and refuses it when the balance runs out, and it switches itself off on the
 * first refusal.
 *
 * It lives at the top of the app rather than inside the summon view, because
 * it used to stop the moment you opened the Collection or the Shop -- the view
 * unmounted and took the timer with it, which is a strange way to treat a
 * machine bought for grinding while you do something else.
 */
/**
 * What the machine is allowed to do on the board.
 *
 * Any contract the collection already fulfils, any pin it has grown into, and
 * any caravan that has reached the end of its road: all three are lookups, and
 * withholding a lookup would be the game being coy. What it never does is
 * *choose* -- pinning a contract means picking which series to chase, and
 * outfitting a caravan means picking what to do with a yard full of scrap.
 * Those are the two decisions the works exist to give the player.
 *
 * Only ever from an open device. Away, the Press keeps milling and the Factory
 * keeps melting -- both are settled by `settleOffline` -- while the board and
 * the caravans wait for a hand on the button. Away costs nothing; present
 * plays the works.
 */
function clearRoutine(st: ReturnType<typeof useGame.getState>, onBoard: boolean): void {
  // One muster at a time. The machine can clear a board faster than a muster
  // plays, and a ritual interrupted by the next ritual is not a ritual.
  if (st.muster) return
  // A caravan that has arrived is money sitting in the road. Collected first,
  // because it is the only thing here that blocks a slot.
  const home = st.works.out.find((e) => e.walked >= distanceOf(e.route))
  if (home) return void st.collectExpedition(home.id)
  // A standing order to re-outfit the same road. Only ever a road the player
  // chose, only when a caravan is free and the yard can pay for it: the
  // machine repeats a decision, it never makes one.
  const repeat = useUi.getState().repeatRoute
  const road = repeat ? ROUTES.find((r) => r.key === repeat) : null
  if (road && st.works.out.length < st.works.caravans && st.works.scrap >= road.scrap) {
    return void st.sendExpedition(road.key)
  }
  const done = st.board.commissions.find((c) => c.held >= c.breadth)
  if (done) return void st.claimCommission(done.id, !onBoard)
  const next = st.board.raids.find((r) => r.held >= r.breadth)
  if (next) void st.raid(next.id, !onBoard)
}

export function useAutomaton(tab: string) {
  const autoSpin = useGame((s) => s.autoSpin)
  const autoSpinMs = useGame((s) => s.autoSpinMs)
  // A ref rather than a dependency: switching tabs should not tear the timer
  // down and start the interval again from zero.
  const tabRef = useRef(tab)
  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  useEffect(() => {
    if (!autoSpin || autoSpinMs <= 0) return
    const id = setInterval(() => {
      const st = useGame.getState()
      if (st.rolling || Date.now() + st.clockOffset < st.dealUntil) return
      if (st.packBusy()) {
        // On the summon view the wrappers are being torn on screen, and the
        // machine waits for them. Anywhere else there is nobody to watch: the
        // cards were granted when the pull was made, so the presentation is
        // settled rather than left blocking the loop forever.
        if (tabRef.current === 'roll') return
        st.finishPacks()
      }
      if (!st.canAffordPack()) {
        void st.setAutoSpin(false)
        st.pushToast('The Automaton stops: not enough credits for the next pull.', 'info')
        return
      }
      void st.roll(st.packsPerPull)
      void clearRoutine(st, tabRef.current === 'contracts')
    }, autoSpinMs)
    return () => clearInterval(id)
  }, [autoSpin, autoSpinMs])
}
