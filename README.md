# HECATE

HECATE is a local-first, single-operator security assessment and red-team platform. It combines a local SQLite-backed control plane, authenticated REST/WebSocket APIs, an operator console, assessment modules, evidence/findings management, and an append-only audit chain.

The application is designed to run as one local HECATE process for one authenticated operator at a time. The browser console and API are served by that same local process. Runtime engagement data stays outside source control.

## Current application state

HECATE currently contains seven registered capability modules:

- Reconnaissance
- Evil Proxy
- C2
- Delivery
- MITM
- Web Application Assessment
- Post-Exploit

The React operator console currently exposes active launcher controls for **Reconnaissance** and **Web Application Assessment**. The other registered modules are visible from the Dashboard's module surface and open their module workspace, but their dedicated UI launch controls are not exposed yet. Their API surfaces remain available to authenticated programmatic clients.

The main console workspaces are:

- Dashboard
- Engagements
- Targets
- Findings
- Evidence
- Sessions
- Audit Log

The console starts in preview mode when it cannot authenticate to a local node. Preview data is synthetic UI data. It is not engagement data.

## Requirements

- Node.js **22 or newer**
- Node's SQLite support via `--experimental-sqlite`
- npm
- No native build toolchain is required by the application itself

The package scripts already supply `--experimental-sqlite` for the normal application start and regression commands.

## Install and start

Install dependencies:

```bash
npm install
```

Generate the operator encryption key once:

```node
node cli/index.js keygen --out ~/.hecate/operator.key
```

Set the API token and key path, then start HECATE:

```bash
HECATE_API_TOKEN=<your-token> \
HECATE_KEY_PATH=~/.hecate/operator.key \
npm start
```

The default local node is:

```
http://127.0.0.1:7331/
```

The API base is:

```
http://127.0.0.1:7331/api/v1/
```

The default bind address is loopback. HECATE is not intended to be an anonymously exposed Internet service.

## Operator console

The React console is built into `ui/dist` and served by the same HECATE process.

Build it with:

```bash
npm run build:ui
npm start
```

Open:

```
http://127.0.0.1:7331/
```

The local node issues an HttpOnly, SameSite browser session cookie for the console. The API token is not copied into browser storage.

For UI development with Vite hot reload:

```bash
# Terminal 1
npm start

# Terminal 2
npm run dev:ui
```

The Vite development server uses `127.0.0.1:4173` and proxies API traffic to the local HECATE node.

### Console behavior

The Dashboard provides:

- current engagement selection;
- target, active-session, finding, and evidence counts;
- finding severity counts;
- audit-chain verification;
- recent audit activity;
- registered module status;
- navigation into module workspaces.

Engagements can be created from the console. Targets, findings, evidence, sessions, and audit records can be viewed within the active engagement.

The module workspace currently provides real operator launch controls for:

- **Recon:** choose a target, optionally allow private/local targets, start a job, and cancel a running job.
- **Web Application Assessment:** choose a target, optionally allow private/local targets, start a scan, and cancel a running scan.

The console deliberately does not pretend that the remaining modules have UI controls they do not currently have. They are registered and API-backed, but their operator workflows remain outside the present dashboard surface.

## Authentication

The authenticated REST API is mounted at `/api/v1`.

Programmatic clients may authenticate with either:

```
Authorization: Bearer <HECATE_API_TOKEN>
```

or:

```
X-Hecate-Token: <HECATE_API_TOKEN>
```

The browser console authenticates through the process-local HttpOnly session cookie issued by the same HECATE node.

`/health` is intentionally unauthenticated.

The C2 beacon endpoint is separate from the operator API authentication path:

```
POST /c2/beacon
```

C2 beacons use their per-implant cryptographic protocol rather than the operator API token.

WebSocket authentication does not accept tokens in query strings. Authentication is header-based, and engagement-sensitive events are fail-closed when engagement identity is missing.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `HECATE_API_TOKEN` | For token clients | Operator API bearer token |
| `HECATE_KEY_PATH` | Yes for normal startup | Path to the AES-256 operator key |
| `HECATE_PORT` | No | API port, default `7331` |
| `HECATE_HOST` | No | Bind address, default `127.0.0.1` |
| `HECATE_PHISHLET_DIR` | No | Directory for Evil Proxy phishlet JSON files |

