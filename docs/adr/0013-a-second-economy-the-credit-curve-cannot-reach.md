# A second economy the credit curve cannot reach

By a quadrillion credits the game has nothing left to sell. Every badge costs
63.9M in total and every upgrade line that ends costs 10.4B between them, so
the entire *shape* of the game is bought five orders of magnitude before Qa.
What remains is six multiplicative lines against six exponentials, and even
those stop being visible long before they stop costing money: Open Speed stops
changing what you see at level 11, where six seconds of cards first reaches the
thousand-card deal cap, and Extra Packs stops adding wrappers at level 23,
where `MAX_STACKS` is reached. At the 1Qa rung a player is at level 40 and 30
of those lines. Twenty-nine levels of one, seven packs a press of the other,
buying nothing anybody can see.

The collection is finished too. There are about eighty thousand characters in a
warm catalog and eleven Mythics in the world; series sets stop paying at ten;
wish slots stop mattering once you own everything.

**Credits cannot fix this, because credits are the problem.** Any new mechanic
paid in credits joins a river flowing at Qa a second and is irrelevant on
arrival. So the second economy is denominated in something the curve cannot
inflate.

## The flat stream

`takeAll` writes claims only for the cards a pull *deals*, and `dealtFor` caps
that at a thousand however large the pull is — the rest is appraised into
credits and never becomes a copy. A pull of ten thousand cards and a pull of
ten million both produce at most a thousand claims. Credits grow exponentially
with Pack Size; copies do not grow at all.

That flat thousand-a-press is the base of everything here. It is the one
quantity in the game that no upgrade can multiply, which is exactly what makes
it safe to build on.

## The shape

A **spare** is what a stack that has already merged twelve times sheds. At ★12
a stack is four thousand copies of one character, and what one more copy adds
is its face value against a merged core worth, at Merge Value L36, about 1.9
quadrillion times face value — arithmetically nothing. From there on every copy
that lands also drops a spare into the Refinery.

The line is fixed at twelve rather than at the player's own cap. Tying it to
the cap was the first attempt and it was wrong: buying Deeper Merges switched
the Refinery off until every stack had doubled again, which is a hundred hours
at end-game rates, so the strongest line in the tree disabled the economy that
pays for it. A stack still stops growing at its own cap; it just keeps
shedding. It also means the Refinery only ever runs for a collection deep
enough to have maxed stacks, which is exactly the player this is for.

- The **Refinery** converts spares to **Scrip** at a flat rate, per spare and
  never by credit value. Paying by value would make feeding spare Mythics
  optimal and a player would shred their best stacks to feed a machine, which
  is the "send the Mythics" failure wearing an apron. A flat rate denominates
  the whole second economy in *presses*.
- A **Raid** names a series and asks for a breadth of its cast at a depth of
  stars. It costs Scrip and pays **Renown**. It is a test of what you already
  hold, resolved the moment it is attempted.
- A **Commission** is a raid you accept rather than answer: it names something
  just past your reach and pays when your collection gets there. Slots are
  few, so taking one means declining another.
- **Renown** buys a second badge tree, and like the first one it finishes.

## What a character is allowed to be

An earlier attempt at raiding failed because characters were, in the end,
randomised stats. The rule that comes out of that is stronger than "do not
invent numbers": **no mechanic may derive power from credit value either.**
Credit value *is* favourites and rarity *is* credit value, so a raid scored on
value is a raid whose answer is always "send the eleven Mythics" — a lookup
wearing the costume of a decision.

That leaves series, gender, copies and stars as the only things a character
genuinely is. Series is the one with combinatorial structure: a warm catalog
holds up to ten thousand of them, and the game already asserts that breadth in
a series means something, because series sets pay at three, five and ten. A
raid on *Frieren* is not satisfiable by Levi at any rarity, which is the whole
point.

## Renown is a lever, not a faucet

Renown is not convertible to credits in either direction. It is still the
strongest progression in the game, because what it buys are the ceilings the
credit engine runs into:

- **`MAX_STARS`.** `stackValue` is `value × mergeMult ^ stars`, so one extra
  star is a flat ×18.8 on every maxed stack at Merge Value L36. Matching that
  with credits takes eighteen levels of Sell Value.
