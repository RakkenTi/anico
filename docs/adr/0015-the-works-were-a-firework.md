# The works were a firework

ADR 0014 built three faucets -- the Press, the Factory and Expeditions -- and
priced them against the player's own summon so they would still matter twenty
orders of magnitude later. They did. They mattered so much that the game was
over.

The report: somewhere past a sextillion credits, spending the whole balance on
upgrades started returning more than it cost, every time. Repeat that a few
times and a save went from Sx to 1e110 in about ten minutes.

That is not a balance complaint. That is a description of a divergent series.

## The one number

Take a shop line whose effect multiplies by `g` per level against a price that
multiplies by `c` per level. Spend a balance `S` on it and you can afford about
`log_c(S / base)` levels, so the effect you get back goes as `S^(ln g / ln c)`.
Call that exponent `r`. Across a shop, income comes back as `S^R` where `R` is
the **sum** of every endless line's `r`.

    R < 1   the balance grows like a polynomial in time. Every order of
            magnitude costs more play than the last, which is the whole
            feeling an idle game is selling.

    R > 1   income outruns the money that bought it. Spend the balance, come
            back with more than you spent, spend that. The balance reaches
            infinity in *finite time*, and ten minutes is a perfectly ordinary
            value for "finite".

The summon's own lines summed to about 0.90 -- close, but under. The Factory
added 0.60 on its own and Expeditions another 0.22, and `R` landed near 1.5.

## Why the Factory in particular

`scrapWorth` was the Foundry's fraction times the size of the player's whole
pull, and the Factory paid `belt x scrapWorth x creditsPerCard` -- which is to
say, a multiple of an *entire pull* per press. ADR 0014 called that an honest
denominator, and as a denominator it was: it is what kept the Factory relevant
at a quadrillion.

What it missed is that **both halves of the fraction were endless shop lines**.
The Foundry multiplied by 1.6 a level against a price that multiplied by 2.2;
Belt Speed by 1.55 against 2.35. A faucet quoted as a share of the summon,
whose share is itself an endless line, is a line that multiplies the whole
economy -- and it was sitting alongside every other line that multiplied the
whole economy.

The paragraph in ADR 0014 that says "the Foundry never runs away with it,
because the belt can only pull what the Press made" is true and irrelevant.
The belt was never the constraint. The *share* was, and the share had no
ceiling.

Merge Value was a quieter version of the same mistake. It raised the per-star
multiplier by a flat amount a level, and a stack merges to eighteen stars -- so
`+0.45` on a base of `2.6` was a x1.98 on a collection's value for a price that
only doubled, and the line paid for itself twice over on every rung. Per star
is an exponent, and a linear-looking number in an exponent is not a linear
number.

## What was done

The Press, the Factory and Expeditions are removed. Not rebalanced: removed.

They could have been repriced -- cap the Foundry, make the belt the real
constraint -- but the arithmetic was not the only thing wrong with them. After
two rounds of trying to fix them the Factory still read as broken, the hand
slam still read as a dead button, and expeditions still read as confusing; the
board was the only one of the four worth keeping. Three machines that all paid
credits, none of which was the game anybody opened this to play, and every
attempt to make them feel like something added a rule rather than a reason.

Contracts stay, and they were always the different one: they read *breadth at
depth* off a collection, they are the only thing in the game that makes one
particular character worth wanting, and they pay a fixed multiple of a press --
`r = 0`, because the multiple never grows.

What is left sums to about 0.74:

    Sell Value   x1.18 a level against x2.00     r = 0.24
    Pack Size    x1.28 a level against x2.50     r = 0.27
    Coin Drops   x1.22 a level against x2.40     r = 0.23

Open Speed decides how much of a pull you *see* and is capped by Wider Deal.
Extra Packs adds a wrapper rather than multiplying one. Merge Value multiplies
the finished stack rather than the per-star rate, and pays on a collection you
sell rather than on the summon that feeds it.

## What replaced them

The late shop lost five lines, so the board gained three. **Split Aim** points
Called Shot at up to six series at once, dividing the aimed share between them.
**Auto Aim** hands the crosshair to the machine, which re-points it at the
contracts the collection is nearest to finishing on every pull. Neither
multiplies income -- they buy *direction*, which is the thing the board was
always short of.

The shop also grew a buy-amount switch (one, ten, twenty-five, or as many as
the balance covers), because the honest answer to "this level costs a fraction
of a second's income" is not "click faster".

## On big numbers

`R < 1` is also the whole of the answer to "will this break at high numbers".
A double gives up at about 1.8e308; with `R` near 0.74 a balance grows like
`t^4`, so 1e308 is not reachable in any number of years anybody will play. It
was reachable in an afternoon at `R = 1.5`, which is why the previous release
needed a big-number library and this one does not.

Belt and braces anyway: every credit payment goes through one clamp, the suffix
ladder is generated as far as 1e1020 so nothing falls off the end of it into a
bare exponent, and a price too large for a double now answers `Infinity` -- an
unreachable level -- where it used to answer `MAX_SAFE_INTEGER`, which made the
most expensive level in the game cost nine quadrillion and handed out an
infinite ladder of free ones.
