# HECATE fresh-machine installation

This is the supported first-run path for a clean machine. It deliberately keeps operator credentials out of the repository.

## 1. Install Node.js

Install Node.js 22 or newer.

Verify:

```text
node --version
npm --version
```

HECATE uses the built-in `node:sqlite` API. The repository currently runs it with Node's `--experimental-sqlite` runtime flag, so the same flag is required for the CLI and test commands.

Verify the SQLite runtime before doing anything else:

```bash
node --experimental-sqlite -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('SELECT 1'); db.close(); console.log('node:sqlite: OK')"
```

## 2. Clone the repository

```bash
git clone https://github.com/psfr4590-afk/Hecate.git
cd Hecate
```

Do not create a second nested `Hecate` directory inside the clone.

## 3. Install dependencies

```bash
npm install
```

`package.json` is the dependency source of truth. Do not install HECATE's runtime dependencies globally.

## 4. Generate the operator encryption key

Run:

```bash
node cli/index.js keygen
```

The command creates the platform-local key at the user's home directory under `.hecate/operator.key`.

A custom path is also supported:

```bash
node cli/index.js keygen --out ~/.hecate/operator.key
```

The CLI expands `~` on both Unix-like systems and Windows.

The generated key is 32 bytes and must not be committed to Git.

## 5. Provide the API token

HECATE requires `HECATE_API_TOKEN` at startup. Keep it in the shell environment or another secret-management mechanism outside the repository.

PowerShell:

```powershell
$env:HECATE_API_TOKEN = 'replace-with-a-long-random-token'
$env:HECATE_KEY_PATH = "$HOME\.hecate\operator.key"
```

Bash/Zsh:

```bash
export HECATE_API_TOKEN='replace-with-a-long-random-token'
export HECATE_KEY_PATH="$HOME/.hecate/operator.key"
```

Do not put a real token in `package.json`, source files, README files, or committed `.env` files.

## 6. Start HECATE

From the repository root:

```bash
npm start
```

The default bind is `127.0.0.1:7331` and the default database is `./data/hecate.db`.

A custom database, host, port, or key can be supplied explicitly:

```bash
node --experimental-sqlite cli/index.js start --host 127.0.0.1 --port 7331 --db ./data/hecate.db --key ~/.hecate/operator.key
```

PowerShell accepts the same CLI options:

```powershell
node --experimental-sqlite cli/index.js start --host 127.0.0.1 --port 7331 --db .\data\hecate.db --key "$HOME\.hecate\operator.key"
```

## 7. Verify the process

Health is intentionally unauthenticated:

```text
http://127.0.0.1:7331/health
```

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:7331/health
```

Bash:

```bash
curl http://127.0.0.1:7331/health
```

The response should contain `ok: true`.

API routes under `/api/v1/` require the API token.

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:7331/api/v1/status -Headers @{ Authorization = "Bearer $env:HECATE_API_TOKEN" }
```

Bash:

```bash
curl -H "Authorization: Bearer $HECATE_API_TOKEN" http://127.0.0.1:7331/api/v1/status
```

## 8. Run the regression suite

From the repository root:

```bash
npm test
```

For the API suite specifically:

```bash
npm run test:api
```

The test runner may print structured JSON error logs from tests that intentionally exercise error handling. Those log lines are not themselves test failures; use the final Node test summary as the result.

## 9. Shutdown

Use `Ctrl+C` in the terminal running HECATE.

Shutdown order is intentional: event bridge → WebSocket clients/server → HTTP server → module shutdown → encryption key clear → SQLite close.

The API and WebSocket layers are designed so test and application teardown can await transport shutdown instead of leaving upgraded sockets behind.

## Troubleshooting

### `node:sqlite` cannot be loaded

Check the Node version and run the SQLite verification command from step 1. HECATE requires a Node release that provides `node:sqlite`.

### `HECATE_API_TOKEN is required`

Set the environment variable in the same terminal session that starts HECATE.

### `Key file not found`

Generate a key with `node cli/index.js keygen`, then set `HECATE_KEY_PATH` or pass `--key` explicitly.

### Port already in use

Choose another port:

```text
node --experimental-sqlite cli/index.js start --port 7332
```

### Tests hang during teardown

Do not work around a hanging test with `--test-force-exit`. HECATE's lifecycle should close its own resources. Investigate the reported open transport, timer, database, or module resource instead.
