# GoPeak MCP Platform Roadmap

> Purpose: phased, repository-grounded plan to evolve GoPeak into a full MCP platform with strong tool/resource/prompt support, transport clarity, and verification discipline.

## Baseline (March 2026)

Ground truth from current repository:

- MCP server entrypoint: `src/index.ts`
- Tool system: mature and broad (`src/tools.ts` and related modules)
- Resource support: present via `src/resources.ts`
- Prompts capability: not yet first-class in MCP capability registration
- MCP transport in package metadata: stdio (`server.json`)
- Internal bridge transport: HTTP+WS (`src/godot-bridge.ts`)

---

## P1 — Capability Foundation (Tools + Resources + Prompts skeleton)

### Goals

1. Keep existing tool behavior stable.
2. Harden and document resource behavior.
3. Introduce prompts capability scaffolding with minimal, high-value prompt templates.

### Candidate deliverables

- Capability registration structure in server entrypoint that cleanly wires:
  - tools
  - resources
  - prompts
- Initial prompt set (for common workflows such as scene creation/debug loop guidance).
- Capability-level documentation with examples and compatibility notes.

### Acceptance criteria

- Tools list and execution still function in compact and full profiles.
- Existing resource URIs keep working (`godot://project/info`, `godot://scene/{path}`, etc.).
- Prompt endpoints are discoverable and invocable from MCP clients that support prompts.
- No breaking change to current `npx -y gopeak` startup and basic operations.

### Risks

- Prompt capability differences across MCP clients.
- Unclear boundary between “tool logic” and “prompt workflow intent.”

### Mitigation

- Keep prompt templates versioned and additive.
- Maintain fallback guidance in README for clients without prompt support.
- Add compatibility notes per client behavior.

---

## P2 — Transport & Boundary Hardening

### Goals

1. Make transport boundaries explicit in implementation.
2. Prepare optional additional MCP transport path without regressing stdio.
3. Reduce coupling between MCP entry logic and Godot integration details.

### Candidate deliverables

- Refined module boundaries as defined in `docs/architecture.md`.
- Transport adapter abstraction (stdio first, optional future HTTP/streamable path).
- Explicit error mapping policy across bridge/LSP/DAP failures.

### Acceptance criteria

- Stdio transport remains default and passes smoke checks.
- Bridge-dependent features still work (`/health`, websocket handshake, representative tool call).
- Transport adapter changes do not require touching tool/resource business logic.
- `server.json` and runtime behavior remain consistent.

### Risks

- Transport abstraction adds accidental complexity.
- Runtime/bridge failures surface as inconsistent MCP errors.

### Mitigation

- Introduce boundaries incrementally (small PRs).
- Add contract tests for error shape and status mapping.
- Keep one canonical error envelope guideline in docs.

---

## P3 — Verification, Compatibility, and Release Discipline

### Goals

1. Make platform evolution safe through repeatable verification.
2. Protect backward compatibility (aliases, profiles, capability behavior).
3. Improve release confidence for npm + MCP registry metadata.

### Candidate deliverables

- Verification checklist integrated into contribution/release process.
- Capability regression matrix (tools/resources/prompts x compact/full x key clients).
- Pre-release smoke flow (build, run, inspect, representative calls).

### Acceptance criteria

- Every capability-affecting PR includes verification evidence.
- Backward compatibility checks are run before version bumps.
- Release artifacts (`build/`, `package.json`, `server.json`) are validated together.

### Risks

- Verification burden slows iteration.
- CI/local environment drift causes false negatives.

### Mitigation

- Keep smoke suite lean and deterministic.
- Separate mandatory checks from extended/manual checks.
- Record known client-specific behavior in one compatibility table.

---

## Sequencing and ownership guidance

- Execute P1 before significant transport work.
- Start P2 only after P1 capability contracts are stable.
- Treat P3 as ongoing discipline, with minimum baseline established before major releases.

---

## Definition of Done for platform transition

The transition is considered successful when:

1. GoPeak exposes practical tools + resources + prompts as first-class MCP capabilities.
2. MCP transport concerns and Godot integration transport concerns are cleanly separated.
3. Verification evidence is routine, repeatable, and tied to release quality.
4. Existing users of `gopeak` / `godot-mcp` retain expected workflows without surprise breakage.
