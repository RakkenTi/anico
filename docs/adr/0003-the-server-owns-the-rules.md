# The server owns the rules

Anico began as a browser-only game whose store enforced its own timers: the roll budget,
the claim cooldown, the daily offering and the ritual were all decided by `Date.now()` in
the player's tab. With accounts on a shared instance, that stops being tenable. The server
now owns every rule that can be cheated: the RNG that decides what you rolled, the budgets
and cooldowns, the economy, and whether an account is in sandbox. The client renders what
the server returns.

The concrete trigger was sandbox. Sandbox lifts every limit in the game and is an admin
privilege, so it cannot be a flag the browser sets; and once one privilege has to be
server-side, the other thirteen timing sites have exactly the same problem.

## Consequences

- A roll is a round trip. The client keeps its flip cascade, sounds and optimistic
  rendering, but the cards themselves arrive from the instance.
- Two clocks now exist. Cooldown timestamps come from the server clock, so the client
  measures the offset on every snapshot and displays timers against it; a browser whose
  clock is a minute fast would otherwise show "claim ready" a minute early.
- The game cannot be played offline, which the PWA scope already accepted.
- Presentation settings (theme, layout, volume) deliberately stay on the device. They are
  not rules, nobody can gain anything by lying about them, and syncing them would let a
  phone dictate how the app looks on a laptop.

## A preference is not a rule

The line between the two moved once, and it is worth writing down which side
things fall on. **Who shows up in a roll** (waifus, husbandos, everyone),
**what happens to the cards you did not want** (auto-sell) and **whether
duplicates are skipped** are preferences: they change the game you are playing
without changing what it pays.

**How wide a net a roll casts is not.** The top two thousand characters are
worth several times what the long tail is, so a narrow pool is a straightforwardly
richer game, and a player who could pick their own was playing a different one
from the person beside them. It belongs to the instance now, set once by its
admin, and every roll on the instance draws from it.
