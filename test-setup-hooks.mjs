import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const utils = await import('./build/cli/utils.js');
const { setupShellHooks, MARKER_START, MARKER_END } = await import('./build/cli/setup.js');

assert.equal(utils.supportsShellHooks('win32', ''), false, 'Windows must not install bash/zsh hooks');
assert.equal(utils.supportsShellHooks('linux', '/bin/bash'), true, 'bash on Unix-like systems should be supported');
assert.equal(utils.supportsShellHooks('linux', '/bin/zsh'), true, 'zsh on Unix-like systems should be supported');
assert.equal(utils.supportsShellHooks('linux', ''), false, 'unknown shells should not be auto-configured');

function makeHome(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gopeak-${label}-`));
}

function bashrcPath(homeDir) {
  return path.join(homeDir, '.bashrc');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertNoBashrc(homeDir, message) {
  assert.equal(fs.existsSync(bashrcPath(homeDir)), false, message);
}

function assertInstalled(homeDir, message) {
  const rcPath = bashrcPath(homeDir);
  assert.equal(fs.existsSync(rcPath), true, `${message}: expected ${rcPath} to exist`);
  const content = fs.readFileSync(rcPath, 'utf8');
  assert.match(content, new RegExp(escapeRegex(MARKER_START)));
  assert.match(content, new RegExp(escapeRegex(MARKER_END)));
}

const manualHome = makeHome('setup-manual');
const originalPlatform = process.platform;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalShell = process.env.SHELL;

try {
  process.env.HOME = manualHome;
  process.env.USERPROFILE = manualHome;
  process.env.SHELL = '/bin/bash';
  await setupShellHooks(['--silent']);
  assertInstalled(manualHome, 'manual setup should install bash hooks');
} finally {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
}

const windowsHome = makeHome('setup-windows');
try {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.HOME = windowsHome;
  process.env.USERPROFILE = windowsHome;
  delete process.env.SHELL;
  await setupShellHooks(['--silent']);
  assertNoBashrc(windowsHome, 'Windows silent setup should not create .bashrc');
} finally {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
}

const defaultInstallHome = makeHome('postinstall-default');
execFileSync(process.execPath, ['./scripts/postinstall.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: defaultInstallHome,
    USERPROFILE: defaultInstallHome,
    SHELL: '/bin/bash',
  },
  stdio: 'inherit',
});
assertNoBashrc(defaultInstallHome, 'postinstall must not install shell hooks without GOPEAK_SETUP_HOOKS opt-in');

const optInHome = makeHome('postinstall-opt-in');
execFileSync(process.execPath, ['./scripts/postinstall.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    GOPEAK_SETUP_HOOKS: '1',
    HOME: optInHome,
    USERPROFILE: optInHome,
    SHELL: '/bin/bash',
  },
  stdio: 'inherit',
});
assertInstalled(optInHome, 'postinstall should install hooks when GOPEAK_SETUP_HOOKS=1');

console.log('setup hook regression checks passed');
