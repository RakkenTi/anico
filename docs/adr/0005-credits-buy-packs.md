# Credits buy packs, and everything else costs exponentially more

The first version of this game with no cooldowns (ADR 0004) had one flaw that
only shows up once somebody plays it: credits had nothing to do. Packs were
free, every card in one could be sold, and the entire shop cost about twenty
thousand credits. A player could finish the whole tree in ten minutes and then
own a game with no unbought thing left in it.

Two changes, together:

**A pack costs credits.** Twelve per card, so the ×25 Sapphire ends on is 300
and a ×100 is 1,200 — comfortably less than the cards inside are worth, which
makes opening one and selling what you did not want the loop the game runs on.
The single summon stays free, so an empty balance is never a dead end: it means
selling something first, not waiting.

**Everything in the shop costs a multiple of the last one.** Badge levels are
three times the level below them; upgrade lines multiply by 1.6 to 2.4 each
time. The shop also grew a second half — four upgrade lines with no meaningful
last level — so there is always a next number to climb toward.

## Why a sink rather than a slower faucet

The obvious alternative was to pay less: smaller sell values, stingier
duplicates. That slows everyone down uniformly and makes the early game worse,
which is exactly backwards — the first ten minutes should be generous. Charging
for packs instead means income and spending both scale with how much you play,
and the curve comes from the prices rather than from the drip.

It also gives the upgrades something to be *for*. Deeper Packs, Swift Hands and
Appraisal are all throughput: more cards per press, less time per pack, more
credits per card. That is a loop that speeds up as you invest in it, against
prices that rise faster than it does — which is the shape of a game rather than
a checklist.

## Consequences

- A player who keeps everything and sells nothing earns very little. That is a
  real choice with a real cost, and it is the only one the game asks.
- The numbers get big. A finished shop is somewhere north of a million credits,
  and the last upgrade levels are deliberately out of reach of an evening.
- Anything that pays out per card — the Emerald IV dowry, duplicate
  compensation — is now load-bearing on balance, so it is quoted as a fraction
  of a card's value rather than the whole of it.
- Selling is the main faucet, so the collection screen quotes what a card will
  actually fetch (Appraisal included) rather than its sticker value.
