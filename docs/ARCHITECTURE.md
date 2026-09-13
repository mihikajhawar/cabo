# Online Multiplayer Cabo — FINAL Architecture / Design Specification

**Status: ARCHITECTURE PHASE. No implementation has begun and none will begin until explicit approval is received (see final section).**

This document consolidates and finalizes Revisions 1 and 2 against the Final Architecture Brief. Where the brief resolved a prior open question, that resolution is treated as settled below — it is not re-asked.

---

## A. Executive Summary

Cabo is a hidden-information card game, which means the entire architecture is organized around one central fact: **the server is the only entity that ever knows the full game state, and every client sees a different, narrower, individually-computed slice of it.** A second organizing fact is that contesting is a genuine race condition — multiple players can try to act on the same discard-pile opportunity within milliseconds — so the server must resolve that race deterministically and atomically.

Everything else in this design serves those two facts: a pure, framework-free rules engine that's fully unit-testable without a browser; a thin realtime layer (Socket.IO) that turns client intentions into validated, single-threaded, synchronous state mutations; a per-player "view projector" that's the only code allowed to produce anything sent over the wire; and a database that stores identity and outcomes, not the live, fast-changing hand of cards.

The game is played entirely in server memory during a round; PostgreSQL persists games, players, and completed-round results for history and reconnection identity, not moment-to-moment card state.

---

## B. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js + React + TypeScript | Familiar, capable DX; the game itself doesn't depend on Next.js's server-rendering features — it's a client rendering a server-pushed view. |
| Styling | Tailwind CSS | No architectural impact either way; fine as specified. |
| Realtime transport | Socket.IO | Gives rooms (one per game), acknowledgement callbacks (so a client gets a direct response to its own action without a second broadcast), and reconnection handling essentially for free — the single biggest complexity reduction available for this project's scope, versus hand-rolling those on raw WebSockets. |
| Backend runtime | Node.js + TypeScript | Same language as the frontend and the engine; the workload (small in-memory objects, no heavy compute) suits Node's single-threaded model well — see §H/§L on why single-threadedness is actually load-bearing for correctness, not just convenient. |
| Game engine | Plain TypeScript, zero framework imports | Must be testable and reasoned about with no server, socket, or React in the picture. |
| Database | PostgreSQL | Right fit for the small, relational, mostly-append-only data it actually needs to hold (see §M). |
| ORM | Prisma | Matches the schema's simplicity; no argument against it. |
| Hosting | Split deployment — see §C | A standard serverless/stateless frontend deployment cannot host an authoritative, long-lived, in-memory game process; the realtime server needs its own long-lived-process-capable host. |

---

## C. System Architecture

```
┌──────────────────────┐        Socket.IO (WebSocket)         ┌───────────────────────────────┐
│   Next.js Frontend     │ ────────────────────────────────────▶ │  Realtime Game Server            │
│  - Renders PlayerView   │                                        │  (Node.js, long-lived process)   │
│    only — never decides │ ◀──────────────────────────────────── │  - one Socket.IO room per game    │
│    outcomes itself      │   per-player filtered events only      │  - GameManager (in-memory)         │
└──────────────────────┘                                        │  - Pure game-engine package          │
                                                                    │  - Validator → Reducer → Projector    │
                                                                    │  - Contest-window scheduler             │
                                                                    └────────────────┬─────────────────────┘
                                                                                     │ Prisma (identity + results only)
                                                                                     ▼
                                                                          ┌────────────────────┐
                                                                          │   PostgreSQL          │
                                                                          │  games / players /    │
                                                                          │  rounds / results       │
                                                                          └────────────────────┘
```

**Hosting note (unchanged from earlier revisions, restated as final):** the realtime server must run as a genuinely long-lived process with persistent in-memory state per active game — a typical serverless/edge Next.js deployment (functions that can be cold-started, killed, or load-balanced per-request onto different instances) is structurally incompatible with holding authoritative, continuously-mutating game state. Recommended: Fly.io, Render (as a persistent service, not a static/serverless one), Railway, or a small container/VM. The frontend can be hosted anywhere standard for Next.js, since it holds no authoritative state itself.

---

## D. Final Game-State Model

