# Nothing is paced; the shop is the whole of the progression

The game used to keep time. There was an hourly budget of single summons, a once-a-day
×10, and a claim you could make once an hour — Normal mode — and a Fun mode with none of
that, which every player picked and which was the default. Two modes meant every rule was
written twice: a cooldown column, a "does this player answer to it" branch, a snapshot
field reported as spent when it did not apply, and a shop selling time back to whoever
was still paying it.

**Fun is now the only mode.** Summoning and claiming cost nothing and wait for nothing.
Modes, roll budgets, claim cooldowns, the daily ×10 timer and the Claim Reset ritual are
gone from the rules, the schema and the API.

The reason is who plays this. An instance is a handful of friends on somebody's home
server, not a public guild that needs its economy rationed. Pacing there does not create
tension; it creates an app you cannot play when you happen to open it. The one player who
would have chosen limits could already choose them, and did not.

Removing pacing leaves the shop with nothing to sell, so what a badge buys changed:

- **Sapphire** buys packs, which is the progression: a fresh account has one card a
  summon and nothing else, and Sapphire I is the moment a summon becomes ten. II, III and
  IV take it to 15, 20 and 50.
- **Emerald** buys a floor: every pack is guaranteed a Rare, then an Epic, then a
  Legendary, then a Mythic.
- Bronze, Silver, Gold and Ruby keep what they did, which never depended on a clock.

## Consequences

- The interesting question is no longer "may I summon" but "how much is one summon
  worth", which is a thing to save for rather than a thing to wait out.
- Nothing stops a player pulling packs all evening. That is the point, and the economy
  already assumed it: Fun mode was the default and had no limits either.
- A player who wants the game to last longer has to impose that on themselves. There is
  no setting for it, and adding one back would re-open every branch this removed.
- The dead columns (`rolls_left`, `rolls_reset_at`, `next_claim_at`, `last_multi_at`,
  `last_ritual_at`) are dropped rather than left in place, so nothing can quietly start
  reading a timer again.
