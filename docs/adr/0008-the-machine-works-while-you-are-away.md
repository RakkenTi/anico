# The machine works while you are away

The Automaton is an interval in a browser tab. Close the tab and it stops, which
is a strange thing to sell somebody in a game whose late upgrades are priced in
hours: the point of buying a machine is not having to be there.

**Night Shift pays it for the hours the tab was closed.** The switch moved to
the server — `auto_spin` is a column, not a flag in a page somebody navigated
away from — and every real pull records what it was worth in `auto_yield`, a
smoothed average of the credits one press produces for this player. When the
client next asks for state, the server settles the gap: elapsed time, capped at
the hours the upgrade bought, divided by the machine's interval at the fraction
of its speed the upgrade bought, times that average.

No cards are drawn and none are granted. What the machine does out there is open
packs and sell them, which is also the honest thing to model: it cannot deal a
spread to an empty room, and a player who leaves for a week should not cost the
instance a week of rolls when they come back. The whole settlement is three
multiplications and one UPDATE.

## Why an average rather than a simulation

Replaying the loop offline would need the pool, the wishes, the guarantee and
the RNG, for potentially hundreds of thousands of pulls, on a machine that is
also serving everybody else. The average has none of that and one property that
matters more: it is *this player's* number. Every badge, every upgrade and the
size of their own pool are already folded into it, so the offline rate tracks
the online one without the server knowing why.

The trade is that a player who buys a large upgrade and immediately closes the
tab is paid at their old rate until they come back and pull once. That is the
right direction to be wrong in. The average is also *net* — the pack price is
already subtracted — so the machine finances itself out there and never has to
be checked against a balance it would have spent hours ago anyway.

## Away means the account, not the tab

One account can be signed in on several devices, so "the tab was closed" is not a fact
about a player. The clock runs from the moment the *last* device disconnects and stops the
moment the first one arrives: an idle phone still holding a stream is being played, and
paying the machine for those hours would be paying twice for the same time. The server
counts live streams to decide (see ADR 0009), so no client has to be trusted to say
whether anybody is home.

## What this forces elsewhere

- **The switch survives a refresh**, because the server holds it. Turning the
  Automaton on is a request, not a piece of local state.
- **Time is only counted once.** Settling stamps `auto_at`, so two clients, two
  refreshes or a reconnecting phone cannot be paid twice for the same night.
- **It reports itself.** The credits are already in the balance by the time the
  page renders, so the toast is a receipt — how long, how many pulls, how much —
  rather than an animation of money arriving.
