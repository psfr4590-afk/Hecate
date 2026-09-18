# HECATE

Unified operator-grade red team platform. Local-first, zero backend costs, full operator control.

## Requirements

- Node.js **≥ 22.0.0** (uses `node:sqlite` — the `--experimental-sqlite` flag is required for core/API commands)
- No native build dependencies

## First-run setup

```bash
# 1. Install dependencies
npm install

# 2. Generate an AES-256 operator key (do this once)
node cli/index.js keygen --out ~/.hecate/operator.key

# 3. Start the platform
HECATE_API_TOKEN=<your-token> \
HECATE_KEY_PATH=~/.hecate/operator.key \
node --experimental-sqlite cli/index.js start
```

Platform is now listening at `http://127.0.0.1:7331`.

## Assessment architecture

HECATE separates assessment planning from individual capability modules.

```
Assessment
  ├── Scope / engagement context
  ├── Target inventory
  ├── Target classification
  ├── Attack-surface discovery
  ├── Network / traffic profile
  ├── Applicable test cases
  ├── Execution / observations
  ├── Evidence
  ├── Findings
  ├── Retest / validation
  └── Audit trail
```

Targets are generic assessment assets rather than module-specific objects. A target may represent an application, API, host, service, identity boundary, wallet/custody component, smart contract, RPC endpoint, or other asset.

Target priority is derived from data sensitivity and business criticality. The combined value is a planning signal, not a vulnerability score.

Shared network profiles provide consistent assessment traffic behavior across modules, including assessment mode, concurrency, pacing, bounded retries/backoff, connection reuse, and explicit proxy/tunnel/DNS route metadata.

## Runtime-data isolation

Real engagement data stays outside the Git repository. Runtime databases, WAL/SHM files, evidence, logs, coverage, generated UI output, operator keys, environment files, certificates, and private keys are ignored.

Use synthetic fixtures for repository tests. Never commit real target credentials, tokens, session material, wallet seeds/private keys, captured evidence, or client runtime databases.

## Operator console

The React operator console is built once and served by the same local HECATE process.

```bash
npm install
npm run build:ui
npm start
```

Open `http://127.0.0.1:7331/`. The local node issues a process-scoped browser session cookie; the API token is not copied into browser storage.

For UI development with hot reload:

```bash
# Terminal 1
npm start

# Terminal 2
npm run dev:ui
```

The Vite development server listens on `127.0.0.1:4173` and proxies API requests to the local HECATE node.


## Environment variables

| Variable             | Required | Description                              |
|----------------------|----------|------------------------------------------|
| `HECATE_API_TOKEN`   | Yes      | Bearer token for all API requests        |
| `HECATE_KEY_PATH`    | Yes      | Path to AES-256 key file (32 bytes)      |
| `HECATE_PORT`        | No       | API port (default: `7331`)               |
| `HECATE_HOST`        | No       | Bind address (default: `127.0.0.1`)      |
| `HECATE_PHISHLET_DIR`| No       | Directory for custom phishlet JSON files |

## CLI options

```
node --experimental-sqlite cli/index.js start [options]

  -p, --port <port>    Port (default: 7331)
  -H, --host <host>    Bind address (default: 127.0.0.1)
  -d, --db <path>      SQLite database path (default: ./data/hecate.db)
  -k, --key <path>     Key file path (overrides HECATE_KEY_PATH)
  --dry-run            Delivery module: queue sends but do not actually send email

node cli/index.js keygen [options]

  -o, --out <path>     Key output path (default: ~/.hecate/operator.key)
  --force              Overwrite existing key
```

## API authentication

All `/api/v1/*` requests require:

```
Authorization: Bearer <HECATE_API_TOKEN>
# or
X-Hecate-Token: <HECATE_API_TOKEN>
```

The C2 beacon endpoint (`POST /c2/beacon`) uses per-implant AES-256 keys — no operator token required.

## End-to-end smoke test

The repository also includes a disposable end-to-end smoke test using OWASP Juice Shop. It starts Juice Shop in Docker, starts an isolated HECATE runtime with a temporary SQLite database and operator key, creates an engagement and target, runs Recon and the Web Application scanner, verifies persisted results, verifies the audit chain, and removes all temporary resources.

Docker must be running locally.

```bash
npm run test:e2e:juice-shop
```

The E2E test is intentionally separate from `npm test` because it requires Docker and performs real HTTP requests against a disposable local application.

## Running tests

```bash
# Full regression suite
npm test

# Module-only suite
node --experimental-sqlite --test \
  modules/recon/recon.test.js \
  modules/evil-proxy/evil-proxy.test.js \
  modules/c2/c2.test.js \
  modules/delivery/delivery.test.js \
  modules/mitm/mitm.test.js \
  modules/webapp/webapp.test.js \
  modules/post-exploit/post-exploit.test.js

# Individual module
node --experimental-sqlite --test modules/recon/recon.test.js
```

## Architecture

