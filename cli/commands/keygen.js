'use strict';

/**
 * HECATE — CLI: keygen
 * Generates a fresh AES-256 key file.
 * Run once before first `hecate start`.
 *
 * Usage:
 *   node cli/index.js keygen --out ~/.hecate/operator.key
 */

const path        = require('path');
const os          = require('os');
const fs          = require('fs');
const crypto      = require('crypto');
const { Command } = require('commander');

function expandPath(value) {
  const input = String(value);
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

const DEFAULT_OUT = path.join(os.homedir(), '.hecate', 'operator.key');

const cmd = new Command('keygen');

cmd
  .description('Generate a new AES-256 operator key')
  .option('-o, --out <path>', 'Output path for the key file', DEFAULT_OUT)
  .option('--force',          'Overwrite an existing key file')
  .action((opts) => {
    const outPath = path.resolve(expandPath(opts.out));
    const outDir  = path.dirname(outPath);

    if (fs.existsSync(outPath) && !opts.force) {
      process.stderr.write(
        `Key already exists at ${outPath}. Use --force to overwrite.\n`
      );
      process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });

    // AES-256 → 32 bytes
    const key = crypto.randomBytes(32);
    fs.writeFileSync(outPath, key, { mode: 0o400 });

    // Restrict permissions — owner read-only (Unix). Windows may ignore chmod.
    try { fs.chmodSync(outPath, 0o400); } catch { /* Windows — skip */ }

    process.stdout.write(JSON.stringify({
      ts:      new Date().toISOString(),
      event:   'keygen:complete',
      path:    outPath,
      bytes:   key.length,
      message: `Set HECATE_KEY_PATH=${outPath} or pass --key to hecate start`,
    }) + '\n');
  });

module.exports = cmd;
