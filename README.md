# RA2311033010046 — Backend Engineering

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-Express-green.svg)

> A full-stack systems-thinking exercise built across three connected services:
> a reusable logging middleware, a vehicle-maintenance scheduler that runs
> 0/1 knapsack across multiple depots, and a priority inbox that ranks
> notifications in real time using a min-heap.
>
> Every meaningful operation is observable through a centralized
> evaluation logging service. Every algorithm is hand-rolled — no `lodash`,
> no `priority-queue`, no shortcuts. Just first-principles problem solving
> with Node.js, Express, and a healthy respect for time complexity.

---

## Table of Contents

1. [The Story Behind This Repo](#the-story-behind-this-repo)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Repository Layout](#repository-layout)
4. [Component 1 — The Logger Middleware](#component-1--the-logger-middleware)
5. [Component 2 — Vehicle Maintenance Scheduler](#component-2--vehicle-maintenance-scheduler)
6. [Component 3 — Priority Inbox (Min-Heap)](#component-3--priority-inbox-min-heap)
7. [Notification System Design Doc](#notification-system-design-doc)
8. [Setup & Run](#setup--run)
9. [Environment Variables](#environment-variables)
10. [Testing & Verification](#testing--verification)
11. [Engineering Choices Worth Defending](#engineering-choices-worth-defending)
12. [What I Learned](#what-i-learned)
13. [Tech Stack](#tech-stack)
14. [Repo Hygiene](#repo-hygiene)
15. [License](#license)

---

## The Story Behind This Repo

When the brief landed, three things stood out: every service had to talk
to a remote logging API on every meaningful operation, the algorithms had
to be implemented from scratch (no `npm install priority-queue`), and the
whole thing had to feel like one cohesive system rather than three
unrelated scripts glued together.

So instead of building each part in isolation, I leaned into the
**observability story**: a single reusable logger that any service in the
repo can pull from a relative path, used identically across a vehicle
scheduler, a notification ranker, and a smoke-test harness. That single
seam is what makes this repo feel less like homework and more like a
small fleet of microservices.

---

## Architecture at a Glance

```
                    ┌─────────────────────────────────────────┐
                    │   Evaluation Service (remote)           │
                    │   http://20.207.122.201/evaluation-...  │
                    │                                         │
                    │   /logs   /depots   /vehicles  /notif…  │
                    └──┬──────────────┬──────────────┬────────┘
                       │              │              │
        Bearer JWT     │              │              │
        from .env      │              │              │
                       ▼              ▼              ▼
   ┌────────────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │  logger/  (npm pkg)    │◄─┤ vehicle_         │  │ priority_inbox.js│
   │                        │  │ scheduling/      │  │                  │
   │  Log(stack, level,     │  │                  │  │  Min-heap of N   │
   │      package, message) │  │  0/1 Knapsack    │  │  over M notifs   │
   │                        │  │  per depot       │  │                  │
   └────────────────────────┘  └──────────────────┘  └──────────────────┘
            ▲                          ▲                       ▲
            │ require('../logger')     │ Express on 3001       │ CLI
            │                          │                       │
   ┌────────┴────────┐                 │                       │
   │  test-logger.js │                 └───────── observed by ─┘
   │  (smoke test)   │                                │
   └─────────────────┘                                │
                                                      ▼
                                               every service
                                          calls Log() on every
                                          incoming request, every
                                          DB-style operation, every
                                          handler error.
```

Every box on the right calls into the box on the left. That is the
entire point of the architecture.

---

## Repository Layout

```
RA2311033010046/
│
├── logger/                          ← reusable, framework-agnostic
│   ├── index.js                       Log(stack, level, package, message)
│   └── package.json                   imports axios; nothing else
│
├── vehicle_scheduling/              ← Express microservice on port 3001
│   ├── index.js                       routes, evaluation-API client, logging
│   ├── knapsack.js                    pure-function bottom-up 0/1 DP
│   ├── package.json
│   ├── screenshot_response.png        Postman 200 OK proof
│   └── screenshot_logs.png            terminal showing Log() invocations
│
├── priority_inbox.js                ← CLI: top-N notifications via min-heap
├── priority_inbox_screenshot.png      terminal output proof
├── notification_api_screenshot.png    Postman GET /notifications proof
│
├── notification_system_design.md    ← 6 stages of system-design writing
├── test-logger.js                   ← 4-line smoke test for the logger
│
├── package.json                     ← root deps (axios, dotenv, express, heap)
├── README.md                        ← you are here
└── .gitignore                         .env, node_modules, .claude, *.log
```

The layout is intentional: **`logger/` is referenced via a relative
require from every consumer**, exactly the way you'd consume an internal
shared package in a monorepo before publishing it. Drop it into npm and
nothing else changes.

---

## Component 1 — The Logger Middleware

The contract is small and strict:

```js
const { Log } = require('./logger');

await Log(
  /* stack:   */ "backend",        // backend | frontend
  /* level:   */ "info",           // debug | info | warn | error | fatal
  /* package: */ "service",        // controller | service | route | …
  /* message: */ "Fetched 5 depots from evaluation API"
);
```

Every value is **lowercase, validated, and bound to the stack** —
`controller` is allowed for backend but rejected for frontend, `component`
is allowed for frontend but rejected for backend, and the four
"common" packages (`auth`, `config`, `middleware`, `utils`) work on both.
Trying to log `"INFO"` instead of `"info"`? You'll get a thrown error
before anything hits the wire.

### Design choices that earned their keep

- **A single async function, not a class.** The caller doesn't need a
  logger instance, doesn't need to inject one through dependency
  injection, doesn't need to remember to flush on shutdown. They need
  `await Log(...)`. That's it.
- **Token loaded from `process.env.BEARER_TOKEN`** — never hardcoded,
  never inlined into a commit, never even passed as a parameter.
- **Timeouts on the HTTP call** so a slow evaluation API can't wedge an
  Express request forever.
- **Failures don't propagate to callers.** A logger that throws into
  business logic when the upstream service blips is worse than no logger
  at all. Failures get a `console.error` and are swallowed.

### The smoke test

`test-logger.js` fires four `Log()` calls covering `info`, `error`,
`fatal`, `debug` against four different package categories. On a
healthy run the output is four UUIDs printed to stdout — those are the
`logID`s the evaluation service returned, which are now the canonical
proof that the logger is correctly authenticated and validated.

```
Test 1 logID: 1f9e93a3-fd9f-4129-93c5-ea451bb7ea48
Test 2 logID: c14661b8-092c-4751-8b26-6fa7350237b0
Test 3 logID: caca4243-20d4-4bf5-a0ea-cf277d8f6f00
Test 4 logID: 231d87d0-d5d0-4101-bced-9582cb90f27c
```

---

## Component 2 — Vehicle Maintenance Scheduler

A small Express service that wraps a classic combinatorial-optimization
problem: given a list of vehicle maintenance tasks (each with a
`Duration` and `Impact`) and a list of depots (each with a finite
`MechanicHours` budget), pick the subset of tasks for each depot that
**maximizes total impact without exceeding the mechanic-hour capacity**.

This is exactly the **0/1 knapsack** problem, and it's solved here with
a hand-written bottom-up dynamic-programming table — no helper library,
no recursion, no memoization wrapper. Just an `n × (capacity + 1)`
matrix, an outer loop over tasks, an inner loop over weights, and a
backtrack pass to recover the chosen items.

### Endpoints

| Method | Path                  | What it does                                 |
| ------ | --------------------- | -------------------------------------------- |
| GET    | `/health`             | Liveness probe; logs the call, returns `ok`. |
| GET    | `/vehicle-scheduling` | Fetches depots + vehicles, runs knapsack per depot, returns the optimal task selection per depot with totals. |

### What you get back

```json
{
  "success": true,
  "results": [
    {
      "depot_id": 3,
      "mechanic_hours": 188,
      "selected_tasks": ["bbe86faa-…", "ec4b314d-…", "..."],
      "total_duration": 176,
      "total_impact": 180
    }
  ]
}
```

Every step of that pipeline — incoming request, depot fetch, vehicle
fetch, per-depot knapsack run, completion summary, error handler — emits
its own structured `Log()` call. Pull the trace out of the evaluation
service and you can replay exactly what the server was doing, in order,
without touching the box.

---

## Component 3 — Priority Inbox (Min-Heap)

A CLI script that asks the question: *if we had 50,000 notifications,
which 10 should the user see first?*

The naive answer is "sort all 50,000 and take the top 10." That's
`O(M log M)` and it has to redo the entire sort every time a new
notification arrives. The smarter answer is a **min-heap of size N**:
build it in `O(M log N)`, update it in `O(log N)` per new item.

### The priority score

```
typeWeight   = { Placement: 3, Result: 2, Event: 1 }
minutesAgo   = (now - notificationTimestamp) / 60_000
recencyScore = 1000 / (minutesAgo + 1)
priorityScore = (typeWeight × 1000) + recencyScore
```

Two-tier ranking: **type dominates**, recency is the tie-breaker
within a type. A 12-hour-old Placement still outranks a 30-second-old
Event, which is the right behavior for a student-facing inbox where
"a job opening" matters more than "the cafeteria is open."

### Why a min-heap and not just a sorted array?

A min-heap of size N keeps the **smallest** of the top-N at the root,
so eviction is cheap: when a new notification arrives with score `s`,
compare it to the root in `O(1)`; if `s` wins, pop the root and push the
new entry in `O(log N)`. The heap silently drops every notification
that can't crack the top N.

When you finally want to display the list, drain the heap and reverse
the output — you have the top N in descending priority order.

### Run it

```bash
node priority_inbox.js 10   # top 10
node priority_inbox.js 15   # top 15
node priority_inbox.js 20   # top 20
```

Sample output:

```
========================================
  TOP 10 PRIORITY NOTIFICATIONS
========================================

1. [Placement] Berkshire Hathaway Inc. hiring
   ID        : 7d5c9bcf-c09e-4c26-be2c-5779e8f1808f
   Timestamp : 2026-05-02 02:23:03
   Priority  : 3001.84

…
```

---

## Notification System Design Doc

[`notification_system_design.md`](notification_system_design.md) is a
6-stage written design that walks through the same problem at increasing
levels of scale:

| Stage | What it covers |
|-------|----------------|
| 1     | REST API surface for notifications, real-time delivery via WebSockets vs polling. |
| 2     | Why PostgreSQL over MongoDB for this access pattern; full schema with composite + partial indexes. |
| 3     | A slow `SELECT *` query, four distinct reasons it's slow, and the optimized rewrite. |
| 4     | Caching strategy: Redis for unread counts, pagination, HTTP caching, connection pooling. |
| 5     | Asynchronous fan-out for "notify all 50k students" via BullMQ — including the transactional ordering of DB-write before email-send. |
| 6     | Priority inbox design (matches the implementation in `priority_inbox.js`). |

Each stage stands alone but builds on the previous one. The whole file
is meant to be read top-to-bottom as a single story about scaling a
notifications system.

---

## Setup & Run

You'll need **Node.js ≥ 18**, npm, and a freshly issued bearer token
from the evaluation service.

```bash
# 1. Clone
git clone https://github.com/SQUADRON-LEADER/RA2311033010046.git
cd RA2311033010046

# 2. Drop your token into .env
echo "BEARER_TOKEN=<paste_jwt_here>" > .env
echo "PORT=3000" >> .env

# 3. Install root deps (axios, dotenv, express, heap)
npm install

# 4. Install vehicle_scheduling deps
cd vehicle_scheduling && npm install && cd ..

# 5. Smoke-test the logger
node test-logger.js
# → expect 4 UUIDs printed

# 6. Run the priority inbox
node priority_inbox.js 10
# → expect a ranked list of 10 notifications

# 7. Boot the vehicle scheduler
cd vehicle_scheduling
$env:PORT=3001        # PowerShell — use export PORT=3001 on bash
node index.js
# → "Vehicle scheduler running on port 3001"
```

Then hit `http://localhost:3001/vehicle-scheduling` in Postman with the
same Bearer token in the `Authorization` header.

---

## Environment Variables

Stored in `.env` at the repo root and **never committed**.

| Variable       | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `BEARER_TOKEN` | JWT issued by the evaluation service. ~15-min TTL. Refresh via the auth endpoint. |
| `PORT`         | HTTP port for the vehicle scheduling service. Default 3000; override to 3001 for graders. |

### A word on the JWT

The token has roughly a **15-minute window** between `iat` and `exp`.
If a request to the evaluation API starts returning `401`, decode the
token (any JWT debugger will do — paste the value, look at the `exp`
claim) and check whether it's still alive. Refresh it via the auth
endpoint and paste the new value into `.env`.

---

## Testing & Verification

This repo includes four pieces of evidence that the system actually
works against the live evaluation service:

| File | What it proves |
|------|----------------|
| [`vehicle_scheduling/screenshot_response.png`](vehicle_scheduling/screenshot_response.png) | Postman screenshot of `GET /vehicle-scheduling` returning `200 OK` with full depot results, response time, and size. |
| [`vehicle_scheduling/screenshot_logs.png`](vehicle_scheduling/screenshot_logs.png) | Terminal screenshot showing the running server emitting `Log()` calls. |
| [`priority_inbox_screenshot.png`](priority_inbox_screenshot.png) | Terminal output of `node priority_inbox.js 10` showing the top 10 ranked notifications. |
| [`notification_api_screenshot.png`](notification_api_screenshot.png) | Direct Postman call to the evaluation `/notifications` endpoint. |

You can also re-run `test-logger.js` at any time to verify the logger
contract against the live service.

---

## Engineering Choices Worth Defending

- **No `priority-queue` package.** The `heap` library was used because
  it gives you a comparator-based binary heap and nothing else; the
  algorithmic logic (insert, evict, drain) is still hand-coded in the
  caller, which is what the brief asked for.
- **No `lodash`, no `ramda`, no helper utilities.** A bottom-up DP table
  in `knapsack.js` is ~30 lines of vanilla JavaScript. Adding a
  dependency to do that would be theatre.
- **The logger is a function, not a class.** No constructor, no
  builder, no `.child()` factory. The contract is a four-argument
  call. Dependencies stay invisible.
- **Logging is async-and-fire-and-forget**, but the calls are still
  `await`-ed in business logic so ordering is preserved per request.
  This is the rare case where you genuinely want serialized awaits —
  log line N+1 should not appear before log line N when you're
  reconstructing a trace.
- **Knapsack uses 2D not rolled-1D**, which costs an extra
  `O(n × capacity)` of memory but lets the backtrack step be
  unambiguous and easy to read. With our depot capacities this is
  cheap; with a million-row knapsack you'd reach for the rolled
  version.
- **Min-heap evicts on the boundary check, not after a full insert.**
  Pushing into an N-bounded heap then immediately popping the worst is
  an extra `O(log N)` you don't need; checking against `peek()` first
  saves the work whenever an item is destined to be dropped.

---

## What I Learned

- **Short-lived JWTs change how you build local dev tooling.** A
  15-minute token means your scripts have to read `.env` lazily on
  every start, never cache the token in memory across hot-reloads, and
  fail loudly on `401` rather than silently.
- **Logging APIs rate-limit, just like everything else.** The
  evaluation service happily accepts 4 logs in a row from
  `test-logger.js` and rejects the 12th in a burst from a single
  `/vehicle-scheduling` request. The fix in production would be a
  client-side queue that batches logs with a small delay; the fix in a
  hackathon is to be aware that "noisy logs" doesn't mean "broken
  service."
- **`dotenv` reads but doesn't override.** If `PORT=3001` is set in
  the shell, `dotenv.config()` won't replace it with the `.env`'s
  `PORT=3000`. That precedence rule lets you keep one `.env` and still
  override per-process when you boot a service on a different port.
- **The right algorithm beats the right framework every time.** The
  difference between `O(M log M)` and `O(M log N)` is invisible when
  `M = 100`, and ruinous when `M = 50_000`. Picking the right data
  structure is the most leverage a backend engineer has.

---

## Tech Stack

- **Runtime:** Node.js (≥ 18)
- **HTTP framework:** Express 4
- **HTTP client:** Axios
- **Heap data structure:** [`heap`](https://www.npmjs.com/package/heap)
  (comparator-based binary heap)
- **Config:** dotenv
- **External services:** Evaluation API (logs, depots, vehicles,
  notifications) over HTTP, JWT-authenticated.

That's it. No ORM, no Redis, no message queue, no cron — every one of
those is a deliberate omission, discussed in
`notification_system_design.md` as the recommended next step at scale.

---

## Repo Hygiene

- `.env` and `node_modules/` are git-ignored from the very first commit.
- `.claude/` (editor agent settings) is also excluded.
- Each milestone is a separate commit with a conventional-commits
  prefix (`feat:`, `docs:`, `chore:`).
- No real names, no employer names, no internal jargon in commit
  messages or in code comments.
- Screenshots live next to the code they prove out, not in a separate
  `docs/` folder, so a reviewer can see proof and source side-by-side.

---

> Built as a single-author submission for the Backend Engineering
> Hackathon evaluation track.
> Roll number: **RA2311033010046**.

---

## License

This project is released under the [MIT License](LICENSE). You are
free to use, modify, and distribute the code, provided the original
copyright notice is preserved.

---

## Author

Maintained by **RA2311033010046** as part of the Backend Engineering
Hackathon submission. Contributions, questions, and reviews are welcome
through the project's issue tracker.
