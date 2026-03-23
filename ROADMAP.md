# GoPeak Roadmap

> Current planning lives in [`docs/platform-roadmap.md`](docs/platform-roadmap.md). This root file is a short status snapshot so the repository does not drift behind the codebase.

## Current baseline (March 2026)

- Package version: `2.3.4`
- Distribution: npm package `gopeak`, MCP metadata in `server.json`
- Default tool exposure: `compact` profile
- Capability surface: 33 core tools + 22 dynamic groups (110+ tools total)
- Additional MCP capabilities: resources are implemented, prompts are available, stdio remains the default transport
- Runtime integrations: Godot bridge, LSP, DAP, runtime addon, visualizer

## Current priorities

1. Reduce the `src/index.ts` monolith into clearer capability-oriented modules without breaking behavior.
2. Keep shell-hook installation explicit and opt-in via `gopeak setup`.
3. Keep package metadata, server metadata, docs, and release notes synchronized with verified behavior.
4. Preserve backward compatibility for compact/full profiles, aliases, and existing CLI/server startup flows.

## Working principles

- Prefer incremental, verifiable changes over speculative large rewrites.
- Treat README/package/server metadata as release-critical surfaces.
- Update roadmap and architecture notes only when they reflect repository reality.

## Reference docs

- [Platform Roadmap](docs/platform-roadmap.md)
- [Architecture](docs/architecture.md)
- [Release Process](docs/release-process.md)
- [CHANGELOG](CHANGELOG.md)
