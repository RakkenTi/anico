# Collections are per player, not exclusive per instance

Mudae's defining rule is that a character can be claimed by only one person per Discord
server, and that exclusivity is what makes rolling competitive there. Anico deliberately
does **not** copy it: players share an instance but their collections are isolated, and
two players can each own the same character. A `claims` table keyed by
`(player_id, character_id)` is the shape either model needs, so the decision lives in the
rules, not the schema.

The reason is the size of the room. Mudae runs in guilds with hundreds of active members
and constant churn from `$divorce`; a self-hosted instance runs with a handful of friends
who play at different hours. Under exclusivity the most active player permanently locks
every desirable character away from everyone else, with no churn to undo it, and the game
stops being fun for everyone but one person.

## Consequences

- No claim contention, so no locking or race handling on the claim path beyond the
  player's own cooldown.
- Player-versus-player features do not follow from the data model for free. Trading is
  still possible later, but it must be designed as a transfer between two collections
  rather than falling out of a shared pool.
- Exclusivity remains available later as a per-instance setting, since the schema
  supports it. The game feel is the hard-to-reverse part, not the tables, which is why
  the permissive version ships first.
