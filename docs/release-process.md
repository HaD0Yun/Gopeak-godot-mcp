# Release Process

This repository uses a simple bump -> verify -> tag -> publish flow.

## 1) Bump version

Use the version sync script to update `package.json` + `server.json` (and versioned README references, if present):

```bash
node scripts/bump-version.mjs patch
# or: node scripts/bump-version.mjs minor
# or: node scripts/bump-version.mjs 2.3.0
```

Preview without writing:

```bash
node scripts/bump-version.mjs patch --dry-run
```

## 2) Verify locally

Run release checks before tagging:

```bash
npm run build
npx tsc --noEmit
npm run test:ci
```

## 3) Commit + tag

```bash
git add package.json server.json README.md
# plus any release notes/changelog edits
git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

## 4) Publish release

- Publish to npm using existing publish flow (`npm publish` / CI release job if configured).
- Create a GitHub Release from tag `vX.Y.Z`.

## Notes

- Keep release changes focused (version metadata + release notes only).
- `server.json` package version must always match `package.json`.
