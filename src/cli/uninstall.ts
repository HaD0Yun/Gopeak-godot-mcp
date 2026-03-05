/**
 * gopeak uninstall — Remove shell hooks from RC file
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { getShellRcFile } from './utils.js';
import { MARKER_START, MARKER_END } from './setup.js';

export async function uninstallHooks(): Promise<void> {
  const rcFile = getShellRcFile();

  if (!existsSync(rcFile)) {
    console.log(`ℹ️  ${rcFile} not found. Nothing to remove.`);
    return;
  }

  const content = readFileSync(rcFile, 'utf-8');

  if (!content.includes(MARKER_START)) {
    console.log('ℹ️  GoPeak shell hooks are not installed. Nothing to remove.');
    return;
  }

  const regex = new RegExp(
    `\\n?${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
    'g'
  );
  const cleaned = content.replace(regex, '');
  writeFileSync(rcFile, cleaned);

  console.log(`✅ GoPeak shell hooks removed from ${rcFile}`);
  console.log(`   Reload with: source ${rcFile}`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
