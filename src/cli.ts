#!/usr/bin/env node
/**
 * GoPeak CLI Entrypoint
 *
 * Routes subcommands or falls through to the MCP server.
 *
 *   gopeak              → Start MCP server (default, backward-compatible)
 *   gopeak setup        → Install shell hooks
 *   gopeak check        → Check for updates
 *   gopeak star         → Star on GitHub
 *   gopeak uninstall    → Remove shell hooks
 *   gopeak version      → Print version
 *   gopeak help         → Show help
 */

import { getLocalVersion } from './cli/utils.js';

const args = process.argv.slice(2);
const command = args[0];

const CLI_COMMANDS = ['setup', 'check', 'star', 'notify', 'uninstall', 'version', 'help', '--version', '-v', '--help', '-h'];

async function main(): Promise<void> {
  // If no args or not a CLI command → start MCP server (original behavior)
  if (!command || !CLI_COMMANDS.includes(command)) {
    // Dynamic import to avoid loading MCP SDK for CLI-only commands
    await import('./index.js');
    return;
  }

  switch (command) {
    case 'setup': {
      const { setupShellHooks } = await import('./cli/setup.js');
      await setupShellHooks(args.slice(1));
      break;
    }
    case 'check': {
      const { checkForUpdates } = await import('./cli/check.js');
      await checkForUpdates(args.slice(1));
      break;
    }
    case 'star': {
      const { starGoPeak } = await import('./cli/star.js');
      await starGoPeak();
      break;
    }
    case 'notify': {
      const { showNotification } = await import('./cli/notify.js');
      await showNotification();
      break;
    }
    case 'uninstall': {
      const { uninstallHooks } = await import('./cli/uninstall.js');
      await uninstallHooks();
      break;
    }
    case 'version':
    case '--version':
    case '-v': {
      console.log(`gopeak v${getLocalVersion()}`);
      break;
    }
    case 'help':
    case '--help':
    case '-h': {
      printHelp();
      break;
    }
  }
}

function printHelp(): void {
  const version = getLocalVersion();
  console.log(`
GoPeak v${version} — AI-Powered Godot Development via MCP

Usage:
  gopeak                Start MCP server (default)
  gopeak setup          Install shell hooks for update notifications
  gopeak check          Check for GoPeak updates
  gopeak check --bg     Background check (used by shell hooks)
  gopeak check --quiet  Print only if update available
  gopeak star           Star GoPeak on GitHub
  gopeak uninstall      Remove shell hooks
  gopeak version        Show current version
  gopeak help           Show this help

Shell hooks wrap these commands with update notifications:
  claude, codex, gemini, opencode, omc, omx

More info: https://github.com/HaD0Yun/godot-mcp
`.trim());
}

main().catch((err) => {
  console.error('gopeak:', err.message ?? err);
  process.exit(1);
});