```ts
// ---- Cards ----
type Rank = 'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K_RED'|'K_BLACK';

interface CardDefinition {
  rank: Rank;
  value: number;          // A=1 ... 10=10, J=11, Q=12, K_BLACK=13, K_RED=-1
}

interface CardInstance {
  id: CardInstanceId;      // stable for the whole round — the unit knowledge and location both key off
  def: CardDefinition;
}

// ---- Deck / Piles ----
interface Deck {
  cards: CardInstance[];   // index 0 = current draw-pile top
}

// ---- Players ----
interface PlayerState {
  id: PlayerId;
  displayName: string;
  connected: boolean;
  hand: CardInstanceId[];      // VARIABLE LENGTH, 0..4 — zero-length is fully valid, never rejected as malformed
  isCaboCaller: boolean;
  handLocked: boolean;         // set true atomically the instant this player calls CABO
  hasTakenFinalTurn: boolean;
}

// ---- Phases ----
type GamePhase =
  | 'LOBBY' | 'STARTING' | 'DEALING' | 'PLAYING' | 'POWER_RESOLUTION'
  | 'CONTEST_WINDOW' | 'CABO_LOCK' | 'FINAL_TURNS' | 'REVEAL' | 'SCORING' | 'ROUND_COMPLETE';

// ---- Turn ----
interface TurnState {
  phase: GamePhase;
  currentPlayerId: PlayerId;
  drawnCard: CardInstanceId | null;      // the "undecided, held" card for the active player's current draw
  pendingPower: PowerAction | null;
  contestWindow: ContestWindowState | null;
  finalTurnQueue: PlayerId[];             // excludes the CABO caller by construction
  awaitingCaboDecision: boolean;          // true only after a full normal-turn sequence has
                                            // resolved for currentPlayerId; the only state in
                                            // which CALL_CABO is legal
}

interface PowerAction {
  kind: '7_8_LOOK_OWN' | '9_10_LOOK_OPPONENT' | 'JQ_BLIND_SWAP' | 'KING_INSPECT_SWAP';
  ownerPlayerId: PlayerId;
  sourceCardInstanceId: CardInstanceId;    // which drawn card granted this power
  kingSelection?: { a: CardRef; b: CardRef; inspected: boolean };
}

interface ContestWindowState {
  openedAtMs: number;
  discardTopCardInstanceId: CardInstanceId;
  expiresAtMs: number;                     // openedAtMs + 2000, server-authoritative
  resolved: boolean;
}

// ---- CABO ----
interface CaboState {
  called: boolean;
  callerId: PlayerId | null;
  calledAfterTurnNumber: number | null;
}

// ---- Results ----
interface RoundResult {
  perPlayerScore: Record<PlayerId, number>;    // may be 0 or negative
  caboCallerId: PlayerId | null;
  caboSucceeded: boolean;
  winnerIds: PlayerId[];                        // ARRAY, not a single id — see §I on why ties among
                                                  // non-callers must be modeled explicitly, not collapsed
  revealedHands: Record<PlayerId, CardDefinition[]>;
}

// ---- Root ----
interface GameState {
  id: GameId;
  hostPlayerId: PlayerId;
  players: PlayerState[];
  deck: Deck;
  discardPile: CardInstance[];    // top = last element
  turn: TurnState;
  cabo: CaboState;
  roundNumber: number;
  lastRoundResult: RoundResult | null;
  knowledge: Record<PlayerId, Set<CardInstanceId>>;
}
```

Deliberate invariant choices worth stating explicitly, since they're what make illegal states hard to represent:

- `hand` has no minimum length — the type itself doesn't imply 4 cards, so nothing needs special-casing to allow 0.
- `drawnCard` lives on `TurnState`, not `PlayerState` — structurally only one player can ever have an undecided drawn card at a time.
- `handLocked` is an independent boolean, not inferred from `isCaboCaller` — every validator check reads this one flag directly, so there's exactly one place "is this hand touchable" can go wrong, not several.
- `awaitingCaboDecision` makes the CABO-decision point a first-class, checkable state rather than something implied by phase alone — `CALL_CABO`'s validator check is a single boolean read.
- `winnerIds` is an array specifically because §17 of the brief requires modeling multiple tied non-caller winners explicitly rather than arbitrarily picking one (see §I).

---

## E. Final State Machine

```
LOBBY
  → STARTING                (host starts, min players ready)
STARTING
  → DEALING                  (server shuffles + deals)
DEALING
  → PLAYING                   (all initial-peek acks received, or timeout)

PLAYING  (currentPlayerId's normal turn, awaitingCaboDecision = false)
  → POWER_RESOLUTION           (drawn card has a power and player opts to use it)
  → CONTEST_WINDOW              (drawn card is discarded or replaced — a card lands on the discard pile)

POWER_RESOLUTION
  → CONTEST_WINDOW               (the power's associated discard — if any — opens contesting)
  → PLAYING                       (power resolved with no discard step; awaitingCaboDecision → true directly
                                    if the power itself completed the turn's discard/replace requirement —
                                    in practice every power still requires the player to separately discard
                                    or replace per Step 3, so this path is the normal one below)

CONTEST_WINDOW
  → PLAYING                        (window closes; if this was the current player's own turn,
                                     awaitingCaboDecision → true; if during a final turn, instead
                                     advances the final-turn queue directly — see §F)

PLAYING  (awaitingCaboDecision = true, ONLY legal actions: CALL_CABO, END_TURN)
  → CABO_LOCK                       (CALL_CABO)
  → PLAYING  (next player, awaitingCaboDecision = false)   (END_TURN)

CABO_LOCK                            (transitional, server-only, no player action legal here)
  → FINAL_TURNS

FINAL_TURNS
  → FINAL_TURNS                      (advance to next queued player after their turn completes)
  → REVEAL                            (queue empty)

REVEAL
  → SCORING
SCORING
  → ROUND_COMPLETE
ROUND_COMPLETE
  → DEALING (rematch) or → LOBBY
```

