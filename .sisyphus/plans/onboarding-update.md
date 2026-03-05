# GoPeak Onboarding + Auto-Update Notification

## TL;DR

> **Quick Summary**: Add `instructions` for LLM onboarding, npm version check, update banner, `star_gopeak` tool (auto-star via gh CLI), and `godot.getting_started` prompt.
> 
> **Deliverables**:
> - `instructions` field (dynamic: version + update + star prompt for LLM)
> - `star_gopeak` tool (auto-star via `gh` CLI, silent skip if unavailable)
> - Async npm registry version check on startup (1 time, silent fail)
> - Update banner prepended to first tool call response (1 time only)
> - `godot.getting_started` MCP prompt in `src/prompts.ts`
> - All 6 READMEs updated
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 → Task 4 → Task 5 → Task 6 → F1

---

## Context

### Original Request
"해당 mcp를 사용하는 사람한태 start 눌러달라는거 표시되도록 넣고 싶은데" + "업데이트 하면 자동으로 업데이트 하라고 문구가 뜨도록 세팅하고 싶음"

### Interview Summary
**Key Discussions**:
- **Start message intent**: LLM이 알아서 안내 (instructions 필드 → 시스템 프롬프트 주입)
- **Instructions 내용**: 간단하게 GoPeak 소개 + 업데이트 안내 + GitHub 스타 부탁
- **업데이트 알림 위치**: LLM이 안내 (instructions) + 첫 tool 호출 결과에 배너 1회
- **체크 타이밍**: 서버 시작 시 비동기 1회
- **getting_started 프롬프트**: 추가 (상세 기능 안내용)

**Research Findings**:
- SDK `instructions` field: `new Server(info, { instructions: "..." })` → `_oninitialize()` 응답에 포함 → 클라이언트가 LLM 시스템 프롬프트에 주입
- `src/prompts.ts`: 이미 2개 프롬프트 존재 (`godot.scene_bootstrap`, `godot.debug_triage`)
- `axios` 이미 의존성에 있음 — npm registry 조회에 사용 가능
- `SERVER_VERSION`: package.json에서 파싱 (line 48-55)

### Metis Review
**Identified Gaps** (addressed):
- **Semver 비교**: 문자열 비교는 `"1.2.10" > "1.2.9"` 실패 → 수동 semver 비교 함수 구현 (의존성 추가 없이)
- **Race condition**: 동시 첫 tool 호출 시 배너 중복 → 동기 boolean 플래그로 충분 (Node.js 싱글스레드)
- **Network timeout**: npm registry 체크에 5초 타임아웃 필수
- **응답 검증**: npm registry 응답 형태 검증 필요
- **에러 응답 배너**: `isError: true` 응답에는 배너 미표시

---

## Work Objectives

### Core Objective
GoPeak MCP 서버에 온보딩 안내와 자동 업데이트 알림을 추가하여 사용자 경험 향상

### Concrete Deliverables
- `src/index.ts`: `instructions` 필드, 버전 체크 로직, 배너 로직
- `src/prompts.ts`: `godot.getting_started` 프롬프트
- 6개 README 업데이트

### Definition of Done
- [ ] `npm run build` 성공
- [ ] 서버 시작 시 npm registry 체크 (비동기, non-blocking)
- [ ] MCP initialize 응답에 instructions 포함
- [ ] 첫 tool 호출에 update 배너 표시 (업데이트 있을 때만)
- [ ] 두 번째 tool 호출부터 배너 없음
- [ ] 네트워크 실패 시 조용히 무시
- [ ] `godot.getting_started` 프롬프트 등록됨

### Must Have
- instructions 필드에 GoPeak 소개 + 업데이트 안내 + 스타 링크
- 서버 시작 non-blocking (네트워크 대기 금지)
- 첫 tool 호출에만 1회 배너
- 네트워크 에러 silent fail

