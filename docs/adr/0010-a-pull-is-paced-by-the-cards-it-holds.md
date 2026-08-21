# A pull is paced by the cards it holds

Open Speed is quoted in cards a second. At twenty-nine thousand a second, a pull
of a hundred and ninety-three thousand cards should take about six and a half
seconds, and it took about half of one. Buying more Open Speed changed nothing,
because nothing about the number was reaching the clock.

The reason is the gap between what a pull *holds* and what it *deals*. A pull
holds what the wrappers say — ADR 0007 — and deals at most a thousand real
cards, each standing in for the two hundred behind it. The opener paced its
throws by the dealt count, so every card thrown was worth two hundred and the
whole pull emptied in the time nine hundred cards should take. The rate on the
screen and the rate in the timer were different numbers with the same name.

**The clock runs on the pull's real total.** `rate` is real cards a second for
the pull as a whole; the throws are paced at whatever share of that the dealt
cards represent. It is never per pack: a rate per wrapper would make every level
of Extra Packs a free doubling of Open Speed, which is not what that line is
for, and which would make the two upgrades impossible to price against each
other. Floored at six-tenths of a second so a pull is still something that
happens, capped at eight so a pack that has outgrown the hands entirely still
ends.

## What this forces elsewhere

Pacing a pull honestly means it now lasts as long as it says it will, which is
several seconds of seventeen wrappers all shedding cards — the exact interval
that used to be over before the browser noticed. Everything below is a
consequence of that interval being real, and every one of them was measured
rather than reasoned about.

- **A layer is one write.** Every wrapper sheds cards on the same clock, so they
  are advanced together, in a single store write. Seventeen stacks writing
  separately was seventeen renders of the summon screen per tick. What scatters
  them on screen is *when each card is animated*, not when its counter changed.
- **A card in the air is a budget, not a per-stack allowance.** A flight is an
  animation of a whole card, artwork included, so about twenty may be in the air
  at once for the pull: one pack throws four at a time, seventeen throw one
  each. Every stack still visibly throws — a counter that drops while nothing
  moves reads as broken — but the total is bounded.
- **Flights stay off the main thread.** A keyframe that reads a custom property
  can never be handed to the compositor. The travel is a percentage of the
  card's own width on an element of its own, and the direction is a class rather
  than a sign, so the distance still scales with the pack and the animation
  still composites.
- **The pile leans, and does not ease.** A transition on the pile's transform
  sets every mounted card animating a non-compositable transform every time a
  card leaves. The lean travels twenty pixels over an entire pull; there is
  nothing to smooth.
- **Sound is rationed centrally.** A pull asks for a flip per card, a flourish
  per wrapper and a riffle per spread, all at once and none of it waiting: a few
  hundred voices inside a tenth of a second, summing past full scale, which
  comes out as clipping rather than as a loud game. A few voices may share any
  tenth of a second; one sample may not restart faster than an ear can separate
  it from itself; the sounds that are the point rather than the texture are
  exempt from the crowd but not from their own gap; and a limiter across the
  master bus catches whatever still lands together.
- **A pull answers without the collection.** The summon response used to carry
  everything the player owns — thousands of characters with artwork, a megabyte
  and climbing — rebuilt and re-sent on every press, several times a second with
  the Automaton running. Nothing on the summon screen reads it. The revision
  counter still moves, so the collection screen asks for a fresh copy when
  somebody looks at it.
- **A big spread takes the pane it is given.** Columns are sized rather than
  counted past twenty cards, so a thousand cards fill the width instead of
  sitting in a strip meant for ten.
- **Receipts do not stand in front of the game.** On a phone, four toasts reach
  from the tab bar into the middle of the pack grid, which is where the button
  that opens the packs is. Two at a time there, and a tap goes through them.

## Keeping it

`npm run stress` stands up a throwaway instance and plays it at four rungs —
ten thousand cards a pull, a hundred and ninety-four thousand, seven hundred and
eighty-two thousand, ten million — plus a phone. It checks the press-to-wrappers
delay, the frame gap while a pull empties, the opening against what Open Speed
promised, voices in the same tenth of a second, whether the spread uses its
pane, whether the button that opens a pack is reachable, and whether the shop
answers with the machine running. Every number in this ADR came out of it, and
every problem it checks for is one that shipped.
