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
 * Exactly one thing: fulfil a contract the collection already answers. That is
 * a lookup, and withholding a lookup would be the game being coy. What it
 * never does is *choose* -- which series to chase is the decision the board
 * exists to give the player, and Auto Aim is the upgrade that sells it back.
 *
 * Only ever from an open device. Away, the Automaton is paid for the packs it
 * opened (`settleOffline`) and the board waits for a hand on the button.
 */
function clearRoutine(st: ReturnType<typeof useGame.getState>, onBoard: boolean): void {
  // One muster at a time. The machine can clear a board faster than a muster
  // plays, and a ritual interrupted by the next ritual is not a ritual.
  if (st.muster) return
  const next = st.board.find((r) => r.held >= r.breadth)
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
      // The instance paces pulls too, and refuses an early one. The machine's
      // interval and that pace are the same number, so a tick that arrives a
      // moment early waits for the next one rather than being turned away --
      // a refusal switches the machine off.
      if (Date.now() < st.nextPullAt) return
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