- **`MAX_DEALT`.** Raising it from a thousand to ten thousand costs about 3.9%
  of a pull's credits — a dealt duplicate pays 16% of sell value where an
  appraised card pays 100% — and multiplies the spare stream tenfold.
- **`MAX_STACKS`.** Un-freezes Extra Packs, which past level 23 has been
  bought and not seen.

A faucet adds income to a river. A lever changes what the engine can do, so it
is worth more the more has already been built — which is the opposite of how
everything else in the shop ages.

The star lines are gated by the flat stream rather than by money: ★13 needs
8,192 copies of one character and copies arrive a thousand a press whatever
you own. Progression is re-coupled to being there, which is what Qa lost.

## Nothing waits for a clock

ADR 0004 removed every timer in the game on the grounds that pacing "creates an
app you cannot play when you happen to open it". Commissions were designed to
expire, which is that mistake exactly. **Scarcity is slots, not time.** A
commission board holds a few at once and taking one means declining another;
nothing rots while nobody is looking, and a player who opens the game after a
week finds everything they left.

The raid board works the same way: it holds a fixed number, and answering one
generates its replacement. No refresh timer, no daily reset.

## What the machine may do

Auto Summon already runs in the browser and settles credits on the server when
nobody is connected. Spares accrue away exactly as credits do, so being away
never costs anything — but raids and commissions are only run by the machine
while a device is open, because that is already true of everything the
Automaton does. Away fills the tank; present plays the board.

Within that, the machine clears any raid the collection *already* satisfies:
that is a lookup, and withholding it would be the game being coy. A raid that
needs a choice between series, or a stack that has to be built first, waits for
a player. Accepting a commission is always a player's decision, because
choosing what to chase is the decision.

## The board is aimed at the collection, not drawn blind

Shipped, the board picked a series at random and then a rung at random, and
the result was five demands nobody could meet. A collection of sixty-five
thousand holds one or two characters from most of the series it touches and
holds them at no stars, so a rung drawn from a fixed distribution asked for
55% of a cast at the fifth star and every row read as a refusal. A board of
five "no"s is a wall, not a mechanic. It also made the ×2.5 commission bonus
irrelevant, because a demand you are eleven characters short of is not
something you go and get; it is something you scroll past.

So the rung is measured rather than rolled. `fitTier` reads what the player
holds of that series at each of the five depths, finds the hardest rung they
answer today, and posts around it: about a third of rows are payable on sight,
most of the rest are one step out, and a few are a stretch. **The demands are
unchanged** — the same breadths at the same depths — they are simply aimed at
where the collection actually is.

The series pick was wrong in a subtler way. It seeked to a random point in the
claims key and took the next row, which is a uniform pick only if the claims
are spread evenly through the catalog's ids, and they never are: a collection
is dense where the player has been collecting and nearly empty everywhere
else, so a key seek weights a row by the *gap in front of it* and the sparse
end won almost every draw. Counting to a random offset instead weights every
claim equally, which weights a series by how much of its cast the player
holds — which is the thing a raid asks about. The offset walks the claims
primary key, which covers the query, so nothing is read to be skipped.

## A mechanic needs a ritual

The first version of this page was correct and unplayable. Four sibling panels
of prose, rows in database order, and a mechanic whose entire expression was a
number going up in a corner. Summoning has a wrapper you tear, cards that flip
one at a time and a stinger when something good lands; the board had a button
and a toast.

So answering a demand plays a **muster**: a rank of the player's own cards —
the ones that satisfy it, at the stars they merged to — deals in, the demand
stamps answered, and the Renown lands. It reads no rule and changes none. The
payout has already settled by the time it mounts, exactly as a pull's cards
are granted before the first wrapper tears (ADR 0010), and the Automaton skips
it entirely unless the player is standing on the page.

It matters more than presentation usually does here, because the roster is the
only place the second economy ever shows you *what you built*. Renown is a
number and Scrip is a number, but a ★12 stack took four thousand copies of one
character, and the muster is the one moment the game puts that on screen.

## What this does not do

It does not add a new infinite axis. The tree ends, as badges end, because what
it buys is shape and shape is finite. What is endless is the board: ten
thousand series and a crawl that keeps adding to them. This buys weeks of
something to do, not forever — and a bounded mechanic that is interesting beats
an unbounded one that is not, which is the entire complaint it answers.
