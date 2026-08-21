# A collection is not a loop

Two things at sixty-five thousand characters: a summon took nine seconds, and
selling the collection did nothing at all. Neither is about how big a pull is.
A pull of ten million cards was fine at the same moment — what had grown was
what the player already owned, and both faults were the same shape.

The summon spent eight of its nine seconds on one question asked four hundred
and seventy-seven times: *how many of this series do I hold?* A join from
claims to the catalog, filtered to one series, once per card of the pull that
was not already owned, each one walking sixty-five thousand rows. Selling ran
into a wall rather than a slope: SQLite compiles at most 32,766 bound
parameters into a statement, and `IN (?, ?, … ×65,000)` is not a statement it
will compile. The sale threw where nothing was listening and the button sat
there saying nothing.

**Nothing may cost a query per card, and no statement may name a whole
collection.** The two rules are the same rule: a collection is a thing you ask
about once and then reason about in memory, not a thing you iterate over
through the database.

- **The series count is one pass, and usually none.** A series pays at three,
  five and ten of it, and then stops. A collection deep enough to have finished
  every series it touches never asks; when it does ask, it asks once for the
  whole pull and counts the rest of it in memory as the cards are written.
- **A pull's guarantees are drawn together.** Every wrapper promises its own
  floor, so the top-up used to run per wrapper, and shuffling the catalog
  against a thousand already-dealt ids is not a cheap query. Twenty-four of
  them was three quarters of a second. One query with a limit is the same
  answer.
- **A long id list goes in bites.** Nine hundred at a time, the last one padded
  with an id nothing can have, so the statement is compiled once rather than
  once a bite. The delete carries the same `locked = 0` the price was quoted
  under, so what is deleted is exactly what was paid for.
- **A sale answers without the collection.** Same reason a summon does
  (ADR 0010): the revision counter moved, and the screen that cares is already
  asking for a fresh copy.

Nine seconds became a hundred and forty milliseconds. Sixty-five thousand
characters sell in about two hundred.

## Not Redis

The obvious reading of a nine-second summon is that the database is the
problem and wants a cache in front of it. It was not. Every one of those eight
seconds was one process making a synchronous call into a library in its own
address space, which is already faster than any answer that has to cross a
socket — and the numbers being asked for change on every claim, so a cache
would have been invalidated by the very press that was slow. What was wrong was
the number of questions, not the cost of asking. Redis would have added a
second thing to run, back up and get wrong on every self-hosted instance, in
exchange for making the wrong query shape slightly less expensive.

## Keeping it

`npm run stress` now plays each rung against a collection the size a rung that
deep would actually have — two thousand characters, twenty thousand,
sixty-five thousand — topped up rather than reset, and the catalog it seeds is
big enough to get lost in. What a player owns is its own axis of end game: the
old harness climbed to ten million cards a pull against a collection of six
thousand and called it the end game, which is why it saw neither of these. The
deep rung also sells the whole collection, with the machine switched off first,
and fails if the shelf does not empty.
