# A sandbox is seeded to a stage, and plays by the ordinary rules

The sandbox was pinned to one constant:

```ts
const SANDBOX_MAX_DRAW = 100
```

Everything followed from it. `packSizeFor` threw away the player's Pack Size and
returned a hundred, `roll` set `total` to it and the price to zero, and
`pack = multi && !sandbox` meant a sandbox pull was always a plain spread of
exactly a hundred cards. It was the ×100 summon, and it was the whole game in
the version that shipped it.

So the sandbox could not reach a sealed pack, a wrapper, `Longer Table`, the
Emerald guarantee, or the Automaton. It could not reach the overflow either:
`MIN_DEALT` is 200 against a pull of 100, so `overflow` was always zero and the
dealt-versus-appraised split, which is what Wider Deal and Open Speed actually
sell, could not occur. A hundred cards against a catalog of tens of thousands
produces no duplicates, so nothing merged, and a collection that never merges
answers no contract.

The seed matched. `250_000` credits, empty badges, empty upgrades, from the
commit that *introduced* the incremental shop, unchanged while the shop grew a
line whose first level costs ten billion. That quarter million does not buy one
level of seven of the fifteen lines, including every ceiling. Badges being empty
meant packs started locked. The debug button granted a thousand credits a click.

**A stage seeds the profile and then stops.** Badges, upgrades, credits and a
collection are written, and after that nothing about a sandbox profile is
special: the summon it presses is the summon everybody else presses. That is the
correction. A sandbox with rules of its own tests the sandbox, which is why
`SANDBOX_MAX_DRAW` and every branch under it are gone.

What still keys off the sandbox is only what is there for safety or for the one
rule a tester genuinely wants skipped: it stays off the leaderboard, it accrues
nothing offline, its daily is always ready, and a pull is not paced.

## One ladder, not two

`scripts/stress.mjs` already described what the game looks like at a stage, in
rungs it runs on every release, with the seeding to match. A second ladder for
the sandbox would drift from it within a release or two, so there is one:
`server/sandbox.ts` seeds, `src/game/sandbox.ts` holds the table the settings
screen reads, and the harness calls the same functions rather than keeping its
own. The harness still pins its own ceilings and credit pile, because its
budgets were measured against those and a rung that moves them is not comparable
with the run before it.

Stocking draws real characters from the catalog, most-favourited first. It used
to invent them at ids 1000 upward, which worked only because the harness seeds a
catalog at exactly those ids; against a real one it is a foreign key violation,
and a collection of characters the catalog has never heard of is no good for
testing anyway, because the pool draw, the series count and every contract read
those rows.

## The rule this cannot break

Every one of these writes guards on `player.sandbox_of` inside `game`, never at
the route. The shadow profile is the only thing they may reach. A seeding route
that can be aimed at a real profile is a save-wiper, and the guard being one
line at the top of each function is what makes that checkable.

The demo has none of it: it has no accounts to grant the privilege to, and a
stage is a rule, which the server owns (ADR 0003).