### Phase legality table

| Phase | Who may act | Legal client actions |
|---|---|---|
| LOBBY | joined players / host | `JOIN_GAME`, `LEAVE_GAME`, `READY`, `START_GAME` (host only) |
| DEALING | each player once | `ACK_INITIAL_PEEK` |
| PLAYING, awaitingCaboDecision=false | current player | `DRAW_CARD` |
| POWER_RESOLUTION | current player | power-specific action (§G) or `SKIP_POWER` |
| (post-power) discard step | current player | `DISCARD_CARD` or `REPLACE_CARD` |
| CONTEST_WINDOW | any connected player | `CONTEST_CARD` |
| PLAYING, awaitingCaboDecision=true | current player only | `CALL_CABO`, `END_TURN` |
| CABO_LOCK | none (server-only tick) | — |
| FINAL_TURNS | designated final-turn player | `DRAW_CARD` → (optional power) → `DISCARD_CARD`/`REPLACE_CARD` — **no `CALL_CABO`, and no `END_TURN` needed**: completing the contest window automatically dequeues them (§F) |
| REVEAL / SCORING | none | — |
| ROUND_COMPLETE | host | `START_ROUND`, `RETURN_TO_LOBBY` |

---

## F. Turn Lifecycle

### Normal turn (current player, not a final turn)

1. `DRAW_CARD` — server pops the draw pile (reshuffling first if empty, §L), sets `turn.drawnCard`, grants the drawer permanent knowledge of that `cardInstanceId` (§J), and returns its value in the ack response to that player only.
2. Optional `USE_POWER` if the drawn rank has one (§G), else skip directly to step 3.
3. `DISCARD_CARD` or `REPLACE_CARD { position }` — resolves the drawn card's disposition; either way a card lands on the discard pile top.
4. A `CONTEST_WINDOW` opens for exactly 2 seconds (§H).
5. Once the window closes/resolves, phase returns to `PLAYING` with `awaitingCaboDecision = true` **for the player who just acted**. Their only two legal actions now are:
   - `CALL_CABO` — locks their hand atomically, routes to `CABO_LOCK` → `FINAL_TURNS` (§I).
   - `END_TURN` — advances `currentPlayerId` to the next player, resets `awaitingCaboDecision = false` for them, loop back to step 1.

### Final turn (a player in `finalTurnQueue`, after CABO has been called)

Identical to steps 1–4 above. At the point a normal turn would open the CABO decision (step 5), a final-turn player instead **automatically** completes their turn the instant the contest window resolves — dequeued from `finalTurnQueue`, `hasTakenFinalTurn = true`, `currentPlayerId` advances to the next queued player, or phase → `REVEAL` if the queue is now empty. No `CALL_CABO` option is ever presented (illegal in this phase per the validator, §L), and no separate `END_TURN` action is required from the player — their turn simply concludes on its own once the contest window closes, since there is nothing left for them to decide (they cannot call CABO, and there's no other player waiting on their explicit hand-off the way a normal-turn player's peers are).

---

## G. Power Architecture

Powers only ever trigger off the card the current player just drew from the draw pile this turn (`turn.drawnCard`) — never a card already resident in any hand, regardless of how it later moves (discard, contest, swap).

| Power | Ranks | Action | Validation | Knowledge effect |
|---|---|---|---|---|
| Look own | 7, 8 | `LOOK_AT_OWN_CARD { position }` | target position belongs to acting player, acting player is `currentPlayerId`, phase is `POWER_RESOLUTION` | acting player's `KnowledgeSet` gains that `cardInstanceId` |
| Look opponent | 9, 10 | `LOOK_AT_OPPONENT_CARD { targetPlayerId, position }` | target player ≠ acting player, target not `handLocked` | acting player's `KnowledgeSet` gains that `cardInstanceId` |
| Blind swap | J, Q | `BLIND_SWAP { cardA: {playerId, position}, cardB: {playerId, position} }` | neither target is `handLocked`; otherwise unrestricted — any combination of self/other/other-other is legal | **no** knowledge change for anyone (the swap is genuinely blind) |
| Inspect & decide | K_RED, K_BLACK | `KING_INSPECT { cardA, cardB }` then `KING_SWAP_DECISION { swap: boolean }` | neither target `handLocked`; two-step, both steps still within `POWER_RESOLUTION`, no other player can act in between since it remains the acting player's turn | `KING_INSPECT` grants acting player's `KnowledgeSet` both cards for the duration; if swapped, knowledge continues to follow each physical card instance to its new location — no re-grant needed |

The **CABO-lock guard is the single unconditional restriction on every one of the above**: no power target — regardless of type — may resolve against a `handLocked` player's card. This is enforced by one shared guard function consulted before any power-specific validation runs, not duplicated per power (§L).

