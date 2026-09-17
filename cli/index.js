#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const pkg         = require('../package.json');

const program = new Command();
program
  .name('hecate')
  .description('Unified operator-grade red team platform')
  .version(pkg.version, '-v, --version');

program.addCommand(require('./commands/start'));
program.addCommand(require('./commands/keygen'));

program.parse(process.argv);
