import { useEffect, useRef } from 'react'
import { useGame } from '../game/store'

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
 * Any raid the collection already answers, and any commission it has grown
 * into: both are lookups, and withholding a lookup would be the game being coy
 * (ADR 0013). What it never does is *choose* -- taking a commission on means
 * picking which series to chase, and that is the decision the mechanic exists
 * to give the player.
 *
 * Only ever from an open device. Away, the Refinery keeps filling and the
 * board keeps waiting, which is the whole of "away costs nothing, present
 * plays the board".
 */
function clearRoutine(st: ReturnType<typeof useGame.getState>): void {
  const done = st.board.commissions.find((c) => c.held >= c.breadth)
  if (done) return void st.claimCommission(done.id)
  const next = st.board.raids.find((r) => r.held >= r.breadth && st.scrip >= r.cost)
  if (next) void st.raid(next.id)
}

export function useAutomaton(watching: boolean) {
  const autoSpin = useGame((s) => s.autoSpin)
  const autoSpinMs = useGame((s) => s.autoSpinMs)
  // A ref rather than a dependency: switching tabs should not tear the timer
  // down and start the interval again from zero.
  const watchingRef = useRef(watching)
  useEffect(() => {
    watchingRef.current = watching
  }, [watching])

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
        if (watchingRef.current) return
        st.finishPacks()
      }
      if (!st.canAffordPack()) {
        void st.setAutoSpin(false)
        st.pushToast('The Automaton stops: not enough credits for the next pull.', 'info')
        return
      }
      void st.roll(st.packsPerPull)
      void clearRoutine(st)
    }, autoSpinMs)
    return () => clearInterval(id)
  }, [autoSpin, autoSpinMs])
}
