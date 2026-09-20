'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const vite = path.resolve(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [vite, 'build', '--config', 'ui/vite.config.js'], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
