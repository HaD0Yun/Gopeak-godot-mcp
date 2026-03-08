/**
 * GoPeak CLI Utilities
 * Shared helpers for version checking, caching, and shell detection.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { get as httpsGet } from 'https';
import { get as httpGet } from 'http';

const execAsync = promisify(exec);

/* ------------------------------------------------------------------ */
/*  Paths                                                              */
/* ------------------------------------------------------------------ */

const GOPEAK_DIR = join(homedir(), '.gopeak');
const LAST_CHECK_FILE = join(GOPEAK_DIR, 'last-check');
const NOTIFY_FILE = join(GOPEAK_DIR, 'notify');
const ONBOARDING_SHOWN_FILE = join(GOPEAK_DIR, 'onboarding-shown');
const STAR_PROMPTED_FILE = join(GOPEAK_DIR, 'star-prompted');

export { GOPEAK_DIR, LAST_CHECK_FILE, NOTIFY_FILE, ONBOARDING_SHOWN_FILE, STAR_PROMPTED_FILE };

export function ensureGopeakDir(): void {
  if (!existsSync(GOPEAK_DIR)) {
    mkdirSync(GOPEAK_DIR, { recursive: true });
  }
}

/* ------------------------------------------------------------------ */
/*  Version                                                            */
/* ------------------------------------------------------------------ */

export function getLocalVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Walk up from build/cli/utils.js → project root
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Fetch latest version from npm registry (no dependencies). */
export function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const url = 'https://registry.npmjs.org/gopeak/latest';
    const timeout = setTimeout(() => resolve(null), 5000);

    httpsGet(url, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const json = JSON.parse(data);
          resolve(json.version ?? null);
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => { clearTimeout(timeout); resolve(null); });
    }).on('error', () => { clearTimeout(timeout); resolve(null); });
  });
}

/** Compare two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/*  Cache                                                              */
/* ------------------------------------------------------------------ */

/** Check if the last update check was less than `maxAgeSeconds` ago. */
export function isCacheFresh(maxAgeSeconds = 86400): boolean {
  try {
    if (!existsSync(LAST_CHECK_FILE)) return false;
    const ts = parseInt(readFileSync(LAST_CHECK_FILE, 'utf-8').trim(), 10);
    return (Date.now() / 1000 - ts) < maxAgeSeconds;
  } catch {
    return false;
  }
}

export function updateCacheTimestamp(): void {
  ensureGopeakDir();
  writeFileSync(LAST_CHECK_FILE, String(Math.floor(Date.now() / 1000)));
}

export function writeNotifyFile(message: string): void {
  ensureGopeakDir();
  writeFileSync(NOTIFY_FILE, message);
}

export function clearNotifyFile(): void {
  try { if (existsSync(NOTIFY_FILE)) unlinkSync(NOTIFY_FILE); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/*  Shell detection                                                    */
/* ------------------------------------------------------------------ */

export function getShellRcFile(): string {
  const shell = process.env.SHELL ?? '';
  if (shell.includes('zsh')) return join(homedir(), '.zshrc');
  return join(homedir(), '.bashrc');
}

export function getShellName(): string {
  const shell = process.env.SHELL ?? '';
  if (shell.includes('zsh')) return 'zsh';
  return 'bash';
}

export function supportsShellHooks(platform = process.platform, shell = process.env.SHELL ?? ''): boolean {
  if (platform === 'win32') return false;
  return shell.includes('bash') || shell.includes('zsh');
}

/* ------------------------------------------------------------------ */
/*  Command helpers                                                    */
/* ------------------------------------------------------------------ */

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

export async function runCommand(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(cmd);
    return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? '').trim(),
      code: err.code ?? 1,
    };
  }
}
