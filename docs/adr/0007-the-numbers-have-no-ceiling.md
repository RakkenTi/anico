# The numbers have no ceiling

Progression stopped. Pack sizes were capped at two hundred, most upgrade lines
had a last level, and the effects were additive — "+25 cards", "+5% on sales" —
against prices that tripled. Additive gains against exponential prices is a
treadmill that grinds to a halt by construction, and it did: the end of the game
arrived somewhere in the millions, with a shop full of lines saying *Complete*
and nothing left to spend on.

**Every rate in the game is a multiplier now, and most of the lines that sell
them never end.** Deeper Packs makes a pack half again as deep, per level,
forever. Appraisal multiplies what everything sells for. Fortune multiplies what
a coin is worth. Each line's price grows faster than the effect it buys, which
is the entire difficulty curve: the ratio between the two is how much longer the
next level takes than the last, and it is greater than one everywhere.

Simulated against a wall clock, that curve reads: packs inside a minute, the
first upgrades in the first ten, the Automaton around the half hour, the badge
tree finished in an hour or so, billions per second by the end of the first
evening, and quadrillions by the end of the week — still climbing, and still
buying something every twenty minutes or so. There is no last purchase.

## What this forces elsewhere

- **Numbers get names.** Past ten thousand everything the player is quoted is
  three significant figures and a suffix — 4.18B, 12.4Qa — and past the suffix
  table an exponent. Eighteen digits of separators hide the magnitude rather
  than showing it.
- **A pull stops being something you look at.** A pack that holds a million
  cards is a number, not a spread. Two hundred cards are dealt, granted and laid
  out; everything behind them is opened by the machine and appraised at what the
  dealt cards averaged. One pull is O(200) database writes however large it
  nominally is, and the alternative — a million rows, a million images, the same
  answer — is not a feature.
- **Badges stay finite, and that is their job.** Six lines of six levels, each
  one unlocking or changing something you can name: whether packs exist, how
  many wishes you may pin, what a pack promises. They are the shape of the game;
  upgrades are the curve. An exponential economy will always leave a finite
  ladder behind within an hour or two, so the answer is more content beside it,
  not a longer ladder.
- **The shop is one shelf.** Badges and upgrades used to be two panels stacked
  vertically, which put the half that decides whether packs exist at all below
  the fold. They are one list now, ordered by price, because "what can I afford
  next" is the only question anyone brings to a shop like this.
- **The daily offering is quoted in pulls.** A hundred credits is a morning's
  play on the first day and a rounding error on the third, so the offering pays
  the greater of its old amount and half a minute of the Automaton's work.
