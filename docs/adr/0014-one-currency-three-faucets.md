# One currency, three faucets

> **Superseded by ADR 0015.** One currency and one shop survive, and so does
> the contract board. The three faucets do not: pricing the Factory as a share
> of the whole summon, where the share was itself an endless shop line, put the
> economy's growth exponent above one and a save reached 1e110 in ten minutes.
> The Press, the Factory and Expeditions are removed.

ADR 0013 built a second economy because credits could not be made to matter
again: by a quadrillion the shop was finished and any new mechanic paid in
credits joined a river already flowing at Qa a second. Scrip and Renown were
the answer, and they worked in the sense that the new mechanic mattered.

They also did something nobody asked for. Renown bought five lines, and four
of them were the **summon's** own ceilings: how deep a stack merges, how many
real cards a press deals, how many wrappers fit on a screen, and where a share
of a pull is aimed. Reaching them meant playing raids, raids cost Scrip, Scrip
came from spare copies, and spare copies came from the summon. The summon's
progression was behind a different mechanic, and that mechanic was behind the
summon.

The complaint that ended it: upgrades should not lock each other across
mechanics, and raids should be just another way to earn money, the way summons
are.

## One currency

Everything pays credits. Every upgrade is bought in one shop, with credits,
and nothing in this game is a prerequisite for anything else. The five Renown
lines became five shop lines and nobody paid twice: the migration copies each
level across.

What chains between mechanics is **material, not permission**. You are never
told you may not buy a thing, only that a machine is hungry:

    summon -> spare copies -> [Press] -> scrap -> [Factory]     -> credits
                                            \
                                             -> [Expeditions]   -> credits, later

That is a flow, not a gate. A player who never touches the Press still buys
everything in the shop; they just have an idle Factory.

## Why the works still matter at a quadrillion

This is the problem ADR 0013 invented a currency to solve, and it turns out a
currency was not needed -- only an honest denominator.

A press deals at most a bounded number of real cards however many million the
pull holds, so **scrap arrives at a flat rate** of about one a press. A pull is
exponential and by the late game holds hundreds of thousands of cards. So a
scrap priced at a fixed number of *cards* is a rounding error the moment Pack
Size gets going: measured against a real end-game player it was 0.1% of the
summon, which is a faucet nobody would ever open.

Priced as a fraction of a **press**, it tracks. `scrapWorth` is the Foundry's
fraction times the size of this player's own pull, so the Factory is a fixed
share of whatever the summon has become -- 0.8% of it at Foundry level zero,
parity around level ten, better after that. The same trick pays contracts and
expeditions: a contract stores what it is worth in *presses* and the server
multiplies it out at payout time. A prize quoted in presses is the same size
of prize at ten thousand credits and at a quadrillion.

The Foundry never runs away with it, because the belt can only pull what the
Press made and the Press is fed by a flat stream. More Foundry buys a bigger
share of the summon; it cannot buy a bigger summon.

## Three faucets, three shapes

Three taps into one currency stay distinct only if they pay differently. Each
reads a different number off the collection:

- **The Press** reads how *deep* it is -- a copy sheds as much scrap as the
  stack it lands on is full. Always running, here or away.
- **The Factory** is steady throughput. Every press, and every hour away.
- **Expeditions** spend a lump of scrap now for a much larger lump of credits
  later, paced in presses. About thirteen times what that scrap would have
  earned on the belt, in exchange for locking it up for the length of a road.
- **Contracts** read *breadth at depth* -- so many of one series, merged so
  far. Free to enter, lumpy, and the only thing in the game that makes one
  particular character worth wanting.

## No clocks, still

ADR 0004 took every timer out of this game on the grounds that pacing makes an
app you cannot play when you happen to open it, and an expedition is normally
a timer with a hat on. So a caravan advances **one step per press**. A player
who closes the tab for a week comes back to the caravan exactly where they
left it, and it moves the moment they press again. Scarcity is caravans, not
minutes.

## Four tabs, four machines

The other half of the same complaint: raids had no visuals, nothing like the
card opening a summon has, and there was a press sitting inside the raids menu
for no reason anybody could see. The Press, the Factory, expeditions and
contracts were one page sharing four panels, and three of them were prose
around a number.

Each is now its own tab with its own machine, and each machine is driven by
the player's real rate rather than by a decorative loop: the ram's cadence is
the actual scrap rate, the belt's speed is the actual throughput, the caravan's
position is the actual distance walked. Buying an upgrade visibly speeds the
machine up, which is the only reason to draw one at all.

Each view owns its own stylesheet under `src/styles/`, which is a departure
from the single `index.css` this project had. Four of them were built at once
and one shared file is one shared merge conflict.

## What this costs

Renown's five lines were priced in a currency nobody else could reach, so
they were a genuine chase. As credit lines they are priced steeply, but a
player rich enough will clear the capped ones quickly and be left with the
endless ones -- which is how every other line in this shop has always aged.
The endless lines (Foundry, Belt Speed, Outfitters) are what absorb a late
game, and they were the thing the shop was actually missing.
