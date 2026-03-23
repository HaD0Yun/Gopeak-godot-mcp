import { readFileSync } from 'fs';

export const DEBUG_MODE: boolean = process.env.DEBUG === 'true';
export const GODOT_DEBUG_MODE_DEFAULT: boolean = process.env.GODOT_DEBUG === 'true' || DEBUG_MODE;

export const SERVER_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