### Must NOT Have (Guardrails)
- ❌ 자동 업데이트 실행 (알림만)
- ❌ 서버 시작 블로킹 (async fire-and-forget)
- ❌ 새 npm 의존성 추가 (semver 등 — 수동 구현)
- ❌ 파일시스템에 상태 저장 (in-memory only)
- ❌ 주기적 체크 (시작 시 1회만)
- ❌ 에러 응답에 배너 추가
- ❌ console.error로 업데이트 로그 출력 (사용자가 선택 안 함)
- ❌ 모든 tool 호출마다 배너 (첫 호출만)
- ❌ AI 슬롭: 과도한 주석, 불필요한 추상화, 사용하지 않는 import

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (`npm run test:smoke`, `node test-e2e-dynamic-groups.mjs`)
- **Automated tests**: Tests-after (E2E 테스트로 검증)
- **Framework**: Node.js native (기존 test-e2e 패턴 따름)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Server startup**: Use Bash — start server, check no crash, verify async behavior
- **Tool calls**: Use MCP inspector or direct JSON-RPC via stdio
- **Build**: Use Bash — `npm run build`, check exit code

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — all independent, no deps):
├── Task 1: Version check infrastructure (index.ts) [quick]
├── Task 2: getting_started prompt (prompts.ts) [quick]
└── Task 3: star_gopeak tool (index.ts) [quick]

Wave 2 (After Wave 1 — depends on version check + star tool):
├── Task 4: Dynamic instructions field (index.ts) [quick]
└── Task 5: Update banner on first tool call (index.ts) [quick]

Wave 3 (After Wave 2 — docs):
└── Task 6: Update all 6 READMEs [quick]

Wave FINAL (After ALL tasks):
└── Task F1: Full QA verification [deep]

Critical Path: Task 1 → Task 4 → Task 5 → Task 6 → F1
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 4, 5 |
| 2 | — | 6 |
| 3 | — | 4 |
| 4 | 1, 3 | 5, 6 |
| 5 | 1 | 6 |
| 6 | 4, 5 | F1 |
| F1 | 6 | — |

### Agent Dispatch Summary

- **Wave 1**: 3 — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: 2 — T4 → `quick`, T5 → `quick`
- **Wave 3**: 1 — T6 → `quick`
- **FINAL**: 1 — F1 → `deep`
---

## TODOs

- [ ] 1. Version Check Infrastructure

  **What to do**:
  - Add 3 new private fields to `GodotServer` class (after `activeGroups` at line ~296):
    - `private latestVersion: string | null = null`
    - `private hasShownUpdateBanner: boolean = false`
    - `private updateCheckDone: boolean = false`
  - Create private `compareSemver(a: string, b: string): number` utility method:
    - Parse `major.minor.patch` from each string
    - Return positive if a > b, negative if a < b, 0 if equal
    - Handle invalid strings gracefully (return 0)
    - NO external dependencies (no `semver` package)
  - Create private `async checkForUpdates(): Promise<void>` method:
    - `axios.get('https://registry.npmjs.org/gopeak/latest', { timeout: 5000 })`
    - Validate response: `response.data?.version` is a non-empty string
    - Store in `this.latestVersion`
    - Set `this.updateCheckDone = true`
    - Wrap entire body in try/catch that silently swallows all errors
  - Call `this.checkForUpdates()` at end of constructor (line ~461, after `setupShutdownHandlers()`)
    - Fire-and-forget pattern: `this.checkForUpdates().catch(() => {})` — do NOT await

  **Must NOT do**:
  - Do NOT await the checkForUpdates call in constructor
  - Do NOT add `semver` package as dependency
  - Do NOT log errors to console.error
  - Do NOT modify any existing fields or methods

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3, Task 4
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/index.ts:275-296` — GodotServer class field declarations (add new fields after `activeGroups`)
  - `src/index.ts:382-462` — Constructor body (add `checkForUpdates()` call at end, line ~461 after `setupShutdownHandlers()`)
  - `src/index.ts:48-55` — `SERVER_VERSION` constant (compare against this)

  **API/Type References**:
  - `package.json:35` — axios dependency (`^1.7.9`), already installed
  - npm registry API: `GET https://registry.npmjs.org/gopeak/latest` → `{ "version": "x.y.z" }`

  **WHY Each Reference Matters**:
  - Line 275-296: Follow exact field declaration pattern (private, typed, with default)
  - Line 382-462: Constructor is where fire-and-forget call goes — after all synchronous setup
  - SERVER_VERSION: The comparison baseline — if undefined, skip comparison entirely

  **Acceptance Criteria**:
  - [ ] 3 new private fields exist on GodotServer class
  - [ ] `compareSemver('1.2.10', '1.2.9')` returns positive number
  - [ ] `compareSemver('1.2.9', '1.2.10')` returns negative number
  - [ ] `compareSemver('1.0.0', '1.0.0')` returns 0
  - [ ] `compareSemver('invalid', '1.0.0')` returns 0 (no crash)
  - [ ] `checkForUpdates()` exists and is called at end of constructor
  - [ ] `npm run build` succeeds

  **QA Scenarios:**

  ```
  Scenario: Build succeeds after adding version check infrastructure
    Tool: Bash
    Preconditions: All changes applied to src/index.ts
    Steps:
      1. Run `npm run build` in /home/doyun/godot-mcp
      2. Check exit code is 0
      3. Verify no TypeScript errors in output
    Expected Result: Clean build with zero errors
    Failure Indicators: Non-zero exit code, TypeScript compilation errors
    Evidence: .sisyphus/evidence/task-1-build-check.txt
  ```

  **Commit**: YES (groups with Task 3, 4)
  - Message: `feat(onboarding): add version check infrastructure`
  - Files: `src/index.ts`
  - Pre-commit: `npm run build`