The process still starts without `HECATE_API_TOKEN`, but token-authenticated API clients are rejected. The local browser session remains the console authentication mechanism.

## CLI

The CLI currently provides `start` and `keygen`.

```
node cli/index.js start [options]

  -p, --port <port>    Port (default: 7331)
  -H, --host <host>    Bind address (default: 127.0.0.1)
  -d, --db <path>      SQLite database path (default: ./data/hecate.db)
  -k, --key <path>     AES-256 key file path
  --dry-run             Delivery module: do not send email
  --log-level <level>   Log level (default: info)

node cli/index.js keygen [options]

  -o, --out <path>     Key output path (default: ~/.hecate/operator.key)
  --force               Overwrite an existing key
```

Startup initializes the SQLite database, loads the encryption key, initializes all seven modules, registers their API routers, then starts HTTP and WebSocket transports.

## Assessment model

HECATE separates assessment scope and durable assessment records from capability modules.

```
Engagement
  ├── Scope
  ├── Targets
  ├── Target relationships / graphs
  ├── Module execution
  ├── Sessions
  ├── Evidence
  ├── Findings
  ├── Retest / validation data
  └── Audit trail
```

Targets are generic assessment assets. A target can represent an application, API, host, service, identity boundary, wallet/custody component, smart contract, RPC endpoint, or another authorized assessment asset.

Target priority is derived from data sensitivity and business criticality. It is a planning signal, not a vulnerability score.

Shared network-profile support provides assessment traffic controls such as mode, concurrency, pacing, bounded retries/backoff, connection reuse, and explicit proxy/tunnel/DNS metadata.

## Core components

```
hecate/
├── cli/
│   ├── index.js
│   └── commands/              start + keygen
├── ui/
│   ├── src/                   React operator console
│   └── dist/                  Built console, when generated
├── api/
│   ├── server.js              Express + HTTP + WebSocket server
│   ├── router.js              Core/module route registry
│   ├── middleware/            auth, rate limiting, logging, errors
│   ├── routes/                Core resource APIs
│   └── websocket/             WebSocket server, policy, event bridge
├── core/
│   ├── assessment/            Assessment planning
│   ├── auth/                  Operator identity and authorization
│   ├── audit/                 Append-only audit/hash chain
│   ├── crypto/                AES-256 key management
│   ├── db/                    SQLite database, models, queries
│   ├── events/                Internal event bus
│   ├── graph/                 Target and AD graph support
│   ├── network/               Traffic profiles
│   └── store/                 Credential/session stores
├── modules/
│   ├── recon/
│   ├── evil-proxy/
│   ├── c2/
│   ├── delivery/
│   ├── mitm/
│   ├── webapp/
│   └── post-exploit/
└── scripts/
    ├── check-encoding.js
    └── e2e-juice-shop.js
```

## Module capabilities

### Recon

The Recon module provides scoped web reconnaissance with a crawler/frontier/fetcher/parser pipeline, result storage, secret analysis, technology fingerprinting, stealth profiles, rate limiting, and SSRF target validation.

Primary API surface:

```
POST   /api/v1/recon/jobs
GET    /api/v1/recon/jobs
GET    /api/v1/recon/jobs/:id
GET    /api/v1/recon/jobs/:id/pages
GET    /api/v1/recon/jobs/:id/secrets
DELETE /api/v1/recon/jobs/:id
```

### Web Application Assessment

The WebApp module provides scanner execution and a check library with bounded response handling and SSRF validation.

Primary API surface:

```
GET    /api/v1/webapp/scans
POST   /api/v1/webapp/scans
GET    /api/v1/webapp/scans/:id
GET    /api/v1/webapp/scans/:id/stats
GET    /api/v1/webapp/scans/:id/findings
DELETE /api/v1/webapp/scans/:id
GET    /api/v1/webapp/checks
GET    /api/v1/webapp/config/defaults
```

### Evil Proxy

Provides phishlet/lure and victim-session handling with scoped session lookup and phishlet path validation.

### C2

