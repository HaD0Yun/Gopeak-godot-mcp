# GoPeak CLI vs MCP Validation Notes

This document turns the approved validation plan into a repo-local execution guide for the current codebase. It is intentionally documentation-only: no product-positioning change is implied until benchmark evidence exists.

## Current repo facts that constrain the benchmark

- The public package and onboarding flow are still MCP-first: `README.md`, `package.json`, and `server.json` position GoPeak as an MCP server and route `gopeak` to MCP startup by default.
- The current public CLI in `src/cli.ts` exposes lifecycle/support commands (`setup`, `check`, `notify`, `star`, `uninstall`, `version`, `help`) and otherwise falls through to `src/index.ts` to launch the MCP server.
- Compact MCP is already the repository's token-efficiency baseline: `src/index.ts` defaults `GOPEAK_TOOL_PROFILE` to `compact`, and the README documents compact mode as the default profile.
- Command-style execution already exists internally: many scene/script/project actions flow through `executeGodotOperation(...)` and `src/scripts/godot_operations.gd`, which is the best shared-core seam for a CLI-vs-MCP comparison.

## Code-quality review for the benchmark surface

### Strengths to preserve

1. **Compact baseline is real, not hypothetical**
   - `src/index.ts` defaults the tool exposure profile to `compact`.
   - Dynamic groups keep the default schema smaller while allowing capability expansion on demand.
2. **A shared execution seam already exists**
   - `executeGodotOperation(...)` centralizes a large class of headless Godot operations.
   - `src/scripts/godot_operations.gd` already accepts an operation name plus JSON parameters, which makes a thin CLI wrapper plausible.
3. **Transport split is already documented**
   - `docs/architecture.md` cleanly separates MCP client transport from the Godot bridge/editor/runtime transport.

### Hotspots to watch before claiming a fair CLI win

1. **Business logic is still concentrated in `src/index.ts`**
   - The benchmark will be misleading if the CLI prototype duplicates MCP-side validation/normalization instead of reusing a shared helper.
2. **Export/build paths are only partly shared today**
   - `export_project` shells out directly to Godot CLI instead of using `godot_operations.gd`.
   - Benchmark results for export/build should be labeled `mixed-path` unless both surfaces route through the same helper.
3. **Discovery-heavy workflows remain MCP-shaped**
   - Compact profile pagination, `tool_catalog`, and dynamic group activation are meaningful MCP capabilities, not overhead bugs.
   - Any CLI comparison should call out where MCP's broader discovery surface is delivering extra value.

## Shared-core readiness map

| Task family | Current best comparison seam | Readiness | Notes |
| --- | --- | --- | --- |
| Scene/script mutation | `executeGodotOperation(...)` -> `src/scripts/godot_operations.gd` | Shared-core-ready | Best first benchmark family because MCP and CLI can plausibly hit the same engine-side path. |
| Run/export/build | direct Godot process launch in `src/index.ts` plus existing project helpers | Mixed | Export currently bypasses `godot_operations.gd`; normalize the command runner before treating results as apples-to-apples. |
| Debug/log retrieval | existing runtime/editor debug handlers in `src/index.ts` and bridge paths | MCP-coupled / Mixed | Good benchmark family, but note that editor/runtime coupling and streaming feedback are areas where MCP may retain an advantage. |
| Tool discovery / capability search | `tool_catalog`, compact pagination, dynamic groups | MCP-coupled | Keep this as context, not a primary CLI-vs-MCP benchmark, because the CLI prototype is intentionally narrower. |

## Benchmark guardrails

1. Use `GOPEAK_TOOL_PROFILE=compact` as the primary MCP baseline.
2. Keep prompts and task success criteria fixed across surfaces.
3. Prefer shared helpers over duplicated argument parsing or result shaping.
4. Label any benchmark that compares different underlying execution paths as `mixed-path` in the evidence.
5. Preserve MCP compatibility checks in the final recommendation: `npx -y gopeak`, stdio startup, representative compact-profile tool access, and metadata consistency.

## Documentation handoff for implementation + verification lanes

### Implementation lane

- Treat `src/cli.ts` as the public command entry, but keep the prototype narrow.
- Prefer extracting shared helpers rather than embedding new behavior directly in the CLI switch.
- Keep benchmark instrumentation surface-agnostic so evidence normalization can compare MCP and CLI runs directly.

### Verification lane

- Record per-run tokens, invocation count, wall-clock time, retries, and success/failure.
- Report median values across at least 3 runs per path.
- Flag `mixed-path` families separately from fully shared-core families.

## Near-term recommendation

Proceed with a **hybrid, benchmark-first** evaluation:

- benchmark scene/script mutation first,
- keep run/export/build in scope but label current path differences honestly,
- treat discovery-heavy/editor-coupled flows as places where MCP may remain the better primary interface even if CLI wins on narrow, repetitive operations.
