/**
 * gopeak check — Update check logic
 *
 * Modes:
 *   gopeak check         Interactive: show update status
 *   gopeak check --bg    Background: refresh cache silently, exit
 *   gopeak check --quiet Print one-liner only if update available
 */

import {
  getLocalVersion,
  fetchLatestVersion,
  compareSemver,
  isCacheFresh,
  updateCacheTimestamp,
  writeNotifyFile,
  clearNotifyFile,
  ensureGopeakDir,
} from './utils.js';

export async function checkForUpdates(args: string[]): Promise<void> {
  const isBg = args.includes('--bg');
  const isQuiet = args.includes('--quiet');

  ensureGopeakDir();

  // Background mode: refresh cache and exit silently
  if (isBg) {
    await backgroundCheck();
    return;
  }

  // Interactive or quiet mode: always fetch fresh
  const currentVersion = getLocalVersion();
  const latestVersion = await fetchLatestVersion();

  if (!latestVersion) {
    if (!isQuiet) {
      console.log('⚠️  Could not reach npm registry. Check your network.');
    }
    return;
  }

  if (compareSemver(latestVersion, currentVersion) > 0) {
    if (isQuiet) {
      console.log(`🚀 GoPeak v${latestVersion} available! Run: npm update -g gopeak`);
    } else {
      printUpdateBox(currentVersion, latestVersion);
    }
  } else {
    if (!isQuiet) {
      console.log(`✅ GoPeak v${currentVersion} is up to date.`);
    }
  }
}

/** Background check: called by shell hook (once per day). */
async function backgroundCheck(): Promise<void> {
  // Skip if cache is fresh (< 24h)
  if (isCacheFresh()) {
    return;
  }

  const currentVersion = getLocalVersion();
  const latestVersion = await fetchLatestVersion();

  // Update timestamp regardless of result (avoid hammering on failure)
  updateCacheTimestamp();

  if (!latestVersion) return;

  if (compareSemver(latestVersion, currentVersion) > 0) {
    const msg = `🚀 GoPeak v${latestVersion} available! (current: v${currentVersion})\n   Run: npm update -g gopeak`;
    writeNotifyFile(msg);
  } else {
    // No update — clear stale notification if any
    clearNotifyFile();
  }
}

function printUpdateBox(current: string, latest: string): void {
  const line1 = `  🚀 GoPeak v${latest} available! (current: v${current})`;
  const line2 = `  npm update -g gopeak`;
  const line3 = `  https://github.com/HaD0Yun/godot-mcp/releases`;
  const maxLen = Math.max(line1.length, line2.length, line3.length) + 2;
  const pad = (s: string) => s + ' '.repeat(Math.max(0, maxLen - s.length));

  console.log('');
  console.log('╔' + '═'.repeat(maxLen) + '╗');
  console.log('║' + pad(line1) + '║');
  console.log('║' + ' '.repeat(maxLen) + '║');
  console.log('║' + pad(line2) + '║');
  console.log('║' + pad(line3) + '║');
  console.log('╚' + '═'.repeat(maxLen) + '╝');
  console.log('');
}