Provides implant registration, encrypted beacon handling, task queuing, task results, and durable SQLite-backed task state.

The operator API is mounted below `/api/v1/c2/`; the beacon transport is `POST /c2/beacon`.

### Delivery

Provides campaign management, target enrollment, campaign state handling, and tracking endpoints. Queued delivery work is persisted in SQLite so the database is authoritative across process restarts.

### MITM

Provides scoped MITM sessions, traffic/exchange storage, credential observation, DNS spoof rules, DNS lifecycle controls, and interception configuration.

### Post-Exploit

Provides hash ingestion/parsing, Kerberoast task queuing through C2, AD pivot-path planning, secrets-dump task queuing, and result parsing.

## Core API resources

All of the following are under `/api/v1/` and require authentication.

| Resource | Main operations |
|---|---|
| Engagements | list, create, read, patch, delete |
| Targets | search, list/create by engagement, read, patch, delete |
| Credentials | list/store by engagement, safe read, cleartext retrieval, delete |
| Sessions | list/create by engagement, heartbeat, status, metadata, delete |
| Evidence | list/create by engagement, read, delete |
| Findings | list/create by engagement, read, delete |
| Target graph | read D3 graph, paths, node/edge operations |
| AD graph | read/ingest/query graph data |
| Audit | engagement-scoped reads and global integrity verification |
| Status | local platform/module status |

## Runtime-data isolation

Real engagement data is not part of the source tree.

The repository ignores runtime databases, SQLite WAL/SHM files, evidence, logs, coverage, generated UI output, operator keys, environment files, certificates, and private keys.

Use synthetic fixtures for repository tests. Never commit real target credentials, tokens, session material, wallet seeds/private keys, captured evidence, or client runtime databases.

## Durability and security boundaries

The hardened baseline includes:

- one immutable process operator principal;
- explicit single-operator authorization;
- engagement lifecycle integrity enforcement;
- durable C2 task queues;
- durable Delivery queues and recovery;
- startup reconciliation for interrupted Recon jobs and WebApp scans;
- engagement-scoped audit reads;
- append-only SHA-256 audit-chain verification;
- authenticated `/api/v1` mounting;
- header-only WebSocket authentication;
- WebSocket inbound payload limits;
- fail-closed engagement-sensitive WebSocket event policy;
- SSRF/egress controls;
- bounded WebApp response handling;
- Evil Proxy phishlet path traversal defense;
- MITM IPv4 validation.

The hardening work did not change the existing secret formats or cryptographic secret-handling design.

Two known architectural boundaries remain:

1. C2 replay protection is still based on the existing ciphertext replay model rather than a new monotonic sequence/nonce protocol.
2. Application/database append-only controls do not protect against an administrator who has direct authority over the SQLite database file/schema.

No active attack or exploitation validation is claimed by the static hardening reports.

## Testing

Install dependencies first:

```bash
npm install
```

Run the complete repository regression contract:

```bash
npm test
```

Useful focused suites:

```bash
npm run test:core
npm run test:api
npm run test:recon
npm run test:evil-proxy
npm run test:c2
npm run test:delivery
npm run test:mitm
npm run test:webapp
npm run test:post-exploit
```

Run the disposable Juice Shop end-to-end test separately:

```bash
npm run test:e2e:juice-shop
```

The E2E test requires Docker and uses an isolated local HECATE runtime. It is intentionally not part of `npm test`.

The repository also includes syntax/encoding checks through `scripts/check-encoding.js`.

## Historical remediation records

The repository retains the Phase 4, Phase 5, and full-program remediation reports as historical engineering records:

- `Hecate-phase4-remediation.md`
- `Hecate-phase5-remediation.md`
- `Hecate-full-audit-remediation.md`

Those reports describe the changes made during their respective remediation passes. The current application behavior and operator-console state are documented here so the README remains the source of truth for how the application currently presents and operates.

## Operational model

HECATE is intentionally a local, single-operator system.

The architecture is not a multi-tenant SaaS service, and it does not provide a separate enterprise IAM layer. Engagement authorization is used to prevent cross-engagement access within the local operator boundary.

Use HECATE only against systems and assets for which the operator has explicit authorization.