Both Kings share identical mechanics; their only difference is the resulting `CardDefinition.value` (-1 vs 13), which participates in scoring exactly like any other card — no special-casing in the power logic itself.

---

## H. Contest Architecture

### Matching rule

A contest is valid if the targeted card's **rank** matches the discard-pile top's rank, with one explicit exception: **Red King and Black King count as the same rank for contesting purposes**, despite having different point values (-1 vs 13). This is modeled as a dedicated `ranksMatchForContest(a, b)` function rather than raw equality on `Rank`, specifically so this one exception lives in exactly one place:

```ts
function ranksMatchForContest(a: Rank, b: Rank): boolean {
  const KINGS = new Set(['K_RED', 'K_BLACK']);
  if (KINGS.has(a) && KINGS.has(b)) return true;
  return a === b;
}
```

### 2-second window

1. A card lands on the discard pile (turn Step 3, any player, including during final turns) → `ContestWindowState` opens with `openedAtMs = now`, `expiresAtMs = now + 2000`, `resolved = false`.
2. Any connected player may send `CONTEST_CARD { targetPlayerId, targetPosition }` while `now < expiresAtMs && !resolved`.
3. **Resolution, synchronous, single server tick, no `await` before mutation completes** (§L/§K):
   - Target is `handLocked` → reject `TARGET_LOCKED`. **This is an illegal-action rejection, not a wrong contest** — no reveal, no penalty draw, window stays open (per the brief's explicit distinction in its §12).
   - Target rank doesn't match discard top (via `ranksMatchForContest`) → **wrong contest** (below). Window stays open.
   - Target rank matches → **correct contest** (below). `resolved = true` set in the same tick this is determined, which is what guarantees at most one success per window even under near-simultaneous requests (§H concurrency, §K).

### Wrong contest

- The wrongly-tossed card's real value is revealed to **everyone** (broadcast) — the physical act of attempting the toss exposes it, per the brief.
- The card is not physically moved (validated before any mutation; equivalent to "returned to them" since it never left).
- The contesting player immediately draws one penalty card from the draw pile (reshuffling first if needed, §L); they see its value (§J), no one else does.
- Window remains open for further attempts.

### Correct contest — own card

- Card removed from the contester's hand (hand may reach length 0), becomes new discard pile top.
- `resolved = true`.

### Correct contest — opponent's card

- Card removed from target's hand.
- If contester's hand length ≥ 1: they choose one card via `GIVE_CARD { cardInstanceId }`, which physically moves to the target's hand. Knowledge of that instance is unaffected by the transfer — whoever already knew its value still does.
- If contester's hand length is 0: they instead draw one card from the draw pile (reshuffling first if needed) and that card goes directly to the target's hand. Contester stays at 0 cards. Contester knows the drawn card's value (they drew it); the target does not (they neither drew nor looked at it).
- `resolved = true`.

### Concurrency guarantee

Node's single-threaded event loop processes each incoming `CONTEST_CARD` request's validation-and-mutation as one uninterruptible synchronous block. `resolved` is flipped to `true` within that same block, before control ever returns to the event loop to process the next queued request. This means a second contest attempt arriving even a fraction of a millisecond later — whether it's a different player or the same one — is evaluated *after* `resolved` is already `true`, and is deterministically rejected with `WINDOW_ALREADY_RESOLVED`. **The one implementation rule this depends on**: nothing in the contest-resolution path may `await` (e.g., a database write) before `resolved` is set — any `await` inserted before that point reopens a real race window. This is a hard constraint carried into the relevant milestone, not just a design note.

---

## I. CABO Architecture

### Calling

`CALL_CABO` is legal in exactly one state: `turn.phase === 'PLAYING' && turn.awaitingCaboDecision === true && turn.currentPlayerId === sender`. This is unreachable mid-draw, mid-power, or before that turn's contest window has resolved — matching `DRAW → POWER → DISCARD/REPLACE → CONTEST WINDOW → CALL CABO` exactly. A zero-card player may call CABO; nothing in the rules restricts this, and it's a legitimate strong position (score 0, beatable only by a hand containing net-negative Red Kings).

### Immediate lock

On call, in one atomic step: `cabo.called = true`, `cabo.callerId` set, `handLocked = true` for that player. There is no tick where CABO is "called" but the hand isn't yet locked.

### Universal enforcement

From that instant, the single shared CABO-lock guard (§G, §L) rejects **any** action from **any** player — including the caller — that would replace, swap, inspect-and-swap, or contest any card belonging to the locked player. This is checked per-target, not per-actor, so it's impossible for even the caller themselves to accidentally act on their own now-locked cards.

### Final-turn queue

`finalTurnQueue` is populated with every other **connected** player, in turn order starting from the player after the caller, explicitly excluding the caller by construction (never added in the first place, not filtered out after).

### Caller's participation after calling

None. The caller never re-enters `PLAYING` this round — not to draw, not to contest, not even to pass. Because contesting requires touching a card (either the contester's own, which would be their now-locked hand, or a target's), and the guard blocks any action touching a locked hand regardless of who's acting, **the caller is structurally incapable of successfully contesting anything after calling CABO** — this falls directly out of the shared guard rather than needing a separate special-cased rule, which is worth noting as a case where the architecture's generality does the correctness work for free.

---

## J. Hidden-Information Architecture

**Model: knowledge attaches to the stable `cardInstanceId`, never to a hand position/slot.** A `Set<CardInstanceId>` per player (`GameState.knowledge[playerId]`) is the single source of "what does this player currently know," and the server's per-player `PlayerView` projector consults it on every broadcast — no client ever receives raw `GameState`.

### What grants knowledge

| Event | Whose set gains an entry | Entry |
|---|---|---|
| Initial deal | each player | their 2 pre-selected cards |
| **Any draw-pile draw** — normal, replacement, wrong-contest penalty, or zero-card-contest substitute | **the drawing player, immediately and unconditionally, regardless of where the card ends up** | the drawn `cardInstanceId` |
| 7/8 resolved | acting player | 1 own card |
| 9/10 resolved | acting player | 1 opponent card |
| J/Q blind swap | no one | — (genuinely blind, by design) |
| King inspect | acting player | both selected cards, for the decision window and beyond |
| King swap executed | no one new | physical move only — knowledge already travels with the instance |
| Wrong-contest reveal | **everyone** | the wrongly-tossed card becomes public |
| Card reaching the discard pile (any route) | everyone, implicitly | discard top is a public field, not a per-player grant |
| CABO lock | no one | affects mutability only |
| Reveal | everyone | everything, all at once |

### Why card-instance tracking (not position) is correct here

If a player peeked at their slot-2 card and it's later blind-swapped elsewhere, their knowledge should travel with that physical card, not stay pinned to slot 2 (which now holds a different, unseen card) — tracking by position would either destroy earned knowledge or, worse, silently grant knowledge of a new card the player never actually saw. Tracking by `cardInstanceId` avoids both failure modes and is exactly why a card taken via `REPLACE_CARD` correctly starts with **no** knowledge for anyone (it's a card instance nobody has drawn or inspected yet), even though it now occupies a position someone previously knew.

