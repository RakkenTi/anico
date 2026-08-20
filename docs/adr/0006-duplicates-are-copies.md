# Duplicates are copies, and a collection is worth keeping

Selling was the only thing a card was for. Every pull ended the same way — open,
sell, buy the next upgrade — and the Collection tab was a waiting room on the
way to the shop. A collecting game where the collection is a liability has its
central noun in the wrong place.

**A duplicate is now a copy rather than a consolation.** Rolling a character you
already own adds to that character's stack, and every doubling of a stack merges
it one star higher: two copies make a ★1, four a ★2, eight a ★3, sixteen a ★4.
A star multiplies what the whole stack sells for — 2.6× per star — so sixteen
copies held and merged are worth several times sixteen copies sold as they
arrived. Duplicate compensation drops from 10% to 4% to make room: the copy is
the reward.

The number that makes this work is the size of the catalog. With a hundred and
fifty thousand characters, a second copy of anyone is a small event and a fourth
is a story, so a merged stack is a thing that happened to you rather than a
thing you farmed. A player who wants to farm them can narrow their pool in
settings, which is a real strategy with a real cost: a smaller pool is a smaller
game.

## What this forces elsewhere

- **Selling takes the whole stack.** Half a stack cannot be sold, because a star
  that can be taken apart again is a currency rather than a keepsake.
- **Auto-sell never touches a stack.** It sells single copies below a rarity you
  choose, and nothing that has started to merge, and never a wish come true.
  A convenience that throws away the two things worth keeping is a trap.
- **A card shows its stack.** Stars on the artwork, copies in the detail view,
  and the credit value in the collection quotes what the stack fetches rather
  than what one card is worth.

## The Automaton, and why it exists here

The same release put a machine in the shop that presses the summon button on a
timer. That is not a separate idea: it is what makes the long tail of a
collection reachable. The late upgrades cost tens of millions and the merges
that matter need thousands of pulls, and neither should require a human finger.
The Automaton runs on the client, calls the same endpoint a player would, and is
refused by the server on exactly the same terms — it can never do anything a
player could not, only more patiently.

## The lock, and why auto-sell waits

Auto-sell used to fire the moment a card landed. That is the obvious
implementation and it makes one thing impossible: looking at a spread and
deciding to keep something. By the time the cards were on screen the ones below
the floor were already money, so the setting was all-or-nothing — either you
trusted it with everything or you turned it off and tidied by hand.

**A summon queues; the next summon sells.** What lands below the floor is
written down as a candidate and sold when you press the button again, which
makes the gap between two summons the window in which you can change your mind.
The **lock** is what you do in that window: a locked stack is skipped by the
sweep, skipped by a bulk sale, and refused by the sell endpoint outright, so the
button means what it says everywhere rather than only in the place it was added.

The lock is checked when the sweep runs rather than when the card landed, so
locking works right up until the moment the next summon starts. Nothing is ever
sold behind your back on the strength of a decision you made a hundred pulls
ago.
