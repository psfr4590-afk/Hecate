# HECATE

[![Regression](https://github.com/psfr4590-afk/Hecate/actions/workflows/regression.yml/badge.svg)](https://github.com/psfr4590-afk/Hecate/actions/workflows/regression.yml) [![Node.js 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)](https://github.com/psfr4590-afk/Hecate)

**Local-first security assessment and red-team operations platform for authorized engagements.**

HECATE is a unified operator platform that brings **engagement scope, target inventory, reconnaissance, security testing, sessions, evidence, findings, reporting, and audit history** into one local control plane.

It is designed for authorized security work where assessment state needs to remain coherent from initial scope through evidence collection, finding follow-through, retesting, and reporting.

> **Current position:** HECATE is a working single-operator, single-process local platform with a React operator console, REST/WebSocket API, persistent SQLite state, seven registered capability modules, engagement-scoped authorization, encrypted sensitive material, durable audit history, and regression coverage across the core platform, API, UI surface, and module suites.

## What HECATE provides

| Area | Implemented capability |
|---|---|
| **Assessment control plane** | Engagements, targets, sessions, evidence, findings, audit history, assessment plans, remediation lifecycle, and retests |
| **Operator interface** | React dashboard and dedicated workspaces for all seven registered modules |
| **API** | Local REST API plus authenticated WebSocket event channel |
| **Reconnaissance** | Scoped crawling, page/asset discovery, forms, secret discovery, evidence, statistics, and cancellation |
| **Web application assessment** | Target-scoped scanning, generated requests, findings, statistics, and cancellation |
| **Adversary-in-the-middle** | Proxy/lure workflows, victim-session handling, interception sessions, DNS controls, traffic and credential records |
| **Command and control** | Implant registration, cryptographic implant protocol, task queueing, beacon handling, and result collection |
| **Delivery** | Campaign management, target ingestion, delivery state, SMTP profiles, and recipient tracking |
| **Post-exploitation** | Hash ingestion, Kerberoast workflows, Active Directory attack-path analysis, and C2-backed dump/task workflows |
| **Evidence & reporting** | Engagement-scoped evidence indexes, findings, audit verification, JSON reports, and Markdown reports |
| **Persistence** | SQLite WAL mode, foreign keys, full synchronous durability, queues, and restart/reconciliation behavior |
| **Security controls** | Engagement authorization, signed browser sessions, WebSocket policy, encrypted sensitive material, and audit-chain integrity |

## Assessment lifecycle

HECATE is organized around a continuous assessment record rather than isolated tools:

```text
Engagement / scope
        ↓
Target inventory
        ↓
Module execution
        ↓
Session / Job
        ↓
Evidence / Finding
        ↓
Remediation / Retest
        ↓
Assessment report + audit history
```

The shared core keeps the assessment lifecycle connected while the seven capability modules remain independently implemented.

## Seven capability modules

1. **Recon** — scoped web crawling, page and asset discovery, forms, secret discovery, evidence, and cancellable jobs.
2. **Evil Proxy** — phishing lures, victim-session handling, phishlet-backed proxying, and session export.
3. **C2** — implant registration, per-implant cryptographic authentication, task queueing, beacon handling, and result collection.
4. **Delivery** — campaign management, target ingestion, delivery state control, SMTP profiles, and recipient tracking.
5. **MITM** — interception sessions, DNS rule management, DNS service control, traffic records, and credential records.
6. **WebApp** — target-scoped web application scanning, generated requests, findings, scan statistics, and cancellation.
7. **Post-Exploit** — hash ingestion, Kerberoast workflows, AD attack-path analysis, and C2-backed dump/task workflows.

These descriptions reflect implemented backend capabilities. They do not imply that every capability has an independent GUI workflow beyond the documented operator control surfaces.

## Why the architecture is different

HECATE is not seven unrelated security utilities placed behind one menu. The modules share the same assessment context and persistence model:

```text
                    ┌─────────────────────────┐
                    │   HECATE Control Plane  │
                    │ scope · auth · audit    │
                    │ state · events · reports│
                    └────────────┬────────────┘
                                 │
          ┌──────────┬───────────┼───────────┬──────────┐
          ↓          ↓           ↓           ↓          ↓
        Recon     WebApp       C2        Delivery     MITM
          │          │           │           │          │
          └──────────┴───────────┼───────────┴──────────┘
                                 ↓
                         Post-Exploit
                                 │
                                 ↓
                    Evidence · Findings · Retest
                                 │
                                 ↓
                         Audit / Reporting
```

This shared model is what lets HECATE maintain engagement-scoped state and authorization across otherwise different assessment workflows.

## Verification at a glance

The repository contains regression coverage for:

- Core startup, migration, authorization, assessment state, and network profiles
- API lifecycle, authentication, browser sessions, and WebSocket policy
- All seven module suites
- Module lifecycle projection and engagement lineage
- Evidence/finding/report generation
- Audit-chain verification
- UI capability-surface checks
- Encoding checks
- SQLite restart/recovery behavior
- C2 wire-payload preservation
- MITM DNS runtime ownership

Run the full regression suite with:

```bash
npm test
```

The repository also provides focused core, API, module, phase, UI, clean-start, and Juice Shop end-to-end test commands later in this document.

## Security boundary

HECATE is intentionally a **local, single-operator platform**, not a multi-user IAM product.

Sensitive runtime data is kept outside source control. The application uses encrypted sensitive material, engagement-scoped authorization, signed browser sessions, WebSocket controls, durable audit history, and explicit runtime-data isolation.

The project also documents its architectural limits rather than hiding them. For example, direct database administrators can bypass application-level append-only protections, MITM DNS runtime state is process-global, and the current C2 replay model is not presented as a separate monotonic sequence/nonce protocol.

## Quick start

Requirements are deliberately small: **Node.js 22+** with Node's `node:sqlite` support.

```bash
git clone https://github.com/psfr4590-afk/Hecate.git
cd Hecate
npm install
npm start
```

Then open:

```text
http://127.0.0.1:7331/
```

A fresh install creates local operator state without placing keys or API credentials in the repository.

## Project structure

```text
hecate/
├── cli/             Entry point and startup/key-generation commands
├── ui/              React operator console and Vite build
├── api/             HTTP/WebSocket server, routes, middleware
├── core/             DB, crypto, stores, graph, audit, events, assessment
└── modules/          Recon, Evil Proxy, C2, Delivery, MITM, WebApp, Post-Exploit
```

## Maintainer and security information

- [Contributing guide](CONTRIBUTING.md) for development and pull requests.
- [Security policy](SECURITY.md) for vulnerability reports and sensitive disclosures.
- [Regression workflow](.github/workflows/regression.yml) for the automated verification path.

## Requirements

- Node.js **22 or newer**
- Node's `node:sqlite` support. HECATE is started with `--experimental-sqlite`.
- No separate native build toolchain is required by the core application.

## Operator workflow

The platform's actual data flow is centered on:

```
Engagement
   ↓
Target
   ↓
Module execution
   ↓
Session / Job
   ↓
Evidence / Finding
   ↓
Audit history
```

An engagement establishes scope and lifecycle context. Targets are reusable assessment assets. Modules operate against authorized engagement targets and persist their resulting observations, sessions, evidence, findings, or jobs into the shared platform.

The seven module workflows are:

1. **Recon** — scoped web crawling, page and asset discovery, forms, secret discovery, evidence, and cancellable jobs.
2. **Evil Proxy** — phishing lures, victim-session handling, phishlet-backed proxying, and session export.
3. **C2** — implant registration, per-implant cryptographic authentication, task queueing, beacon handling, and result collection.
4. **Delivery** — campaign management, target ingestion, delivery state control, SMTP profiles, and recipient tracking.
5. **MITM** — interception sessions, DNS rule management, DNS service control, traffic records, and credential records.
6. **WebApp** — target-scoped web application scanning, generated requests, findings, scan statistics, and cancellation.
7. **Post-Exploit** — hash ingestion, Kerberoast workflows, AD attack-path analysis, and C2-backed dump/task workflows.

These descriptions reflect implemented backend capabilities. They do not imply that every capability has a dedicated GUI workflow.

## Assessment architecture

HECATE separates shared assessment state from individual capability modules.

```
Assessment
  ├── Engagement / scope
  ├── Target inventory
  ├── Module execution
  ├── Sessions / jobs
  ├── Evidence
  ├── Findings
  ├── Audit trail
  └── Retest / validation records
```

Targets are generic assessment assets rather than module-specific objects. A target can represent an application, API, host, service, identity boundary, wallet/custody component, smart contract, RPC endpoint, or other authorized asset.

Target priority is derived from data sensitivity and business criticality. The combined value is a planning signal, not a vulnerability score.

Shared network profiles provide consistent assessment traffic behavior across applicable modules, including assessment mode, concurrency, pacing, bounded retries/backoff, connection reuse, and explicit proxy/tunnel/DNS route metadata.

## Security and isolation model

HECATE is designed around a single local operator rather than a multi-user IAM model.

- Operator API routes use the configured API token or the local signed browser session.
- Browser sessions are process-scoped, HttpOnly, SameSite=Strict, signed, expire after eight hours, and are automatically minted only for loopback HTTP clients.
- WebSocket connections apply origin, authentication, payload, heartbeat, and engagement-scope controls.
- C2 implants use their own per-implant AES-based protocol rather than the operator API token.
- Sensitive stored material is encrypted using the operator key.
- Engagement membership is enforced on protected module resources where engagement scope applies.
- SQLite uses WAL mode, foreign keys, full synchronous durability, and append-only audit protections. Audit projection is mandatory: an event is not broadcast or projected onward unless its audit record has been appended successfully.
- New audit entries include the relevant subject and engagement context in their hash-chain input.
- Existing legacy audit entries remain verifiable using their original hash format.

The system is not a multi-operator authorization platform. Direct database administrators can bypass application-level append-only controls. MITM DNS runtime state is process-global even though its control API is engagement-authorized. These are current architectural characteristics, not undocumented guarantees.

## Runtime-data isolation

Real engagement data stays outside the Git repository. Runtime databases, WAL/SHM files, evidence, logs, coverage output, generated UI output, operator keys, environment files, certificates, and private keys are ignored.

Use synthetic fixtures for repository tests. Never commit real target credentials, tokens, session material, wallet seeds/private keys, captured evidence, or client runtime databases.

## First run

A fresh clone no longer requires a separate key-generation or environment-configuration step.

```bash
git clone https://github.com/psfr4590-afk/Hecate.git
cd Hecate
npm install
npm start
```

`npm install` builds the production React console automatically. On the first `npm start`, HECATE creates its local operator state under the user's home directory, including the 32-byte encryption key and API token, without writing secrets into the repository. Existing `HECATE_KEY_PATH` or `HECATE_API_TOKEN` values are respected and are never overwritten.

Once startup reports that HECATE is ready, open:

```text
http://127.0.0.1:7331/
```

The local browser session is created by the HECATE process, so the operator console does not require manually copying an API token into the browser.

## Documentation

The repository root contains only the primary project entry point and configuration. Historical engineering and remediation records are kept under `docs/history/` so development history remains available without cluttering the project root.

## Operator console

The React operator console is built and served by the same local HECATE process.

Build the production console:

```bash
npm run build:ui
```

Start HECATE:

```bash
npm start
```

Then open:

```
http://127.0.0.1:7331/
```

The local node issues a process-scoped browser session cookie. The API token is not copied into browser storage.

The dashboard exposes the core control plane plus all seven registered modules. Every module workspace now provides an operator control panel backed by the module's existing API surface, with engagement scope and existing authorization preserved.

For UI development with hot reload:

```bash
# Terminal 1
npm start

# Terminal 2
npm run dev:ui
```

The Vite development server listens on `127.0.0.1:4173` and proxies API requests to the local HECATE node.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `HECATE_API_TOKEN` | No | Optional operator API token; first run generates and stores one locally |
| `HECATE_KEY_PATH` | No | Optional path to the 32-byte AES-256 operator key; first run creates one locally |
| `HECATE_PORT` | No | API port, default `7331` |
| `HECATE_HOST` | No | Bind address, default `127.0.0.1` |
| `HECATE_PHISHLET_DIR` | No | Directory for custom phishlet JSON files |

## CLI

Start:

```bash
node --experimental-sqlite cli/index.js start [options]
```

Options:

```
-p, --port <port>    Port (default: 7331)
-H, --host <host>    Bind address (default: 127.0.0.1)
-d, --db <path>      SQLite database path (default: ./data/hecate.db)
-k, --key <path>     AES-256 key file path (overrides HECATE_KEY_PATH)
--dry-run            Delivery mode: queue sends without actually sending email
--log-level <level>  Log level
```

Generate a key:

```bash
node cli/index.js keygen [options]
```

Options:

```
-o, --out <path>     Key output path (default: ~/.hecate/operator.key)
--force              Overwrite an existing key
```

## API authentication

Authenticated operator routes are under `/api/v1/`.

They accept either:

```
Authorization: Bearer <HECATE_API_TOKEN>
```

or:

```
X-Hecate-Token: <HECATE_API_TOKEN>
```

There are two intentional exceptions:

- `POST /c2/beacon` is an implant-facing endpoint and uses the implant's cryptographic protocol instead of the operator token.
- `/api/v1/delivery/track/*` is recipient-facing Delivery tracking and is intentionally public so an external recipient can trigger an open, click, or submission event.

## Assessment management

Phase 5 adds persistent assessment planning and finding follow-through. Each engagement can store an assessment plan with explicit phases/options, findings now have a durable remediation lifecycle, and retest records can be attached to findings and completed with a documented result.

```text
GET  /api/v1/assessment/:eid/plan
PUT  /api/v1/assessment/:eid/plan
PATCH /api/v1/assessment/:eid/findings/:fid
GET  /api/v1/assessment/:eid/findings/:fid/retests
POST /api/v1/assessment/:eid/findings/:fid/retests
PATCH /api/v1/assessment/:eid/findings/:fid/retests/:rid
```

Finding lifecycle states are `open`, `in-progress`, `resolved`, `accepted-risk`, `false-positive`, and `retest-pending`. Retest states are `pending`, `passed`, `failed`, and `inconclusive`. All assessment-management routes remain engagement-authorized.

## Assessment reporting

Engagement-scoped assessment reports are generated from durable core records without exposing credential records or raw evidence payloads. The JSON report provides an operator-ready inventory of targets, sessions, findings, evidence indexes, and audit status. A Markdown representation is available for professional report workflows.

```text
GET /api/v1/reports/engagement/:eid
GET /api/v1/reports/engagement/:eid/markdown
```

Reports are projections of the current engagement state, not immutable legal records. Runtime evidence remains stored separately and is referenced by metadata/path rather than copied into the report output.

## API reference

The routes below reflect the implemented route surface. Authentication and engagement requirements still apply according to the module's authorization rules.

### Core — `/api/v1/`

| Method | Route | Purpose |
|---|---|---|
| GET, POST | `/engagements` | Engagement management |
| GET, POST, PATCH, DELETE | `/targets` | Target management and search |
| GET, POST | `/credentials` | Encrypted credential records |
| GET, POST | `/sessions` | Module session tracking |
| GET, POST | `/evidence` | Evidence records |
| GET, POST | `/findings` | Finding records |
| GET | `/graph/targets/:eid` | Target relationship graph |
| POST | `/graph/ad/ingest` | BloodHound JSON ingestion |
| GET | `/audit` | Audit history |
| GET | `/audit/verify` | Verify the audit hash chain |
| GET | `/status` | Platform/module status |

### Recon — `/api/v1/recon/`

| Method | Route | Purpose |
|---|---|---|
| GET | `/jobs` | List jobs |
| POST | `/jobs` | Start a crawl |
| GET | `/jobs/:id` | Job detail |
| GET | `/jobs/:id/stats` | Job statistics |
| DELETE | `/jobs/:id` | Cancel a job |
| GET | `/jobs/:id/pages` | Crawled pages |
| GET | `/jobs/:id/secrets` | Discovered secrets |
| GET | `/jobs/:id/forms` | Discovered forms |
| GET | `/config/defaults` | Default crawler configuration |
| GET | `/profiles` | Recon profiles |

### Evil Proxy — `/api/v1/evil-proxy/`

| Method | Route | Purpose |
|---|---|---|
| GET | `/lures` | List lures |
| POST | `/lures` | Create a lure |
| GET | `/lures/:id` | Lure detail |
| DELETE | `/lures/:id` | Delete a lure |
| GET | `/sessions` | Victim sessions |
| GET | `/sessions/stats` | Session statistics |
| GET | `/sessions/:lureId/:victimSid` | Session detail |
| GET | `/sessions/:lureId/:victimSid/export` | Export a harvested session |
| GET | `/phishlets` | Available phishlets |
| GET | `/status` | Module status |

### C2 — `/api/v1/c2/`

| Method | Route | Purpose |
|---|---|---|
| GET | `/implants` | List implants |
| GET | `/implants/stats` | Implant statistics |
| POST | `/implants` | Register an implant |
| DELETE | `/implants/:id` | Remove an implant |
| GET | `/implants/:id/tasks` | List implant tasks |
| POST | `/implants/:id/tasks` | Queue an implant task |
| DELETE | `/implants/:id/tasks/:taskId` | Remove a queued task |
| GET | `/implants/:id/results` | Retrieve task results |
| GET | `/tasks/:taskId/result` | Retrieve an individual task result |
| GET | `/profiles` | List engagement-scoped implant profiles |
| POST | `/profiles` | Create an engagement-scoped implant profile |
| GET | `/status` | Module status |

Implant communication is handled separately at:

```
POST /c2/beacon
```

### Delivery — `/api/v1/delivery/`

| Method | Route | Purpose |
|---|---|---|
| GET | `/campaigns` | List campaigns |
| POST | `/campaigns` | Create a campaign |
| GET | `/campaigns/:id` | Campaign detail |
| GET | `/campaigns/:id/stats` | Campaign statistics |
| POST | `/campaigns/:id/targets` | Import/add campaign targets |
| GET | `/campaigns/:id/targets` | List campaign targets |
| POST | `/campaigns/:id/state` | Start, pause, or complete a campaign |
| DELETE | `/campaigns/:id` | Delete a campaign |
| GET | `/smtp` | List engagement-scoped SMTP profiles |
| POST | `/smtp` | Create an SMTP profile |
| DELETE | `/smtp/:id` | Delete an SMTP profile |

Public recipient tracking:

| Method | Route | Purpose |
|---|---|---|
| GET | `/track/open/:trackingId` | Open tracking |
| GET | `/track/click/:trackingId/:linkId` | Click tracking/redirect |
| POST | `/track/submit/:trackingId` | Submission tracking |

### MITM — `/api/v1/mitm/`

| Method | Route | Purpose |
|---|---|---|
| GET | `/sessions` | List interception sessions |
| POST | `/sessions` | Create an interception session |
| DELETE | `/sessions/:id` | Delete a session |
| GET | `/exchanges` | Intercepted traffic |
| GET | `/credentials` | Captured credential records |
| GET | `/dns/rules` | List DNS rules |
| POST | `/dns/rules` | Add a DNS rule |
| DELETE | `/dns/rules/:hostname` | Remove a DNS rule |
| POST | `/dns/start` | Start the DNS service |
| POST | `/dns/stop` | Stop the DNS service |
| GET | `/config` | Read MITM configuration |
| PATCH | `/config` | Update MITM configuration |
| GET | `/stats` | Module statistics |

### WebApp — `/api/v1/webapp/`

| Method | Route | Purpose |
|---|---|---|
| GET | `/scans` | List scans |
| POST | `/scans` | Start a scan |
| GET | `/scans/:id` | Scan detail |
| GET | `/scans/:id/stats` | Scan statistics |
| GET | `/scans/:id/findings` | Scan findings |
| DELETE | `/scans/:id` | Cancel a scan |
| GET | `/checks` | Available scan checks |
| GET | `/config/defaults` | Default scanner configuration |

### Post-Exploit — `/api/v1/post-exploit/`

| Method | Route | Purpose |
|---|---|---|
| GET | `/hashes` | List hash records |
| POST | `/hashes` | Ingest hash output |
| PATCH | `/hashes/:id/cracked` | Update cracked-hash state |
| GET | `/kerberoast/targets` | Kerberoastable targets |
| POST | `/kerberoast/queue` | Queue Kerberoast work through C2 |
| GET | `/pivot/surface` | Query pivot/attack surface |
| POST | `/pivot/paths` | Compute AD attack paths |
| GET | `/pivot/paths` | Retrieve computed paths |
| GET | `/pivot/kerberoastable` | Query Kerberoastable accounts |
| GET | `/pivot/asreproastable` | Query AS-REP-roastable accounts |
| POST | `/dump` | Queue a secrets-dump workflow through C2 |
| POST | `/dump/parse` | Parse dump material |
| GET | `/stats` | Module statistics |
| GET | `/commands` | Module command capability metadata |

## Module execution boundaries

The backend modules are implemented independently but share the same engagement, target, evidence, finding, session, audit, and event infrastructure.

All seven module workspaces now have real operator control panels wired to existing backend routes:

- **Recon:** target selection, private-target policy, start, and cancellation.
- **WebApp:** target selection, private-target policy, start, and cancellation.
- **C2:** implant provisioning, implant selection, supported task queueing, result retrieval, and implant termination.
- **Delivery:** campaign creation, target import, campaign state transitions, statistics, and SMTP-profile management.
- **Evil Proxy:** phishlet/lure creation and disablement, victim-session inspection, and harvested-session export.
- **MITM:** interception-session creation/stop, DNS service control, DNS rule creation, and traffic/credential retrieval.
- **Post-Exploit:** hash ingestion, Kerberoast task queueing, dump-task queueing, AD attack-path computation, and path retrieval.

These panels are control surfaces over capabilities that already existed in the backend. No new execution primitive was added merely to populate the GUI. Existing engagement authorization remains enforced by the API.

## Known architectural limits

HECATE is currently a single-operator, single-process platform. It is not intended to provide multi-user IAM.

Current documented limits include:

- C2 replay handling follows the existing encrypted protocol model rather than a separate monotonic sequence/nonce protocol.
- Application-level append-only controls do not protect against an administrator with direct authority over the SQLite database.
- MITM DNS spoofing state is process-global even though its API controls are engagement-authorized.
- Browser-authenticated WebSocket connections are closed when their underlying eight-hour browser session expires.
- The event bridge currently integrates the shared event bus through the existing singleton architecture.

These are explicit design boundaries rather than claims of capabilities the software does not provide.

## Architecture

```
hecate/
├── cli/                        Entry point + start/keygen commands
├── ui/                         React operator console + Vite build
├── api/
│   ├── server.js               Express + HTTP + WebSocket server
│   ├── router.js               Core + module API registration
│   ├── middleware/             Auth, rate limit, logging, errors
│   ├── routes/                 Core CRUD and assessment routes
│   └── websocket/              WebSocket server + event bridge
├── core/
│   ├── db/                     SQLite initialization, schema, models, queries
│   ├── crypto/                 AES-256-GCM key management
│   ├── store/                  Encrypted credential/session stores
│   ├── graph/                  Target and Active Directory graphs
│   ├── audit/                  Append-only SHA-256 audit chain
│   ├── events/                 Shared event bus
│   ├── assessment/             Assessment planning/state
│   └── network/                Shared network profiles
└── modules/
    ├── recon/                  Web reconnaissance
    ├── evil-proxy/             Adversary-in-the-middle proxy workflows
    ├── c2/                     Command-and-control workflows
    ├── delivery/               Campaign delivery/tracking
    ├── mitm/                   Network interception
    ├── webapp/                 Web application assessment
    └── post-exploit/           Credential/AD post-exploitation workflows
```

## Testing and regression coverage

Run the full regression suite:

```bash
npm test
```

Run the core suite:

```bash
npm run test:core
```

Run the API suite:

```bash
npm run test:api
```

Run all seven module suites:

```bash
npm run test:modules
```

Run an individual module suite:

```bash
node --experimental-sqlite --test modules/recon/recon.test.js
```

The repository also provides:

```bash
npm run check:encoding
npm run build:ui
```

The regression workflow covers core startup/migration/authorization behavior, API lifecycle/authentication, browser sessions, WebSocket policy, all seven module suites, the UI capability surface, and encoding checks. Phase 1 foundation controls also have dedicated regression coverage for SQLite test isolation, event-to-audit projection, C2 wire-payload preservation, and MITM DNS runtime ownership. Run `npm run test:phase1` for that focused baseline. Phase 2 adds `npm run test:phase2`, which verifies engagement → target → session → evidence → finding lineage, audit projection, hash-chain integrity, and database-restart recovery. GitHub Actions runs the regression workflow on pushes and pull requests targeting `main`.

The repository contains a separate Juice Shop end-to-end test command:

```bash
npm run test:e2e:juice-shop
```

That test is not part of the default `npm test` regression command.

## Development note

The README documents implemented repository state, not planned future features. The module capability map and GUI control panels are intended to reflect the current backend/API contract rather than speculative functionality.

Runtime credentials, tokens, keys, captured evidence, and client data are intentionally excluded from this documentation.
