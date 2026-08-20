/**
 * Live updates, one room per player.
 *
 * A player is one account on several devices: a phone and a desktop, each with
 * its own Auto Summon pressing the same button. The server was always the
 * authority (ADR 0003), so nothing about that is unsafe -- but a device that
 * only hears about its own requests shows a balance that is quietly wrong, and
 * two of them disagree about how much money you have.
 *
 * Every mutation publishes the authoritative snapshot to every stream that
 * player has open. Devices do not talk to each other and never merge anything:
 * they are told what is true, in the order the server decided it.
 */

type Send = (payload: string) => void

const rooms = new Map<number, Set<Send>>()

/** How many streams one player may hold open, across every device. */
const MAX_STREAMS = 12

export function subscribe(playerId: number, send: Send): () => void {
  let room = rooms.get(playerId)
  if (!room) {
    room = new Set()
    rooms.set(playerId, room)
  }
  // A tab that never closes cleanly would otherwise accumulate: the oldest
  // stream goes rather than the newest being refused, because the newest is
  // the one somebody is actually looking at.
  while (room.size >= MAX_STREAMS) {
    const oldest = room.values().next().value
    if (!oldest) break
    room.delete(oldest)
  }
  room.add(send)
  return () => {
    const set = rooms.get(playerId)
    if (!set) return
    set.delete(send)
    if (set.size === 0) rooms.delete(playerId)
  }
}

/** Tell every other device what just became true. */
export function publish(playerId: number, snapshot: unknown): void {
  const room = rooms.get(playerId)
  if (!room || room.size === 0) return
  // The collection can hold five figures of cards and most updates do not
  // touch it, so it is never pushed: the snapshot carries a revision number
  // and a device that is looking at the collection fetches it when that moves.
  const light = { ...(snapshot as Record<string, unknown>) }
  delete light.collection
  const payload = JSON.stringify(light)
  for (const send of [...room]) {
    try {
      send(payload)
    } catch {
      room.delete(send)
    }
  }
}

/**
 * Streams this player has open, across every device.
 *
 * Zero means nobody is watching, which is what "offline" has to mean when an
 * account can be signed in on a phone and a desktop at once: Offline Earnings
 * pays for the hours *nothing* was connected, not for the hours one particular
 * tab happened to be closed.
 */
export function streamsFor(playerId: number): number {
  return rooms.get(playerId)?.size ?? 0
}

/** Streams currently open, for the admin panel and for tests. */
export function streamCount(): number {
  let n = 0
  for (const room of rooms.values()) n += room.size
  return n
}
