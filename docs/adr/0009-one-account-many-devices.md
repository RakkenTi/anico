# One account, several devices, all playing at once

A phone on the sofa and a desktop upstairs, both signed in, both with Auto Summon
running. This should work, and it should be worth doing: two devices pressing
the button really are two presses.

Two things were missing. Devices only heard about their own requests, so a
balance spent on the desktop stayed on screen upstairs until something forced a
refetch. And the Auto Summon switch had been moved to the server for offline
earnings, which quietly made it global: turning the machine on upstairs turned
the phone's on too, and turning the phone's off stopped both.

**The switch is per device; the state is pushed to all of them.** Each tab
decides whether its own machine runs. Every mutation publishes the authoritative
snapshot to every stream that player has open (SSE, one room per player), and
clients apply what arrives without merging anything. Measured: one device draws
100 cards in twenty seconds, two draw 200.

## Why there is no command queue

The obvious worry with several devices is two of them acting on the same thing:
both selling card #50, both buying the last badge with the money for one. The
usual answer is a queue that serialises commands.

There is already one. The server is a single Node process and better-sqlite3 is
synchronous, so a request handler runs from its first read to its last write
with nothing interleaved, and SQLite's own transaction wraps the writes. Adding
a queue in front of that would add latency and no safety.

What was worth doing instead is making the *outcomes* correct rather than
assuming the ordering holds forever:

- **Spending is conditional in SQL** (`SET credits = credits - ? WHERE credits
  >= ?`) and refuses when it does not apply, so a balance cannot go negative
  even if the read and the write were ever to drift apart.
- **Selling matches rows rather than ids.** Thirty concurrent sales of the same
  card produce one sale and twenty-nine refusals, because the second one finds
  nothing to delete.
- **Buying re-reads the level inside the transaction.** Twenty concurrent
  purchases of one badge produce one level and nineteen refusals.

All three are tested by firing the requests concurrently at a live instance
rather than by reasoning about them.

## What this forces elsewhere

- **The collection is not pushed.** It can be five figures of cards and most
  updates do not touch it, so the snapshot carries a revision number instead and
  a device looking at the collection fetches it when that moves.
- **The stream opens wherever a session begins**, not only on boot. Signing in
  on a fresh tab used to leave that tab deaf.
- **Streams are capped per player** and the oldest is dropped, because a tab
  that never closes cleanly would otherwise accumulate.
