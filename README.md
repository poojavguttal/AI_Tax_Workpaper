# Miraflores workpaper

A web-native tax workpaper for the Okafor-Lindqvist 2025 return. The design and the findings are in the plan doc.

## Step 1: packet ingestion (done)

`data/packet.json` is the packet exactly as delivered (sha256 `ee01f850…`). `loadPacket()` freezes it and projects it into:

| Projection | Rows | Notes |
| --- | --- | --- |
| documents / pages | 74 / 199 | pages are `render_kind: 'simulated'`; a real scan later fills `asset_url` |
| observations | 3,392 | 3,012 document values, 86 client statements (questionnaire, messages, call notes, organizer fields), 23 agency records, 271 prior-year values; ids are the packet's own refs |
| engine lines | 625 / 625 / 627 | v1, v2, v3 |
| diagnostics, asset books, periods | 37, 81, 2 | |

`resolveRef()` follows every README reference format (`ev-`, `D01`, `doc:D30#page32`, `qa-`, `msg-`, `call-`, `py:/`, `agency:/`, `asset:`, `household:`, `ref:param.`, `ref:fx.`, `timeline:`, `v1`, line keys). Organizer fields extend `household:<id>` with `.<field>`, e.g. `household:theo.ssn`.

`checkIntegrity()` follows all 8,069 line inputs and sources plus diagnostic and timeline refs; it reports zero problems for this packet.

## Step 2: fact matching (done)

`matchFacts(packet)` groups the 3,392 observations into 978 facts across 24 activities. Every observation sits in exactly one fact. Fields of one lot, trip or payment row form a record fact.

Content rules merge facts that are the same real-world item. Each rule reads document types, issuers, page text and values, never specific document ids, and records why it merged:

| Rule | Found in this packet |
| --- | --- |
| duplicateDocuments | D10 is a re-upload of the Halvorsen W-2 D09 (100% of fields identical) |
| supersession | D31 (CORRECTED) replaces D30; changed M6 wash, M9 basis, M14 date and term |
| duplicatePages | D23 page 3 is a second scan of page 2 (mileage) |
| sameAccountInterest | Northlake sweep interest, account 7731, on D28 and D29 |
| escrowTaxes | D58 county receipt = D57 box 10; D49 installments add up to D48 box 10 |
| payoffInterest | D56 payoff interest is inside D55 box 1 |
| processorIncluded | D21 1099-K is part of the Atlas 1099-NEC (D17), per books page D15 p3 |
| lotParts | Broker lots take basis from the plan supplement (D11) or the cost export (D35) |
| priorYearLines | 2024 return lines = values read off D06 |
| identity | SSN, birth date, IP PIN: organizer vs 2024 return vs documents |
| payments | Estimates: IRS transcript + EFTPS, FTB + Web Pay, and the client's own answer |

Status per fact: `single`, `corroborated`, `incomplete` (C6 has no basis), `conflict`. The conflicts are only the two real ones: Theo's SSN (3309 in the organizer vs 3390 on the 2024 return, the card and D06) and the federal Q4 estimate (client says 4,000; IRS has 3,000). D07, D69, D70 and D72 have nothing extracted and carry a system disposition.

Apply `db/migrations/0002_facts.sql` after 0001; the seed script writes both.

## Step 3: check library (done)