- [ ] 2. Add `godot.getting_started` Prompt

  **What to do**:
  - Add a new prompt template to the `promptTemplates` array in `src/prompts.ts` (after `godot.debug_triage` entry, line ~151)
  - Prompt definition:
    - `name`: `'godot.getting_started'`
    - `title`: `'GoPeak Getting Started'`
    - `description`: `'Quick start guide for the GoPeak Godot MCP server. Shows available tool categories, common workflows, and tips.'`
    - `arguments`: empty array (no arguments needed)
  - Render function returns a GetPromptResult with a single user message:
    - Content explains: GoPeak overview, how to use `tool.catalog`, the 12 core + 22 dynamic group system, example workflows (create scene, run project, debug), links to README
    - Keep content concise but informative (similar length to existing prompts)

  **Must NOT do**:
  - Do NOT modify existing prompts (scene_bootstrap, debug_triage)
  - Do NOT add arguments to this prompt (no-args, instant guide)
  - Do NOT duplicate info that's already in instructions (keep them complementary)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/prompts.ts:37-151` — Existing promptTemplates array (follow exact structure)
  - `src/prompts.ts:98-151` — `godot.debug_triage` template (closest pattern to follow — simpler prompt)
  - `src/prompts.ts:11-14` — PromptTemplate type definition

  **API/Type References**:
  - `src/prompts.ts:4-6` — GetPromptResult, ListPromptsResult, Prompt types from SDK

  **WHY Each Reference Matters**:
  - Line 37-151: Must add to this array — follow exact { prompt: {}, render: () => {} } structure
  - Line 98-151: debug_triage is the simpler template to copy from (scene_bootstrap has more args)

  **Acceptance Criteria**:
  - [ ] `godot.getting_started` prompt added to promptTemplates array
  - [ ] No arguments required
  - [ ] Render returns valid GetPromptResult with user message
  - [ ] `npm run build` succeeds

  **QA Scenarios:**

  ```
  Scenario: Getting started prompt is registered and renderable
    Tool: Bash (node REPL)
    Preconditions: src/prompts.ts modified, npm run build succeeds
    Steps:
      1. Run `npm run build`
      2. Run `node -e "import('./build/prompts.js').then(m => { const r = m.listPrompts(undefined); console.log(JSON.stringify(r.prompts.map(p => p.name))); })"` 
      3. Verify output contains 'godot.getting_started'
      4. Run `node -e "import('./build/prompts.js').then(m => { const r = m.getPrompt('godot.getting_started'); console.log(r.messages.length > 0 ? 'OK' : 'FAIL'); })"` 
      5. Verify output is 'OK'
    Expected Result: Prompt listed and renders without error
    Failure Indicators: Import error, missing prompt name, render crash
    Evidence: .sisyphus/evidence/task-2-prompt-check.txt
  ```

  **Commit**: YES
  - Message: `feat(onboarding): add godot.getting_started prompt`
  - Files: `src/prompts.ts`
  - Pre-commit: `npm run build`

