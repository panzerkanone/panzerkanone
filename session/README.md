# The session core

Milestone 1c (`docs/bars/M1c.md`): one headless host per match, the protocol it speaks, the seat
client, an in-process transport that can misbehave, a store, the driver for computer seats, and the
dice exchange. Nothing here opens a socket, reads a clock or asks the platform for anything: the
store, the random bytes and the outboxes come in through ports, and the host is driven only by its
entry point.

| File | What |
|---|---|
| `../protocol/messages.ts` | every message, both ways (types) |
| `../protocol/validate.ts` | hand-written validators for both directions, and for a dice record |
| `../protocol/limits.ts` | the size limit, the invalid-message budget, the rejoin limit, token and contribution sizes |
| `../protocol/codes.ts` | the closed lists: rejection codes, close reasons |
| `../protocol/diff.ts` | the general structural difference between two JSON values, and its application |
| `../protocol/viewhash.ts` | the view hash |
| `ports.ts` | the ports: store, random bytes, outbox, content |
| `host.ts` | the host: its pipeline, joining, the dice exchange, announcing, computer seats |
| `snapshot.ts` | what is stored, and how it is read back |
| `store.ts` | the in-memory store (JSON text only) |
| `client.ts` | the seat client |
| `transport.ts` | the in-process transport, with seeded faults |
| `computer.ts` | what a computer seat's agent is, and its random stream |
| `player.ts` | an agent playing a seat through a client (tests and the chaos runs) |
| `dice.ts` | the dice exchange's commitments and key, and `verifyDice`, the one pure check of a finished game's dice |
| `random.ts` | seeded random bytes, for tests (not secret) |
| `invite.ts` | a seat held by a link (the game played online, `worker/`): the claim key and dice contribution a link key gives, and the invitation check a server keeps |

## Making and running a host

```ts
const host = createHost({ match: 'm-1', content, store, random, computers: { ochre: agent } });
const r = openHost({ content, store, random, computers });     // rebuilt from the store alone
const conn = host.connect(outbox);                               // outbox: { send(text), close(reason) }
host.receive(conn, text);                                        // the raw text of one message; never throws
host.disconnect(conn);
await host.idle();                                               // computer seats have moved, if they can
host.close();                                                    // discarded: it stops, and calls the store no more
```

`content` is `{ ruleset, refs: { ruleset, scenario, map } }`, as `engine/sim/content.ts` loads it. It is
handed in again on every rebuild and checked against the pins stored with the match; other content
is refused, naming both hashes. A host built on a store object takes it over: an older host on the
same store object answers `host_closed` from then on and drops its agents' late answers.

## The pipeline

Every message, in this order (ruling 5):

1. **size**: more than 16,384 bytes of UTF-8, counted before the text is parsed: `too_large`
2. **parse**: not JSON text: `not_json`
3. **validate**: not a message of the protocol: `invalid`, naming every problem and its place.
   Steps 1 to 3 count against the connection's budget of 8; the eighth closes the connection
   (`closed`, reason `invalid_budget`)
4. **budget**: a well-formed message on a connection that has spent its budget: `budget_spent`
5. **seat**, from the connection, never from the message: `not_joined`, `spectator`, `replaced`
6. **duplicate**: a command or concession id this seat used before gets its first answer again,
   byte for byte, and nothing else happens. Accepted ids are stored with their log entry (or the
   concession), so this holds across restarts; refusals are remembered for the host's life only
7. **due**: `game_over`, `dice_failed`, `dice_waiting` (naming the seats and the step waited for),
   `not_your_turn`
8. **stale**: while exactly one seat is due, the command's `seq` must be the host's: `stale`
9. **submit**: `Match.submit` on a copy of the match whose dice record every roll; the ruleset's
   codes
10. **store**: one commit, the snapshot and the log entry together: `store_failed`
11. **announce**: one `update` to every joined connection, then `accepted` to the sender, then
    `over` if the match ended

An exception after step 3 and before the store call is an `internal_error` rejection and one line
in `host.faults`, and nothing changes: the host swaps in the new match only after the store call
has returned. An exception after it (a view, an event, an outbox) is a fault line; the committed
result stands, every other connection is served, and the connection that failed is closed so that
it rejoins and is sent its whole view (ruling 20).

## The messages

Every message is a JSON object with a `kind`. Hex is lower-case. A seat is a scenario side id.

### Client to host