### What a client actually receives (`PlayerView`)

```
PlayerView {
  self:      { hand: [{ cardInstanceId, position, value, locked }] }   // full values, always, for own hand-known cards
  opponents: [{ playerId, hand: [{ cardInstanceId, position, value: "hidden", locked }] }]
             // "value" is real ONLY for a card this viewing player currently has an active,
             // scoped grant for (per the table above) — never broadcast to anyone else,
             // and not re-sent on later unrelated updates; the client caches it locally.
  drawPileCount, discardPileTop (public), phase, currentTurnPlayerId, caboCallerId, contestWindowExpiresAt, ...
}
```

No broadcast site anywhere in the system emits full `GameState` or a shared payload to a room; every emit is per-socket, built from that specific player's projected view.

---

## K. API / Socket Event Design

Client → server intentions (representative; full 1:1 list to be finalized as part of Milestone 5, not invented ad hoc while coding):

`CREATE_GAME`, `JOIN_GAME`, `LEAVE_GAME`, `READY`, `START_GAME`, `ACK_INITIAL_PEEK`, `DRAW_CARD`, `USE_POWER` (or the specific `LOOK_AT_OWN_CARD` / `LOOK_AT_OPPONENT_CARD` / `BLIND_SWAP` / `KING_INSPECT` / `KING_SWAP_DECISION` / `SKIP_POWER` variants), `DISCARD_CARD`, `REPLACE_CARD`, `CONTEST_CARD`, `GIVE_CARD`, `CALL_CABO`, `END_TURN`, `RECONNECT`.

Every action follows the identical pipeline (§L). Two representative examples:

### `DRAW_CARD`
- Request: `{}` — `playerId` derived from the authenticated socket session, never the payload.
- Validation: sender is `currentPlayerId`, phase allows a draw, `turn.drawnCard` is null.
- Mutation: reshuffle-if-empty (§L) → pop draw pile → set `turn.drawnCard` → grant drawer knowledge (§J).
- Response (to drawer only, via ack): `{ drawnCard: CardDefinition }`.
- Broadcast (to everyone else): `CARD_DRAWN` (no value) + updated `drawPileCount`.
- Errors: `NOT_YOUR_TURN`, `WRONG_PHASE`, `ALREADY_HOLDING_DRAWN_CARD`.

### `CONTEST_CARD`
- Request: `{ targetPlayerId, targetPosition, actionId }`.
- Validation/mutation: per §H, entirely within one synchronous tick.
- Response (to contester): success/failure ack.
- Broadcast (to everyone): `CONTEST_RESULT` — outcome, cards affected, new discard top, whether a penalty draw occurred (not its value), updated hand-size counts.
- Errors: `WINDOW_CLOSED`, `WINDOW_ALREADY_RESOLVED`, `TARGET_LOCKED`, `INVALID_TARGET`.

