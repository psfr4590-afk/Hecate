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
const fs          = require('fs');
const crypto      = require('crypto');
const { Command } = require('commander');

const DEFAULT_OUT = path.resolve(process.env.HOME ?? '.', '.hecate', 'operator.key');

const cmd = new Command('keygen');

cmd
  .description('Generate a new AES-256 operator key')
  .option('-o, --out <path>', 'Output path for the key file', DEFAULT_OUT)
  .option('--force',          'Overwrite an existing key file')
  .action((opts) => {
    const outPath = path.resolve(opts.out);
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
    fs.writeFileSync(outPath, key);

    // Restrict permissions — owner read-only (Unix)
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
