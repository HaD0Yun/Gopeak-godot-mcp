#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const OPT_IN_VALUES = new Set(['1', 'true', 'yes', 'on']);
const shouldInstallHooks = OPT_IN_VALUES.has(String(process.env.GOPEAK_SETUP_HOOKS || '').trim().toLowerCase());

if (!shouldInstallHooks) {
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '..', 'build', 'cli.js');

if (!existsSync(cliPath)) {
  process.exit(0);
}

try {
  execFileSync(process.execPath, [cliPath, 'setup', '--silent'], {
    stdio: 'ignore',
    env: process.env,
  });
} catch {
  process.exit(0);
}