`runChecks(packet, matched, { version })` returns 51 results for v3, every one `status: 'open'`. Each result has: kind, lines, facts, evidence refs, engine vs expected value, estimated federal and CA effect (v3 `tax_effect_rates`, or the engine's `what_if` where one exists), recommendation, alternatives, and what closing it requires.

| Kind | Meaning | Closed by | v3 |
| --- | --- | --- | --- |
| error | Evidence establishes the line is wrong | a correction | 14 |
| conflict | Evidence disagrees or is missing; someone must decide what to rely on | a decision | 6 |
| judgment | More than one treatment is defensible | a decision citing its authority | 6 |
| completeness | Must be accounted for (unused documents, engine diagnostics) | a disposition | 21 |
| outside_filing | An obligation beyond this return (FBAR, 3520, 1099-NEC, FTB transfer) | acknowledgement | 4 |

Errors carry no recommendation. Conflicts and judgments carry one, but it never closes the result. Sign-off is `partner` when any effect or alternative exceeds the firm's 1,000 threshold, else `reviewer`. Tests map each of the 22 findings to its result and effect, and assert that the items the engine got right raise nothing. On v1, the check flags the three Meridian lots that the corrected 1099 changed.

Apply `db/migrations/0003_checks.sql` after 0002.

## Step 4: events, reducer, effective return, filing gate (done)

One insert-only `events` table and one pure function: `reduce(makeBase(packet, matched, checks), events)` returns item statuses, the effective return, required steps, notes, sign-offs, blockers and `canFile`. Invalid events stay in the log and are rejected with a reason.

- **Closing items.** Errors close by `correct`, conflicts and judgments by `decide` (choose an alternative and give the rationale; judgments also need the authority), completeness by `dispose` or `explain`, and outside filings by `acknowledge`. A reviewer or partner may `dismiss` a finding with a reason.
- **Sign-off.** Each item needs the reviewer, plus the partner when its effect is over 1,000. Nobody may sign off their own work. A sign-off stores a content hash, so any later change marks the item `reopened`. Return sign-offs and the client's approval hash the whole effective return.
- **Effective return.** Engine values plus recorded changes, without rerunning the engine. Every change becomes a per-line delta that flows up through each line that is a true sum or carry of its inputs (signs inferred from the engine's own values; forms whose arithmetic embeds floors, limits or phase-outs, such as AMT, credits, QBI, SE tax, passive losses and basis, never pass changes on). The engine's what-if values are applied line for line as deltas, so they add to other changes. Each item's estimated tax effect (`tax_effect_rates` or `what_if`) is booked on the tax lines (1040 line 16, 540NR line 37) and payment effects on the payment lines, so lines 24, 33 and 37 and 540NR 64, 78 and 97 always equal the headline totals and every sum line still adds up (tested). Accepting every recommendation gives a federal refund of 4,264 and a California refund of 11,692, the figures on the findings tab.
- **Undo.** A `revert` of an event or a whole batch; a revert of a revert restores it. Only the author, a reviewer or a partner may undo.
- **Filing gate.** Blockers are open blocking items, open blocking notes, unfinished required steps (seven of the twelve derive from item status and sign-offs), and missing or stale sign-offs and approval. A `file` event freezes the return; later content changes are rejected.
- **Roles** come from `firm.staff`, including `active_from`, and are never taken from the event.

Apply `db/migrations/0004_events.sql`: append-only trigger, users write only as themselves, and `file` is reserved for the server-side gate.

```
npm install
npm test             # acceptance tests for ingestion
npm run seed:dry     # validate + row counts, no network
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run seed
```

Apply `db/migrations/0001_packet.sql` to the Supabase project before seeding. Packet tables are read-only after load (RLS select-only, triggers block update and delete).

## Step 5: schedules, season, people, filing and firm (done)

New event kinds, all validated by the reducer and covered by tests (132 passing):

| Event | Who | Rule |
| --- | --- | --- |
| `extend` | reviewer, partner | once per jurisdiction, before filing; records the payment sent |
| `efile_ack` | reviewer, partner | accepted or rejected per jurisdiction; a rejection unfreezes the return so it can be fixed and resent |
| `amend` | reviewer, partner | only after an accepted filing; reopens changes on top of the filed version, which stays as filed; needs fresh sign-offs, approval and a new `file` |
| `ask` / `answer` | staff and clients | a question goes to one person; only they (or either client) answer; the answer is kept as evidence; optional blocking |
| `assign` | reviewer, partner, firm admin | to an active preparer, reviewer or partner, with a due date |
| `log_time` | staff | against the firm's budget areas |
| `set_standard` | firm admin | partner threshold and variance limits; the required sign-off level is derived from the current threshold |
| `notice_response` | preparer, reviewer, partner | only after filing; tied to the filed return's content hash |
| `roll_forward` | preparer, reviewer, partner | opens 2026 from the filed return |

Screens: Schedules (depreciation by asset, sales detail, state split, books to tax, rentals and passive, K-1 lines, carryovers, basis by year, prior preparer vs us, each tied to the return), Versions (v1/v2/v3 compare, findings raised and cleared, season replay), Filing (extension, transmit, e-file answers, amendment as 1040-X columns, notices, client's copy), Next year (2026 estimates, opening balances, recurring decisions), Inbox (questions, assignments, deadlines), Client portal, Examiner view (read-only, as filed), Firm (status and search, staff, standards, time against budget). Every return line has a what-if that can be kept as an adjustment. Tabs of one browser update live (storage events) and show who else is viewing (BroadcastChannel presence); with Supabase the same comes from Realtime.
