#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');
const SERVER_JSON_PATH = path.join(ROOT, 'server.json');
const README_PATH = path.join(ROOT, 'README.md');
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

const usage = `Usage:\n  node scripts/bump-version.mjs <version|major|minor|patch> [--dry-run]\n\nExamples:\n  node scripts/bump-version.mjs patch\n  node scripts/bump-version.mjs 2.3.0 --dry-run`;

function assertVersion(version) {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
}

function bumpVersion(currentVersion, bumpType) {
  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Current version is not a simple semver (x.y.z): ${currentVersion}`);
  }

  const [major, minor, patch] = match.slice(1).map(Number);
  if (bumpType === 'major') return `${major + 1}.0.0`;
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function replaceVersionReferencesInReadme(content, nextVersion) {
  return content
    .replace(/(npx\s+-y\s+gopeak@)(\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?)/g, `$1${nextVersion}`)
    .replace(/(npm\s+install\s+-g\s+gopeak@)(\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?)/g, `$1${nextVersion}`)
    .replace(/(https:\/\/raw\.githubusercontent\.com\/HaD0Yun\/godot-mcp\/v)(\d+\.\d+\.\d+)(\/install-addon\.(?:sh|ps1))/g, `$1${nextVersion}$3`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeText(filePath, content, dryRun) {
  if (!dryRun) {
    await fs.writeFile(filePath, content, 'utf8');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const target = args.find((arg) => !arg.startsWith('-'));

  if (!target) {
    console.error(usage);
    process.exit(1);
  }

  const pkg = await readJson(PACKAGE_JSON_PATH);
  const currentVersion = pkg.version;
  let nextVersion;

  if (target === 'major' || target === 'minor' || target === 'patch') {
    nextVersion = bumpVersion(currentVersion, target);
  } else {
    assertVersion(target);
    nextVersion = target;
  }

  assertVersion(nextVersion);

  if (nextVersion === currentVersion) {
    console.log(`No changes needed. Version is already ${nextVersion}.`);
    return;
  }

  const changed = [];

  pkg.version = nextVersion;
  await writeText(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`, dryRun);
  changed.push('package.json');

  const server = await readJson(SERVER_JSON_PATH);
  server.version = nextVersion;
  if (Array.isArray(server.packages)) {
    for (const entry of server.packages) {
      if (entry && typeof entry === 'object' && 'version' in entry) {
        entry.version = nextVersion;
      }
    }
  }
  await writeText(SERVER_JSON_PATH, `${JSON.stringify(server, null, 2)}\n`, dryRun);
  changed.push('server.json');

  const readmeOriginal = await fs.readFile(README_PATH, 'utf8');
  const readmeUpdated = replaceVersionReferencesInReadme(readmeOriginal, nextVersion);
  if (readmeUpdated !== readmeOriginal) {
    await writeText(README_PATH, readmeUpdated, dryRun);
    changed.push('README.md');
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}Version bump ${currentVersion} -> ${nextVersion}`);
  console.log(`Updated: ${changed.join(', ')}`);
  if (dryRun) {
    console.log('No files were written.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