- [ ] 3. Add `star_gopeak` Tool + Compact Alias

  **What to do**:
  - Add a new tool `star_gopeak` to the MCP server:
    - **Tool name**: `star_gopeak`
    - **Compact alias**: `github.star` → `star_gopeak` (add to `compactAliasToLegacy` at line ~297)
    - **Group**: Add to `core_meta` group (line ~211-213, append to tools array)
    - **Description**: `'Star the GoPeak repository on GitHub. Requires gh CLI installed and authenticated. If gh is not available, silently skips.'`
    - **Input schema**: No required arguments (empty object)
    - **Tool definition**: Add to `buildToolDefinitions()` function (compact section)
  - Implement `handleStarGopeak()` method on GodotServer class:
    ```typescript
    private async handleStarGopeak(): Promise<any> {
      try {
        // 1. Check if gh CLI exists
        await execAsync('gh --version');
        
        // 2. Check if authenticated
        await execAsync('gh auth status');
        
        // 3. Star the repo
        await execAsync('gh api -X PUT /user/starred/HaD0Yun/godot-mcp');
        
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ok: true,
            message: 'Thank you for starring GoPeak! ⭐'
          }, null, 2) }]
        };
      } catch {
        // gh not installed or not authenticated — just skip
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ok: false,
            message: 'gh CLI not available or not authenticated. No problem — skipped.'
          }, null, 2) }]
        };
      }
    }
    ```
  - Add `case 'star_gopeak':` to the switch in CallToolRequestSchema handler (line ~3745)
  - **Key behavior**: Single try/catch wrapping ALL gh calls. Any failure (gh missing, not authed, API error) → same friendly skip message. No install instructions, no error details.

  **Must NOT do**:
  - Do NOT suggest installing gh CLI (just skip)
  - Do NOT show error details to user (just 'not available')
  - Do NOT require any arguments
  - Do NOT retry on failure
  - Do NOT throw errors (always return a valid tool response)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1 (with Task 1, Task 2)
  - Blocks: Task 4 (instructions references this tool)
  - Blocked By: None

  **References**:
  - `src/index.ts:43` — `execAsync = promisify(exec)` already available
  - `src/index.ts:211-213` — `core_meta` group definition (add `star_gopeak` to tools array)
  - `src/index.ts:297-330` — `compactAliasToLegacy` map (add `'github.star': 'star_gopeak'`)
  - `src/index.ts:3745` — switch statement in CallToolRequestSchema handler (add new case)
  - `src/index.ts:1754-1800` — buildToolDefinitions compact section (add tool definition)
  - GitHub API: `PUT /user/starred/{owner}/{repo}` returns 204 on success

  **WHY Each Reference Matters**:
  - Line 43: execAsync already exists, use it directly for gh commands
  - Line 211-213: core_meta group must include the new tool for it to be always-visible
  - Line 297-330: Compact alias map for `github.star` shorthand
  - Line 3745: Switch statement where the tool handler case goes

  **Acceptance Criteria**:
  - [ ] `star_gopeak` tool registered in buildToolDefinitions()
  - [ ] `github.star` compact alias mapped to `star_gopeak`
  - [ ] Added to `core_meta` group
  - [ ] `handleStarGopeak()` method exists with single try/catch
  - [ ] Failure returns ok:false with friendly skip message (no install instructions)
  - [ ] `npm run build` passes

  **QA Scenarios:**
  ```
  Scenario: Tool registered and compiles
    Tool: Bash
    Steps:
      1. `npm run build` — expect exit 0
      2. Grep `star_gopeak` in build/index.js — expect found
      3. Grep `github.star` in build/index.js — expect found (compact alias)
      4. Grep `core_meta` tools array in src/index.ts — expect includes `star_gopeak`
    Evidence: .sisyphus/evidence/task-3-star-tool.txt

  Scenario: Graceful failure when gh not available
    Tool: Bash
    Steps:
      1. Verify handleStarGopeak catches all errors in single try/catch
      2. Grep for `gh CLI not available` or similar in build/index.js
      3. Verify NO string like `install gh` or `brew install` in build/index.js
    Evidence: .sisyphus/evidence/task-3-star-graceful.txt
  ```

  **Commit**: YES (group with Task 1, 2)
  - Message: `feat(onboarding): add star_gopeak tool with gh CLI integration`
  - Files: `src/index.ts`

