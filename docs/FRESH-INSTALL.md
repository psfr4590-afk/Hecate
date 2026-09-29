# HECATE fresh-machine installation

This is the supported clean-machine path for the current HECATE release line. Runtime credentials and engagement data stay outside the repository.

## Requirements

- Node.js **22.13.0 or newer**
- Git
- A local filesystem where HECATE can create its runtime state and database
- Docker only for the optional Juice Shop end-to-end test

HECATE uses Node's built-in `node:sqlite` support and starts with the repository's `--experimental-sqlite` flag for the supported Node runtime line.

Verify the runtime:

```bash
node --version
npm --version
node --experimental-sqlite -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('SELECT 1'); db.close(); console.log('node:sqlite: OK')"
```

## Clean clone

```bash
git clone https://github.com/psfr4590-afk/Hecate.git
cd Hecate
```

Do not create a second nested HECATE directory inside the clone.

## Install

```bash
npm install
```

The repository's `package.json` is the dependency source of truth. The post-install step builds the React operator console.

For a CI or release verification environment, use:

```bash
npm ci
```

## First run

A clean installation does **not** require manually generating a key or API token.

```bash
npm start
```

On first startup HECATE creates local operator state under:

```text
~/.hecate/
```

The state includes:

- `operator.key`: 32-byte AES-256 operator key
- `operator.token`: locally generated API token
- `.initialized`: first-run completion marker

Existing `HECATE_KEY_PATH` and `HECATE_API_TOKEN` values are respected and are not overwritten.

The default runtime is:

```text
HTTP:     127.0.0.1:7331
Database: ./data/hecate.db
Console:  http://127.0.0.1:7331/
```

The operator console uses the local browser-session mechanism. The API token does not need to be copied into browser storage.

## Explicit credentials

For automation or controlled deployments, credentials may be supplied explicitly.

Bash/Zsh:

```bash
export HECATE_API_TOKEN='replace-with-a-long-random-token'
export HECATE_KEY_PATH="$HOME/.hecate/operator.key"
npm start
```

PowerShell:

```powershell
$env:HECATE_API_TOKEN = 'replace-with-a-long-random-token'
$env:HECATE_KEY_PATH = "$HOME\.hecate\operator.key"
npm start
```

Never commit real credentials, keys, tokens, client data, or engagement artifacts.

## Manual key generation

Manual key generation remains available:

```bash
npm run keygen
```

A custom path is supported:

```bash
node cli/index.js keygen --out ~/.hecate/operator.key
```

The CLI expands `~` on Unix-like systems and Windows. Generated keys are 32 bytes and are written with restrictive permissions where the platform supports them.

## Verification

Check the unauthenticated health endpoint:

```bash
curl http://127.0.0.1:7331/health
```

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:7331/health
```

The response should report `ok: true`.

Authenticated API verification:

```bash
curl -H "Authorization: Bearer $HECATE_API_TOKEN" http://127.0.0.1:7331/api/v1/status
```

If first-run bootstrap generated the token, it is stored at `~/.hecate/operator.token`.

## Regression verification

Full repository regression:

```bash
npm test
```

Focused suites:

```bash
npm run test:core
npm run test:api
npm run test:modules
```

Additional verification:

```bash
npm run check:encoding
npm run build:ui
npm run smoke:start
```

The Juice Shop end-to-end test is intentionally separate because it requires Docker and real local HTTP activity:

```bash
npm run test:e2e:juice-shop
```

## Shutdown

Use `Ctrl+C` or send SIGINT/SIGTERM to the HECATE process.

Shutdown is ordered so application producers/workers stop before transport and database resources are closed. WebSocket teardown is awaited before HTTP teardown.

Do not use forced test-process termination to hide lifecycle leaks. A hanging process is a defect to investigate, not a green check with a different font.

## Runtime isolation

The following must remain outside source control:

- operator keys
- API tokens
- SQLite databases and WAL/SHM files
- engagement data
- evidence and captured artifacts
- logs
- certificates/private keys
- local environment files

Use synthetic fixtures for tests.

## Troubleshooting

### `node:sqlite` cannot be loaded

Verify Node is 22.13.0 or newer and run the SQLite check from the Requirements section.

### Startup reports an invalid key

The operator key must be exactly 32 bytes. Remove only the invalid local key and restart so first-run bootstrap can recreate it, or provide a known-good key with `HECATE_KEY_PATH` or `--key`.

### Port already in use

Use another port:

```bash
node --experimental-sqlite cli/index.js start --port 7332
```

### The console does not appear

Run:

```bash
npm run build:ui
npm start
```

Then verify:

```text
http://127.0.0.1:7331/
```

### Tests hang

Investigate the remaining open resource. HECATE's own lifecycle should close WebSocket, HTTP, module, timer, worker, and database resources cleanly.