### `CALL_CABO`
- Request: `{}`.
- Validation: `awaitingCaboDecision === true` for sender, sender is `currentPlayerId`.
- Mutation: per §I.
- Broadcast: `CABO_CALLED { callerId }` to all.
- Errors: `NOT_YOUR_TURN`, `CABO_NOT_AVAILABLE_YET` (covers "mid-turn," "during power," "before contest window resolves" — all collapse to the same single boolean check failing).

Server → client events generally: `PLAYER_JOINED/LEFT`, `GAME_STARTED`, `DEAL_COMPLETE`, `CARD_DRAWN`, `POWER_RESOLVED` (scoped), `CARD_DISCARDED_OR_REPLACED`, `CONTEST_WINDOW_OPENED`, `CONTEST_RESULT`, `DRAW_PILE_RESHUFFLED`, `CABO_CALLED`, `FINAL_TURN_ADVANCED`, `ROUND_REVEALED`, `ROUND_SCORED`, `ERROR` (code + message only).

---

## L. Validation Architecture

Every action passes through the same ordered pipeline before the pure reducer ever runs:

1. **Identity** — `playerId` from the authenticated socket session, never the request payload.
2. **Phase/turn eligibility** — per the legality table in §E; e.g. `CALL_CABO` is checked against `awaitingCaboDecision` specifically, not just "is it your turn."
3. **Existence/shape** — referenced card instances, positions, and target players actually exist and match claimed location/ownership.
4. **CABO-lock guard, unconditional and per-target** — one shared function, consulted by every action type that touches any card (`REPLACE_CARD`, both `BLIND_SWAP` targets, both King targets, `CONTEST_CARD`'s target), regardless of who is acting. Implemented once, not duplicated per action, so a future new action type can't accidentally skip it.
5. **Action-specific rules** — contest window open/unresolved and rank-match (via `ranksMatchForContest`, §H); zero-card branching for opponent-contest give-vs-draw (§H); draw-pile reshuffle-if-empty performed transparently inside any draw (§L note below).
6. **Idempotency** — each action carries a client-generated `actionId`; the server keeps a small recent-id set per player and rejects exact duplicates (covers accidental double-sends and naive replay).
7. Only after all checks pass does the reducer execute — synchronously, with no `await` before mutation completes.

**Reshuffle-on-empty is implemented inside `DRAW_CARD`'s (and every other draw-triggering action's) mutation step, not as a separate client-visible action**: if the draw pile is empty when a draw is attempted, the server first moves the discard pile (minus its current top card) into a shuffled new draw pile, atomically, before servicing the draw — the requesting client just sees an ordinary successful draw, and a `DRAW_PILE_RESHUFFLED` event (with the new public `drawPileCount`) is broadcast since pile sizes are public information.

---

## M. Database Architecture

| Lives in... | What | Why |
|---|---|---|
| **Server memory** | The full authoritative `GameState` for every active game: deck order, hands, knowledge sets, turn/contest state. | This is the hot, fast-changing path; a DB round-trip per card action would add unnecessary latency and reopen the exact concurrency risk §H/§L are built to avoid. |
| **PostgreSQL** | `Game` (id, code, hostId, createdAt, status), `Player` (id, gameId, displayName, sessionToken), `Round` (id, gameId, roundNumber, startedAt, endedAt), `RoundResult` (roundId, perPlayerScoreJson, caboCallerId, caboSucceeded, winnerIdsJson). | Identity and outcomes need to survive a server restart and be queryable/historical; live card state does not need either property for V1. |
| **Client** | Only its own last-received `PlayerView`, plus values it's been shown via scoped power grants (the server doesn't re-send those on later updates — see §J). | Purely a rendering cache; never authoritative, always replaced wholesale by the next server push. |

Reconnection identity flows through the session token → `playerId` mapping stored in Postgres, independent of whether the in-memory `GameInstance` for that player's current game is still alive (§N).

---

## N. Reconnection Architecture

| Scenario | V1 behavior |
|---|---|
| Disconnect in lobby | Player marked `connected: false`; may rejoin with the same session token before `START_GAME`; if they don't return, the host can start without them. |
| Host disconnects (lobby) | Game stays open; no automatic host reassignment in V1 — a practical, intentionally simple default, not a gap left unaddressed, since the brief asks for a practical strategy rather than a full migration system. If it's unavailable indefinitely, players can leave and create a new game. |
| Disconnect mid-turn / mid-power / mid-contest-window | The game state simply holds — no timeout-driven auto-play or auto-discard, since inventing a fairness rule not present in the source rules would be exactly the kind of unrequested addition this brief prohibits. Other players see a "waiting for reconnect" indicator; contesting during another player's held turn is unaffected, since it doesn't require the disconnected player to act. |
| Reconnect (any phase) | Client presents its stored session token; server re-authenticates the socket to the existing `playerId`, rejoins the game's Socket.IO room, sets `connected: true`, and sends a fresh `PlayerView` computed by the exact same projector used for every other update — no separate "resync" code path to secure independently. If the in-progress power/King-inspection state included a grant already recorded in that player's `knowledge` set, the resumed view correctly reflects it. |
| Server process restart mid-round | Out of scope for V1 — in-memory state for any round in progress is lost; only Postgres-persisted identity and *completed* round history survive. Flagged plainly as a V1 limitation, not silently accepted (see §S if unresolved, though this is a stated tradeoff rather than an open question). |