- [ ] 4. Add dynamic `instructions` field to Server constructor

  **What to do**:
  - Modify the Server constructor call in `src/index.ts` (line 438-450)
  - Add `instructions` option that builds a dynamic string:
    ```
    GoPeak v{SERVER_VERSION} — Godot Engine MCP Server (110+ tools)
    
    Use `tool.catalog` to discover available tools.
    For detailed guide, use the `godot.getting_started` prompt.
    
    [If latestVersion exists AND isNewerVersion(SERVER_VERSION, latestVersion):]
    Update available: v{SERVER_VERSION} -> v{latestVersion}. Run: npm install -g gopeak@latest
    
    When the user first interacts, ask them:
    "Would you like to ⭐ star GoPeak on GitHub?"
    If the user says yes/y, call the `github.star` (star_gopeak) tool.
    If the user says no/n, skip and continue normally.
    ```
  - Since `instructions` is set at construction time (sync) but `checkForUpdates()` is async,
    the instructions field must use a getter or be updated after the version check completes.
  - **Approach**: Use `server.setRequestHandler` to intercept `InitializeRequestSchema` and
    return a custom response that includes dynamically-built instructions.
    OR: Set a static instructions initially, and in `checkForUpdates()` callback, rebuild and
    use `(this.server as any)._instructions = updatedInstructions` to update it.
  - **Simplest approach**: Build instructions as a method `private buildInstructions(): string`
    and set `(this.server as any)._instructions` after version check completes.
    Initial instructions (before check completes) will NOT mention update info.

  **Must NOT do**:
  - Do NOT override the initialize handler (fragile, may break SDK internals)
  - Do NOT make instructions excessively long
  - Do NOT hardcode version strings (use SERVER_VERSION)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - Can Run In Parallel: YES (with Task 4 in Wave 2)
  - Parallel Group: Wave 2
  - Blocks: Task 5
  - Blocked By: Task 1

  **References**:
  - `src/index.ts:438-450` - Server constructor where `instructions` option goes
  - `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js:50` - `this._instructions = options?.instructions`
  - `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js:279` - instructions included in initialize response
  - `src/index.ts:48-55` - SERVER_VERSION constant

  **WHY Each Reference Matters**:
  - Line 438-450: This is where Server is constructed. `instructions` is an option in the 2nd arg.
  - SDK line 50: Shows `_instructions` is a settable property - can be updated after construction.
  - SDK line 279: Confirms instructions is spread into initialize response when present.

  **Acceptance Criteria**:
  - [ ] Server constructor includes `instructions` option
  - [ ] Instructions contain 'GoPeak', SERVER_VERSION, GitHub link
  - [ ] If update available, instructions mention update command
  - [ ] If no network/no update, instructions still work (just without update line)
  - [ ] `npm run build` passes

  **QA Scenarios:**
  ```
  Scenario: Instructions in compiled output
    Tool: Bash
    Steps:
      1. `npm run build` - expect exit 0
      2. Grep `instructions` in build/index.js near Server constructor - expect found
      3. Grep `GoPeak` in build/index.js - expect found
      4. Grep `github.com/HaD0Yun` in build/index.js - expect found
    Evidence: .sisyphus/evidence/task-3-instructions.txt
  ```

  **Commit**: YES (group with Task 1, 2)
  - Message: `feat(onboarding): add instructions, version check, and getting_started prompt`
  - Files: `src/index.ts`

- [ ] 5. Add update banner on first tool call response

  **What to do**:
  - In the `CallToolRequestSchema` handler (line ~3737-3989), add banner logic:
    - BEFORE the `switch(resolvedToolName)` at line 3745
    - After getting the tool result from the switch, check:
      1. `this.hasShownUpdateBanner === false`
      2. `this.latestVersion !== null`
      3. `GodotServer.isNewerVersion(SERVER_VERSION, this.latestVersion) === true`
      4. Result is NOT an error (`result.isError !== true`)
    - If all conditions met:
      - Prepend update banner text to the first `content` item of type `text`
      - Set `this.hasShownUpdateBanner = true`
    - Banner text format:
      ```
      ---
      Update available: GoPeak v{current} -> v{latest}
      Run: npm install -g gopeak@latest
      ---
      (followed by original tool response)
      ```
  - The banner is prepended to the text content, not added as a separate content item
  - Race condition note: Node.js is single-threaded, so boolean check + set is atomic

  **Must NOT do**:
  - Do NOT show banner on error responses (isError: true)
  - Do NOT show banner more than once (check + set hasShownUpdateBanner)
  - Do NOT modify tool response structure (only prepend to text content)
  - Do NOT show banner if version check hasn't completed yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - Can Run In Parallel: YES (with Task 3 in Wave 2)
  - Parallel Group: Wave 2
  - Blocks: Task 5
  - Blocked By: Task 1

  **References**:
  - `src/index.ts:3737-3989` - CallToolRequestSchema handler (entire switch block)
  - `src/index.ts:3737-3744` - Handler entry: normalize args, resolve alias (add banner logic after switch)
  - `src/index.ts:3983-3989` - End of switch + default case (wrap in let result, then modify)

  **WHY Each Reference Matters**:
  - Line 3737: Start of handler - understand the flow before modifying
  - Line 3744: resolveToolAlias call - banner goes AFTER tool execution, not before
  - Line 3983-3989: End of switch - need to refactor to capture result before returning

  **Acceptance Criteria**:
  - [ ] Banner appears in first tool response when update is available
  - [ ] Banner does NOT appear in second+ tool response
  - [ ] Banner does NOT appear on error responses
  - [ ] Banner does NOT appear when no update available
  - [ ] Tool response content is preserved (banner is prepended, not replacing)
  - [ ] `npm run build` passes

  **QA Scenarios:**
  ```
  Scenario: Banner logic compiled
    Tool: Bash
    Steps:
      1. `npm run build` - expect exit 0
      2. Grep `hasShownUpdateBanner` in build/index.js - expect found
      3. Grep `Update available` in build/index.js - expect found
    Evidence: .sisyphus/evidence/task-4-banner.txt
  ```

  **Commit**: YES (group with Task 1, 2, 3)
  - Message: `feat(onboarding): add instructions, version check, and getting_started prompt`
  - Files: `src/index.ts`