```
hecate/
├── cli/                        Entry point + commands (start, keygen)
├── ui/                         React operator console + Vite build
├── api/
│   ├── server.js               Express + HTTP + WebSocket server
│   ├── router.js               Mounts core + module routes at /api/v1/
│   ├── middleware/             auth, rate-limit, logger, error-handler
│   ├── routes/                 Core CRUD (engagements, targets, evidence …)
│   └── websocket/              ws-server + event-bridge (real-time events)
├── core/
│   ├── db/
│   │   ├── database.js         SQLite init + base schema (WAL mode)
│   │   ├── models/             engagement, target, evidence, finding
│   │   └── queries/            search helpers
│   ├── crypto/key-manager.js   AES-256-GCM encrypt/decrypt
│   ├── store/
│   │   ├── credential-store.js Credentials encrypted at rest
│   │   └── session-store.js    Operator module sessions
│   ├── graph/
│   │   ├── target-graph.js     Directed target relationship graph
│   │   └── ad-graph.js         Active Directory graph (BloodHound ingest)
│   ├── audit/audit-log.js      Append-only SHA-256 hash chain
│   └── events/event-bus.js     EventEmitter singleton (WS bridge)
└── modules/
    ├── recon/                  Web crawler (RookCrawler evolved)
    ├── evil-proxy/             Adversary-in-the-middle proxy (Evilginx3-model)
    ├── c2/                     Command & control (Sliver-model)
    ├── delivery/               Phishing campaign manager (GoPhish-model)
    ├── mitm/                   Network interception (Bettercap-model)
    ├── webapp/                 Web app scanner (FFUF/Nuclei-model)
    └── post-exploit/           Credential extraction + lateral movement (Impacket-model)
```

## Module API reference

### Core resources — `/api/v1/`

| Route                                     | Description                      |
|-------------------------------------------|----------------------------------|
| `GET/POST /engagements`                   | Engagement CRUD                  |
| `GET/POST/PATCH/DELETE /targets`          | Target CRUD + search             |
| `GET/POST /credentials`                   | Credential store (encrypted)     |
| `GET/POST /sessions`                      | Module session tracking          |
| `GET/POST /evidence`                      | Evidence records                 |
| `GET/POST /findings`                      | Vulnerability findings           |
| `GET /graph/targets/:eid`                 | Target graph (D3)                |
| `POST /graph/ad/ingest`                   | Ingest BloodHound JSON           |
| `GET /audit`, `GET /audit/verify`         | Audit log + chain verification   |
| `GET /api/v1/status`                      | Platform status                  |

### Recon — `/api/v1/recon/`

| Route                          | Description                      |
|--------------------------------|----------------------------------|
| `POST /recon/jobs`             | Start a crawl job                |
| `GET /recon/jobs/:id/pages`    | Crawled pages                    |
| `GET /recon/jobs/:id/secrets`  | Discovered secrets               |
| `DELETE /recon/jobs/:id`       | Cancel job                       |

### Evil Proxy — `/api/v1/evil-proxy/`

| Route                                        | Description                  |
|----------------------------------------------|------------------------------|
| `POST /evil-proxy/lures`                     | Create a phishing lure       |
| `GET /evil-proxy/sessions`                   | Victim sessions              |
| `GET /evil-proxy/sessions/:l/:v/export`      | Export harvested session     |

### C2 — `/api/v1/c2/` + `POST /c2/beacon`

| Route                               | Description                         |
|-------------------------------------|-------------------------------------|
| `POST /c2/implants`                 | Register implant (returns key once) |
| `POST /c2/implants/:id/tasks`       | Queue task (shell/upload/die/…)     |
| `GET /c2/implants/:id/results`      | Task results                        |
| `POST /c2/beacon`                   | Implant beacon (no auth token)      |

### Delivery — `/api/v1/delivery/`

| Route                               | Description                  |
|-------------------------------------|------------------------------|
| `POST /delivery/campaigns`          | Create campaign              |
| `POST /delivery/campaigns/:id/targets` | Add targets (CSV or JSON) |
| `POST /delivery/campaigns/:id/state`| Start/pause/complete         |
| `GET /delivery/track/open/:tid`     | Open-tracking pixel          |
| `GET /delivery/track/click/:tid/:lid` | Click redirect             |

### MITM — `/api/v1/mitm/`

| Route                       | Description               |
|-----------------------------|---------------------------|
| `POST /mitm/dns/rules`      | Add DNS spoof rule        |
| `POST /mitm/dns/start`      | Start DNS server (port 53)|
| `GET /mitm/exchanges`       | Intercepted traffic log   |
| `GET /mitm/credentials`     | Sniffed credentials       |

### Webapp — `/api/v1/webapp/`

| Route                          | Description               |
|--------------------------------|---------------------------|
| `POST /webapp/scans`           | Start a scan              |
| `GET /webapp/scans/:id/findings` | Vulnerability findings  |

### Post-Exploit — `/api/v1/post-exploit/`

| Route                           | Description                          |
|---------------------------------|--------------------------------------|
| `POST /post-exploit/hashes`     | Ingest + parse hash output           |
| `POST /post-exploit/kerberoast/queue` | Queue Kerberoast via C2       |
| `POST /post-exploit/pivot/paths` | Compute AD attack paths             |
| `POST /post-exploit/dump`       | Queue secrets dump via C2 implant   |

## Test coverage

| Suite            | Tests | Status |
|------------------|-------|--------|
| Core             |  49   | ✅     |
| Recon            |  58   | ✅     |
| Evil Proxy       |  60   | ✅     |
| C2               |  49   | ✅     |
| Delivery         |  44   | ✅     |
| MITM             |  29   | ✅     |
| Webapp           |  30   | ✅     |
| Post-Exploit     |  25   | ✅     |
| **Total**        | **357** | **✅** |
