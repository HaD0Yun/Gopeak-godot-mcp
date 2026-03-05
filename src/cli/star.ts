/**
 * gopeak star — GitHub star feature
 *
 * If gh CLI is installed and authenticated: auto-star.
 * If not: print a friendly message with the URL.
 * Never asks the user to install gh.
 */

import { commandExists, runCommand, STAR_PROMPTED_FILE, ensureGopeakDir } from './utils.js';
import { existsSync, writeFileSync } from 'fs';

const REPO = 'HaD0Yun/godot-mcp';
const REPO_URL = `https://github.com/${REPO}`;

export async function starGoPeak(): Promise<void> {
  // 1. Check if gh CLI exists
  const hasGh = await commandExists('gh');
  if (!hasGh) {
    console.log(`ℹ️  gh CLI is not installed.`);
    console.log(`   Please star GoPeak directly: ${REPO_URL}`);
    markStarPrompted();
    return;
  }

  // 2. Check gh authentication
  const authResult = await runCommand('gh auth status');
  if (authResult.code !== 0) {
    console.log(`ℹ️  gh CLI is not authenticated.`);
    console.log(`   Please star GoPeak directly: ${REPO_URL}`);
    markStarPrompted();
    return;
  }

  // 3. Check if already starred (REST: 204=starred, 404=not starred)
  const checkResult = await runCommand(`gh api user/starred/${REPO}`);
  if (checkResult.code === 0) {
    console.log(`⭐ You've already starred GoPeak! Thank you!`);
    markStarPrompted();
    return;
  }

  // 4. Star it (PUT user/starred/:owner/:repo)
  const starResult = await runCommand(`gh api -X PUT user/starred/${REPO}`);
  if (starResult.code === 0) {
    console.log(`⭐ Starred GoPeak! Thank you for your support!`);
  } else {
    console.log(`⚠️  Could not star automatically. Please star directly: ${REPO_URL}`);
  }
  markStarPrompted();
}

function markStarPrompted(): void {
  ensureGopeakDir();
  if (!existsSync(STAR_PROMPTED_FILE)) {
    writeFileSync(STAR_PROMPTED_FILE, new Date().toISOString());
  }
}