- [ ] 6. Update all 6 READMEs

  **What to do**:
  - Add an 'Onboarding & Update Notifications' section to all 6 READMEs:
    - README.md (English)
    - README-ko.md (Korean)
    - README-ja.md (Japanese)
    - README-zh.md (Chinese)
    - README-de.md (German)
    - README-pt_BR.md (Portuguese)
  - Content per README:
    - Explain: server sends instructions to LLM on connect
    - Explain: auto-checks npm for updates on startup
    - Explain: first tool call shows update banner if newer version exists
    - Mention: `godot.getting_started` prompt available for guided tour
  - Translate content for each language
  - Place section after the Dynamic Tool Groups section (since it builds on that feature)

  **Must NOT do**:
  - Do NOT modify existing sections (only add new section)
  - Do NOT change version numbers in READMEs

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - Can Run In Parallel: NO (single task, but internally can be split if delegated)
  - Parallel Group: Wave 3 (after build verification)
  - Blocks: F1
  - Blocked By: Task 4 (need to verify feature works before documenting)

  **References**:
  - `README.md` - English version (find Dynamic Tool Groups section, add after it)
  - `README-ko.md` through `README-pt_BR.md` - Same structure, translated

  **Acceptance Criteria**:
  - [ ] All 6 READMEs have new section about onboarding/updates
  - [ ] Each README's content is in the correct language
  - [ ] Section mentions instructions, update check, banner, getting_started prompt

  **QA Scenarios:**
  ```
  Scenario: README content check
    Tool: Bash
    Steps:
      1. Grep `instructions` in README.md - expect found
      2. Grep `getting_started` in README.md - expect found  
      3. Grep `update` (case insensitive) in each README-*.md - expect found in all 5
    Evidence: .sisyphus/evidence/task-5-readmes.txt
  ```

  **Commit**: YES
  - Message: `docs: add onboarding and update notification sections to all READMEs`
  - Files: `README.md, README-ko.md, README-ja.md, README-zh.md, README-de.md, README-pt_BR.md`

---

## Final Verification Wave

- [ ] F1. **Full QA — Build + Startup + Tool Call + Star + Prompt Verification** — `deep`
  Start from clean state. Run `npm run build`. Verify `star_gopeak` tool definition exists in build output. Verify `github.star` compact alias mapped. Check `instructions` includes star prompt text. Check `getting_started` prompt exists. Grep for `hasShownUpdateBanner` banner logic. Verify `core_meta` group includes `star_gopeak`. Run full E2E tests if available.
  Output: `Build [PASS/FAIL] | Star Tool [PASS/FAIL] | Instructions [PASS/FAIL] | Banner [PASS/FAIL] | Prompt [PASS/FAIL] | VERDICT`

---

## Commit Strategy

- **1**: `feat(onboarding): add instructions, version check, star tool, and getting_started prompt` — src/index.ts, src/prompts.ts
- **2**: `docs: update READMEs with onboarding, update notification, and star features` — README*.md

---

## Success Criteria

### Verification Commands
```bash
npm run build  # Expected: exit 0, no errors
node -e "import('./build/index.js')"  # Expected: server starts without crash
```

### Final Checklist
- [ ] `instructions` field present in initialize response
- [ ] `instructions` includes star prompt for LLM
- [ ] `star_gopeak` tool registered and in `core_meta` group
- [ ] `github.star` compact alias works
- [ ] `star_gopeak` gracefully skips when gh not available (no install instructions)
- [ ] Update banner shows on first tool call (when update available)
- [ ] Update banner absent on second+ tool call
- [ ] No crash on network failure
- [ ] `godot.getting_started` prompt registered
- [ ] All 6 READMEs updated
- [ ] `npm run build` passes clean