---

## O. Security Model

| Threat | Mitigation |
|---|---|
| Client-modified local state | Never authoritative; every render derives from the last server-pushed `PlayerView`. |
| Forged card values / scores in a request | Structurally impossible — actions carry positions/target references only, never values; the server always looks up the real value itself. |
| Forged player identity | `playerId` is derived from the authenticated session token, never a payload field. |
| Out-of-turn actions | Validator step 2 checks `currentPlayerId`/`awaitingCaboDecision`/phase unconditionally on every request. |
| Reading another player's hidden values via socket inspection | Structurally prevented — no message to a given client ever contains another player's hidden values outside a scoped, per-player grant (§J); inspecting your own traffic reveals nothing beyond what you're already entitled to. |
| Forged contest timing / priority | Server-side `openedAtMs`/`expiresAtMs` and the synchronous single-tick resolution (§H) are the sole source of truth; client timestamps are never trusted. |
| Forged winner | `RoundResult` is computed entirely server-side by the pure `scoreRound` function; no client input feeds it. |
| Locked-hand exploits | The single shared CABO-lock guard (§L item 4) covers every action type that touches a card, by construction, not by an enumerated per-action list that could miss a new addition. |
| Replay / duplicate requests | Per-action `actionId` dedup (§L item 6). |
| Session/player spoofing | Identity comes only from the authenticated connection, never any client-supplied identity field, anywhere in the system. |

---

## P. Testing Strategy

### Unit — pure `game-engine` package, no sockets/DB/React

Deck/shuffle/deal; every card value including both Kings; zero-card scoring = 0 (and explicitly not treated as a floor); each power in isolation, including King's two-step inspect-then-decide and rejection against locked targets; contest rank-matching including the Red/Black King exception; correct-own, correct-opponent (both give-a-card and zero-card-draw-substitute branches), and wrong-contest (including the revealed-vs-not distinction from the illegal-target case) branches; CABO lock rejecting every action type against a locked hand, individually; the full `awaitingCaboDecision` gating (cannot call mid-draw/mid-power/pre-contest-resolution); final-turn queue construction and exclusion of the caller; `scoreRound`'s strict-inequality comparison against every worked example in the brief, including all three negative-score cases; draw-pile reshuffle preserving the discard top and excluding it from the reshuffled pool.

### Integration — real or in-process Socket.IO server + multiple test clients

Two clients firing `CONTEST_CARD` within the same tick — assert exactly one succeeds, ideally via a repeated/fuzzed-interleaving test given how much correctness leans on the synchronous-tick guarantee; a client probing for another player's hidden values via raw message inspection — assert nothing leaks; every phase/turn/actor mismatch from the legality table (§E), table-driven; every action type attempted against a locked hand; reconnect mid-power and assert the resumed view still reflects an already-granted King inspection; duplicate `actionId` resubmission is a no-op; draw-pile exhaustion mid-round triggers a correct, atomic reshuffle under concurrent draw attempts.

### Security-focused pass

A dedicated adversarial pass late in the milestone sequence (§R), using a modified/raw client to attempt every threat in §O directly against the running server, not just against the pure engine — since some of these (session spoofing, raw socket inspection) can only be meaningfully tested at the transport layer.

---

## Q. Folder Structure

```
/apps
  /web                        # Next.js frontend — presentational only
    /app
    /components
    /hooks                    # useGameSocket, usePlayerView — thin, no game logic
    /lib/socket-client.ts

  /server                     # Realtime game server
    /realtime
      socket-handlers.ts      # action → validator → reducer → projector → broadcast pipeline
      session.ts
      game-room-manager.ts    # GameInstance lifecycle, sharded by gameId
    /persistence
      prisma/schema.prisma
      round-repository.ts
      game-repository.ts
    /http                     # thin REST for game creation / health checks, if used
    index.ts

/packages
  /game-engine                # PURE — zero imports from Socket.IO, Express, Prisma, or React
    /model
    /reducer
    /rules
      deck.ts
      dealing.ts
      powers/{seven-eight,nine-ten,jack-queen,king}.ts
      contesting.ts           # includes ranksMatchForContest
      cabo.ts
      scoring.ts
    /validation
      action-validator.ts     # the single shared CABO-lock guard lives here
    /visibility
      knowledge.ts
      projector.ts
    /state-machine
      phases.ts
    index.ts

  /shared-types                # action payloads, event names, PlayerView shape —
                                 # imported by BOTH /apps/web and /apps/server

/tests
  /unit                         # against /packages/game-engine directly
  /integration                  # real socket server + fake clients
```

