# A pull is drawn with replacement

At Wider Deal VI a spread deals three thousand four hundred real cards, and
there are three thousand four hundred and thirty-seven characters in the world
worth more than a Common (ADR 0012). Those two numbers being the same number is
what the late game feels like: every stack up one, every star arriving on the
same schedule as every other star, and nobody ever having a moment.

That was not the catalog running out. It was the deal refusing to repeat itself.
Every card looked for the first character the pull had not already used, so a
spread handed out its copies one each, perfectly evenly, to as many different
people as it had cards. When the pool held fewer characters than the spread had
cards, a fallback walked the same list again from the top, which gave exactly
two copies to a prefix of it and one to the rest: a step, not a distribution.
An instance whose admin had set the pool to the top two thousand dealt fourteen
hundred of its three thousand four hundred cards that way.

Even ignoring the fallback, one-each is the one shape a pull can never actually
have. A pull of a trillion cards against a catalog of eighty thousand holds
twelve million of everybody. The spread is a sample of that pull, not the whole
of it, and a sample of a trillion cards that never repeats a face is not a
sample of anything.

**A pull is drawn with replacement, against the size of the pool rather than
the size of the sample.** How many characters could come out is counted once per
pull; each card lands on one of those slots at random; a slot visited twice is
the same character twice. What that costs is the repeat rate following the
catalog instead of the spread:

| pool | distinct of 3,400 dealt | repeat cards |
| --- | --- | --- |
| warm catalog, 80,000 | 3,334 | 66 |
| half-crawled, 10,000 | 2,852 | 548 |
| admin pool, top 2,000 | 1,631 | 1,769 |

A warm instance barely notices. A new one, or a narrowed one, gets the lumpiness
it always should have had, and the pool setting finally means something past its
effect on card values: a narrower pool is a richer, shallower game.

## What this does not change

**Not the economy.** A pull deals exactly as many copies as it dealt before,
because the count is the deal budget and the budget has not moved. What changed
is which characters they land on. No credit anywhere is worth more or less than
it was, so nothing here touches the divergence exponent (ADR 0015).

**Not the stack.** A duplicate is still a copy, one stack per character, stars
still one per doubling (ADR 0006).

**Not the overflow.** Everything past the deal cap is still appraised rather
than claimed. Copies cash out through a 2.6 per star exponent, so paying copies
out of a trillion-card overflow would put twenty-eight stars on every stack in
the game in a single pull, against a cap of eighteen. The deal cap is what keeps
stars worth having, and it stays.

## What it costs

One indexed `COUNT` per pull, never one per card (ADR 0011).

It is cheaper than what it replaced. Scanning the pool for the first unused
character rescanned from the top for every card, and the run of used entries at
the top grew by one each time, so the deal was quadratic in its own size: about
five point eight million comparisons at the cap, to arrive at the answer "the
next one". A slot lookup is a hash.

## A correction to ADR 0006

ADR 0006 says a player who wants to farm copies can narrow their pool in
settings. They cannot, and have not been able to since the pool became one
number for the whole instance, set by the admin: a pool is not a preference,
because a player who picks their own is playing a different game from the person
next to them. The sentence in ADR 0006 is left as it was written, and this is
the note that it is no longer true.