| kind | fields | changes what is stored | answer |
|---|---|---|---|
| `claim` | `protocol` (1), `match`, `content` `{ ruleset, scenario, map }` (content hashes), `seat`, `key` (16 random bytes, 32 hex digits) | yes, the first time | `welcome` with the token, then `view` |
| `resume` | `protocol`, `match`, `content`, `token` (32 hex digits), `since` (the last seq applied, or null) | no | `welcome`, then `view` with the events after `since` |
| `watch` | `protocol`, `match`, `content`, `since` | no | `welcome` (seat null), then `view` |
| `sync` | `since` | no | `view` |
| `command` | `id` (1 to 64 of `A-Z a-z 0-9 . _ : -`), `seq` (the view's), `action` (a mapping, at most 32 deep, no key `__proto__`, `constructor` or `prototype`) | yes, when accepted | `update` to everyone, then `accepted` `{ id, seq }`; or `rejected` |
| `concede` | `id` | yes | `accepted` `{ id, seq }`, then `over` to everyone; or `rejected` |
| `dice_commit` | `commitment` (64 hex digits) | yes | `dice_ok` `{ step: 'commit' }` (a repeat of the same commitment too); `dice` to everyone when it was the last |
| `dice_reveal` | `contribution` (64 hex digits) | yes | `dice_ok` `{ step: 'reveal' }`; `dice` to everyone when it was the last, or when it did not match (stage `failed`) |

The join messages are a connection's first: a connection joins once, as a seat (claim or resume)
or as a spectator (watch), and a spectator may then send nothing but `sync` (rulings 9 and 24). A
claim names a claim key the client drew: a repeat of the same claim with the same key (its welcome
was lost) gets the same welcome and the same token again, and nothing is stored; a claim of a
claimed seat with any other key is `seat_taken`. The token is 16 bytes from the host's random-bytes
port; the store keeps its SHA-256 (of the 16 bytes, as hex), and the token sealed under the claim
key, never the token itself. A resume binds the connection to the token's seat; the seat's older
connection is sent `closed` (reason `replaced`) and hears nothing more.

### Host to client

| kind | fields | when |
|---|---|---|
| `welcome` | `protocol`, `match`, `seat` (null for a spectator), `token` (to a claim only, else null), `seats`, `dice` (status, below), `result` and `record` (once the match is over, else null) | answer to a join |
| `view` | `seq`, `view`, `hash`, `since`, `actions` (`[{ seq, events }]` for every action after `since`, or null), `omitted` (true when more than 64 actions passed and the events were left out) | answer to a join or a `sync` |
| `update` | `seq`, `events` (what this viewer sees of the action's events: `eventFor`, hidden ones left out), `change` (from the view at seq - 1 to the view at seq; null when unchanged), `hash`; and `steps` when it says something (below) | to every joined connection after every accepted action |
| `accepted` | `id`, `seq` | answer to a command or concession; a repeat gets the same text |
| `rejected` | `id` (of a command or concession, else null), `code`, `detail` | answer to anything refused; never echoes a value of the message |
| `dice` | `status` | to every joined connection when the exchange's stage changes |
| `dice_ok` | `step` | answer to a dice step |
| `over` | `result` `{ winner, reason }`, `record` (the dice record) | to every joined connection when the match ends |
| `closed` | `reason`: `invalid_budget`, `replaced`, `update_failed`, `host_closed` | before the host closes a connection |

Dice status: `{ match, commitment, stage, committed, revealed, failed }`, where `commitment` is the
host's, `stage` is `commit`, `reveal`, `play` or `failed`, `committed` and `revealed` list seats, and
`failed` is `{ seat, reason: 'reveal_mismatch' }` or null.

A seat is never sent the state, a state hash, another seat's view or its hash, the log, a dice key,
a seed, its contribution (or anyone's) before the end, or anything `Match.submit` returns (ruling 7).

### The change

`protocol/diff.ts`. A change is `{ set: value }`, `{ keys: [[key, change], ...], drop: [key, ...] }`
(both mappings: a new key always gets a `set`) or `{ items: [[index, change], ...], length }` (both
lists: an index at or past the old length always gets a `set`; then the list is cut or grown to
`length`). Keys travel as list entries, so `__proto__` is data like any other key.

### The steps of an update

Added for play over a socket (a seat far from the host plays an action back one event at a time, as
the page's own host lets it): `steps` holds one entry for each of the update's `events`, the change
from the viewer's view after the event before it (the view at seq - 1 for the first) to its view just
after this event, or null when the event changed nothing it sees. Events hidden from the viewer are
folded into the next one it sees. The host leaves `steps` out when every one of those views is the
view at seq (one event seen, and the last, say), so most updates are as they were. A client that
ignores it loses nothing: `change` and `hash` are as before.

### The view hash

SHA-256 of the UTF-8 text `"view hash, version 1\n" + viewer + "\n" + canonicalJson(view)`, as hex,
where viewer is `seat:<name>` or `spectator` and `canonicalJson` is `engine/core/canonical.ts`.

### Content

A hello carries the content hashes the client holds. Any that differs from the match's pins is
refused with `content_mismatch`, naming the content and both hashes (ruling 11).

## The client

`client.ts`. It keeps its view and sequence number, applies each update's change, checks the hash,
and asks for its whole view (once, until it comes) when a sequence number is skipped, a change
cannot be applied, or a hash differs. A repeated update changes nothing. It predicts nothing. On a
new connection it sends its hello (resume with its token and the last seq it applied), then every
command still unanswered, with its original id, in the original order. A rejection that speaks of
the connection (`not_joined`, `replaced`, `budget_spent`, `host_closed`) or of a passing failure
(`internal_error`, `store_failed`) leaves a command unanswered, to be sent again.

## A seat held by a link

`invite.ts`, for games played by shared links (`worker/`, `client/src/net/`). The page that makes the
game draws a 16-byte link key for each seat, which travels only in that seat's link. From it a seat
client's random-bytes port (`LinkBytes`) gives, in the order the client draws them, the claim key and
the dice contribution, each an HMAC-SHA-256 of the link key under its own label. So the same link
claims the same seat again (a repeat claim with the same key gets the same token) and reveals the
contribution it committed to, however often the page is reloaded and on whatever machine. The server
is told only each seat's invitation check (a labelled SHA-256 of the claim key) and lets a claim
through only when its key gives that check. It learns the claim key at the claim and cannot work out
the contribution from it. The host itself is unchanged.

## Computer seats

`computer.ts` and `host.ts`. After an entry call returns, the host asks a due computer seat's agent
in a microtask (never inside the pipeline), handing it the seat's view, the legal actions asked of
that view, and a random stream keyed by the seat's own count of decisions (ruling 30), whose seed was
drawn from the host's port when the match was made and is stored. The answer enters the pipeline as
a `command` on an internal connection of the seat, with an id (`cpu.<decision>.<try>`) and a
sequence number. An answer that comes after the sequence number moved, the match ended, or the host
closed is dropped; if the seat is still due its agent is asked again, once. An illegal answer is a
rejection and one fault line; after 3 answers at one position the host stops asking until the
position moves. An agent that answers with a promise holds up nobody: every other message is
answered meanwhile. `host.idle()` resolves when no agent call is scheduled or in flight.

## The dice exchange

`dice.ts` states it step by step, with its limits (ruling 29). In short: the host draws a secret and
sends its commitment (a labelled SHA-256, never the plain hash) and the match id in every welcome;
each seat commits to a 32-byte contribution (a labelled SHA-256 bound to the match and the seat); a
computer seat's contribution is drawn and its commitment stored when the match is made; only when
the store call holding the last commitment has returned are the reveals opened; each reveal is
checked against its commitment, and one that differs stops the match, naming the seat; with every
contribution in, the game key is HMAC-SHA-256 under the secret of the match id and the
contributions, and play is on `KeyedDice(key, match id)`. The host records each roll it makes
(roll number, faces, face) with the action that was accepted. When the match is over (even by a
concession before it started) every connection is sent the dice record: match id, commitment,
secret, each seat's commitment and contribution, and the rolls. `verifyDice(record, held)` checks it
against what one seat holds: the commitment and match id it was sent before contributing, and its
own contribution.

Limits, stated and not fixed: the host knows every roll to come once the reveals are in, and could
tell a player; it can refuse to start a match whose rolls it dislikes by claiming a seat failed to
reveal; the reveal proves only that the dice were not changed after the commitments. The check takes
no events, so a roll added at the end with its true face, or a die's faces changed to a number on
which the key gives the same face, passes it: a seat compares the record's rolls with the faces in
the events it was sent.

## What is stored

`snapshot.ts` lists every field. Two kinds of key: `snapshot` (everything but the log, as canonical
JSON) and `log/00000001`, ... (one per accepted action: seat, command id, action, events, state
hash, rolls). One commit per state-changing message; the claim, the dice steps and the concession
write the snapshot alone, a command the snapshot and its log entry. Nothing in memory survives a
rebuild that the store does not hold.

## The chaos runs

`npm run chaos -- --games <n> --seed <s>` (`scripts/chaos.ts`, whose header lists the faults and the
output). The gate runs a hundred.
