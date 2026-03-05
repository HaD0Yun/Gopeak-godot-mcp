/**
 * gopeak setup — Install shell hooks into ~/.bashrc or ~/.zshrc
 *
 * Wraps AI CLI tools (claude, codex, gemini, opencode, omc, omx)
 * with a precheck function that displays cached GoPeak update notifications.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import {
  getShellRcFile,
  getShellName,
  getLocalVersion,
  ensureGopeakDir,
  ONBOARDING_SHOWN_FILE,
  STAR_PROMPTED_FILE,
} from './utils.js';

const MARKER_START = '# >>> GoPeak shell hooks >>>';
const MARKER_END = '# <<< GoPeak shell hooks <<<';

/** The shell hook block that gets appended to the RC file. */
function generateHookBlock(): string {
  // Target commands (excluding omx — handled separately)
  const targetList = 'claude codex gemini opencode omc';

  const lines: string[] = [
    MARKER_START,
    '# GoPeak update notifications for AI CLI tools',
    '# Installed by: gopeak setup | Remove with: gopeak uninstall',
    '',
    '__gopeak_precheck() {',
    '  local notify="$HOME/.gopeak/notify"',
    '  local star="$HOME/.gopeak/star-prompted"',
    '  # If notification exists or star not yet prompted → interactive prompt',
    '  if [ -f "$notify" ] || [ ! -f "$star" ]; then',
    '    command -v gopeak &>/dev/null && gopeak notify',
    '  fi',
    '  # Background refresh for next time',
    '  local ts="$HOME/.gopeak/last-check"',
    '  if [ -f "$ts" ]; then',
    '    local age=$(( $(date +%s) - $(cat "$ts") ))',
    '    [ "$age" -lt 86400 ] && return',
    '  fi',
    '  command -v gopeak &>/dev/null && gopeak check --bg &>/dev/null & disown &>/dev/null',
    '}',

    '',
    '# Wrap AI CLI tools: precheck \u2192 original command',
    `for __gopeak_cmd in ${targetList}; do`,
    '  if command -v "$__gopeak_cmd" &>/dev/null && ! declare -f "$__gopeak_cmd" &>/dev/null; then',
    '    eval "${__gopeak_cmd}() { __gopeak_precheck; command ${__gopeak_cmd} \\"\\$@\\"; }"',
    '  fi',
    'done',
    '',
    '# omx: preserve existing function (e.g. --no-alt-screen wrapper)',
    'if declare -f omx &>/dev/null; then',
    '  eval "__gopeak_orig_omx() $(declare -f omx | sed \'1d\')"',
    '  omx() { __gopeak_precheck; __gopeak_orig_omx "$@"; }',
    'elif command -v omx &>/dev/null; then',
    '  omx() { __gopeak_precheck; command omx "$@"; }',
    'fi',
    '',
    'unset __gopeak_cmd',
    MARKER_END,
  ];

  return lines.join('\n');
}

export async function setupShellHooks(): Promise<void> {
  const rcFile = getShellRcFile();
  const shellName = getShellName();

  // Check if RC file exists
  if (!existsSync(rcFile)) {
    console.log(`⚠️  ${rcFile} not found. Creating it.`);
    writeFileSync(rcFile, '');
  }

  const content = readFileSync(rcFile, 'utf-8');

  // Check if already installed
  if (content.includes(MARKER_START)) {
    // Replace existing block
    const cleaned = removeHookBlock(content);
    const hookBlock = generateHookBlock();
    writeFileSync(rcFile, cleaned + '\n' + hookBlock + '\n');
    console.log(`🔄 GoPeak shell hooks updated in ${rcFile}`);
  } else {
    // Append new block
    const hookBlock = generateHookBlock();
    appendFileSync(rcFile, '\n' + hookBlock + '\n');
    console.log(`✅ GoPeak shell hooks installed in ${rcFile}`);
  }

  console.log(`   Reload with: source ${rcFile}`);
  console.log('');

  // Show onboarding (once)
  ensureGopeakDir();
  if (!existsSync(ONBOARDING_SHOWN_FILE)) {
    printOnboarding();
    writeFileSync(ONBOARDING_SHOWN_FILE, new Date().toISOString());
  }

  // Suggest star (once)
  if (!existsSync(STAR_PROMPTED_FILE)) {
    console.log('⭐ If GoPeak helps your Godot workflow, please star us!');
    console.log('   Run: gopeak star');
    console.log('');
  }
}

function removeHookBlock(content: string): string {
  const regex = new RegExp(
    `\\n?${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
    'g'
  );
  return content.replace(regex, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printOnboarding(): void {
  const version = getLocalVersion();
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log(`║  🎮 GoPeak v${version} — AI-Powered Godot Development`
    + ' '.repeat(Math.max(0, 39 - version.length)) + '║');
  console.log('║                                                      ║');
  console.log('║  110+ tools for Godot Engine via MCP                 ║');
  console.log('║                                                      ║');
  console.log('║  📖 Docs:   https://github.com/HaD0Yun/godot-mcp   ║');
  console.log('║  ⭐ Star:   gopeak star                              ║');
  console.log('║  🔄 Update: npm update -g gopeak                     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
}

export { MARKER_START, MARKER_END };