`/packages/game-engine` having zero framework imports is the enforcement mechanism for testability: every rules question in this document is answerable, and every corresponding unit test runnable, without a server process.

---

## R. Development Milestones

1. **Project setup** — monorepo scaffolding, TypeScript/lint configs, Prisma init.
2. **Pure engine — model & state machine** — types from §D, phase table from §E, reducer skeleton for the basic draw/discard/replace/turn-advance cycle (no powers/contest/CABO yet).
3. **Unit tests for milestone 2** — deck, deal, basic turn cycle. Green before proceeding.
4. **Hidden-information system** — knowledge sets and projector (§J), tested against hand-authored `GameState` fixtures directly, no sockets involved yet.
5. **Powers** — all four types including King's two-step flow (§G). Unit tests green before proceeding.
6. **Contesting** — full window/race logic, rank-matching exception, zero-card branching, wrong-contest reveal-vs-penalty split (§H). Race/interleaving unit tests specifically exercised here with an injectable clock.
7. **CABO / final turns / scoring** — `awaitingCaboDecision` gating, lock guard, final-turn queue, `scoreRound` including all worked examples and the tied-non-caller-winners array (§I, §D). All §P unit tests green before proceeding.
8. **Multiplayer server** — wire the engine into Socket.IO per §K/§L; two real browser tabs should be able to play a full round manually end-to-end locally.
9. **Concurrency hardening** — implement and specifically fuzz-test the synchronous-tick guarantee (§H) against real, not simulated, near-simultaneous socket requests.
10. **UI** — lobby through reveal/score/rematch, built against the now-stable `/packages/shared-types` contract.
11. **Reconnection handling** — implement §N's table; manually verified for every listed scenario.
12. **Security audit pass** — adversarial testing against §O's full threat list, with passing automated tests, not just a design review.
13. **UI polish.**
14. **Deployment** — split hosting per §C, environment/TLS config.

Nothing in a later milestone should require reopening `/packages/game-engine`'s core rules; if it does, that indicates a missed rule worth pausing on rather than patching around.

---

## S. Remaining Decisions — RESOLVED

Only genuinely open items remain — every ambiguity raised in Revision 2 that this brief explicitly resolved (CABO timing, locked-hand contest rejection, wrong-contest reveal, penalty-draw visibility, draw-pile reshuffle mechanics, contest window duration, `END_TURN` as a named action, zero-card CABO eligibility) is treated as settled and is not re-listed.

1. **Display/semantics of multiple tied non-caller winners.** §17 of the brief requires explicitly modeling the case where two or more non-callers tie for the lowest score after a failed CABO (reflected here as `winnerIds: PlayerId[]`), but doesn't specify whether the UI/round-result framing should present this as "co-winners," a plain tie with no single winner, or something else. The data model supports any of these; the presentation/semantics need a decision.
   **Resolved: co-winners.** All tied lowest-score non-callers are presented as joint winners of the round — `winnerIds` holds all of them, and the UI shows them together (e.g. "Winners: A, B") rather than a no-winner tie.
2. **No-CABO round-end fallback, revisited.** Nothing in the rules forces a CABO call or caps round length, and this brief doesn't introduce a turn limit or forced-CABO mechanic either. In practice, for a friends game this is unlikely to matter, but confirming whether V1 needs any safeguard (or whether "the round simply continues until someone calls CABO, indefinitely if needed" is an accepted, intentional behavior) would close this out rather than leaving it implicit.
   **Resolved: no safeguard.** The round continues indefinitely until someone calls CABO, matching the physical game exactly — no turn limit, no forced-CABO mechanic, no invented rule.
3. **Total deck exhaustion (draw pile *and* discard pile both reduced to essentially just the current top card).** The reshuffle mechanic (§L, §18 of the brief) assumes there's enough discard-pile material to reshuffle; if actual play somehow ground the deck down to almost nothing (a very unlikely scenario given only 52-ish cards and a handful of players), the engine should at minimum not crash. This doesn't need a rules answer so much as a confirmation that "treat as a practically unreachable edge case in V1, handled by not throwing an unhandled exception" is an acceptable engineering-only safeguard rather than something requiring a gameplay rule.
   **Resolved: engineering-only safeguard.** No new gameplay rule — the engine reshuffles whatever remains (even if that pool is just 0-1 cards) and must never throw; covered by a dedicated unit test rather than a rules change.

---

## ARCHITECTURE APPROVAL CHECKPOINT — APPROVED

**Approved 2026-09-13.** Implementation is underway per §R's milestone sequence, tracked in this repository. This document is the frozen source of truth for the rules/architecture; section letters (§A-§S) are referenced directly in code comments, commit messages, and tests throughout the implementation.
