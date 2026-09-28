---
project: House of Fries
type: agent_boot_file
codebase: HouseOfFriesLiveDomain
status: active
last_updated: 2026-09-08
version: 2
---
# AGENTS.md — HouseOfFriesLiveDomain (Agent Boot File)

> **Every AI agent opening this repo reads this file first — before touching ANY file.**
> Applies to: OpenCode · Cline · Antigravity · GitHub Copilot · Claude Code · Cursor · ChatGPT · Hermes · any future agent.
> This file teaches you (1) where the brain is, (2) how to use it, (3) what you may and may not do.

---

## 1. THE BRAIN — the Capstone Vault (single source of truth)

**Vault: `C:\Users\Jerico\HOUSE_OF_FRIES_CAPSTONE`** (Obsidian vault, ~240 markdown notes)

- ALL project knowledge lives there: requirements, architecture, database schema, security rules, decisions (ADRs), bugs, logs, request workflow.
- This repo is **code only**. Docs in this repo are convenience copies; the vault is canonical.
- **Conflict rule:** code vs vault, or repo docs vs vault → **THE VAULT WINS**. Report the conflict (tag `DOCUMENTATION_CONFLICT` / `DATABASE_CONFLICT`), never silently resolve it.
- Final human authority: **Jerico** — sole dispatcher, sole approver.

## 2. Vault map — where to find things

| Vault folder | What's inside | Go here when… |
|---|---|---|
| `00_START_HERE/` | AI_INSTRUCTIONS · DO_NOT_BREAK · CURRENT_STATUS · MASTER_PROJECT_MAP | You are starting any session |
| `01_PROJECT/` | Overview, scope, objectives, features, users/roles, business processes | You need the "what/why" |
| `02_REQUIREMENTS/` | Functional/non-functional requirements, business rules, traceability | You need the requirement behind a task |
| `03_ARCHITECTURE/` | System/backend/frontend/API architecture, auth, data flow | You need how the system fits together |
| `04_DATABASE/` | **DATABASE_SCHEMA.md (canonical)** · TABLES · ENUMS_AND_STATUSES · FKs | You touch any table — read the section first |
| `05_MODULES/` | Per-module notes (QR_TABLES, CUSTOMER_ORDERING, CASHIER_POS, KITCHEN, INVENTORY, …) | You work inside one module |
| `06_SECURITY/` | Security overview, JWT, IDOR, rate limiting, secrets | Any auth/payment/input handling |
| `07_DOCUMENTATION/` | Thesis chapters 1–5, diagrams, defense notes | Documentation tasks |
| `08_TESTING/` | Test strategy, test cases, ISO 25010, SUS | Testing tasks |
| `10_DECISIONS/ADR/` | Architecture Decision Records (ADR-001…) | You need to know WHY something is built that way |
| `11_BUGS_AND_ISSUES/` | ACTIVE_BUGS · FIXED_BUGS · REGRESSIONS | You hit unexpected behavior |
| `13_LOGS/` | DEVELOPMENT_LOG · AI_AGENT_LOG · TESTING_LOG · DEPLOYMENT_LOG | You must log after ANY change |
| `14_AI_AGENTS/` | The protocols (see §4) + AI_AGENT_ROLES + HANDOFFS/ | Your task's protocol lives here |
| `17_REQUESTS_AND_CHANGES/` | REQUEST_INDEX · REQUESTS_WORKFLOW · INBOX → APPROVED → COMPLETED | All work enters through here |
| `98_TEMPLATES/` | Request, bug, test-case, log templates | When creating a request/bug/log entry |
| `99_ARCHIVE/` | Superseded/historical notes | Never delete — archive instead |

## 3. Mandatory read order (every task, in order — no skipping)

1. Vault `AGENTS.md` (root) — governance
2. `00_START_HERE/AI_INSTRUCTIONS.md` — binding rules + source-of-truth priority
3. `00_START_HERE/DO_NOT_BREAK.md` — hard stops
4. `00_START_HERE/CURRENT_STATUS.md` — what's done / in-progress / blocked (so you don't duplicate or break work)
5. `14_AI_AGENTS/AI_AGENT_ROLES.md` — find YOUR role and its limits
6. The protocol for your task: REQUEST_EXECUTION · CODE_REVIEW · DATABASE_CHANGE · SECURITY_REVIEW · TESTING · HANDOFF (all in `14_AI_AGENTS/`)
7. Layer 1 notes for what you touch (module note + `04_DATABASE/DATABASE_SCHEMA.md` sections + related bugs/ADRs)
8. **The actual source code** — never analyze from memory; code you can run beats docs

## 4. Who you are — agent roles (binding)

| You are… | You may | You may NOT |
|---|---|---|
| **OpenCode / Antigravity** (implementer) | Implement APPROVED requests only, edit code in scope, run lint/tests, report changed files | Expand scope, touch schema, deploy, review your own work |
| **Cline** (independent reviewer) | Review per CODE_REVIEW_PROTOCOL, produce findings + verdict; implement only explicitly assigned fixes | Review own implementation, mark VERIFIED without evidence |
| **Hermes** (coordinator/knowledge) | Analyze, plan, prepare handoff packages, verify reviews, update docs/logs | Write production code, dispatch coders (packages only), approve own proposals |
| **Copilot / ChatGPT / advisor LLMs** | Produce PROPOSALS | Directly change code — proposals enter the request workflow |
| **Any new/unknown agent** | Read everything, work only on APPROVED requests | Assume a role nobody assigned you |
| **Jerico** (human) | Approves, rejects, dispatches, resolves | — |

Team rules: single active implementer per request (recorded in `14_AI_AGENTS/AI_TASKS.md`) · implementer ≠ reviewer · disagreements escalate: evidence → Hermes arbitration → Jerico decides → work stays BLOCKED meanwhile.

## 5. How work flows — the request lifecycle (one state machine, never skip)

```
INBOX → ANALYZING → PROPOSED → WAITING FOR APPROVAL
      → (WAITING FOR DATABASE APPROVAL, if schema touched)
      → APPROVED → IN PROGRESS → IMPLEMENTED → TESTING
      → CODE REVIEW → VERIFIED → DOCUMENTED → COMPLETED
```

- **All work enters via `17_REQUESTS_AND_CHANGES/INBOX/`** as a plain markdown file (template in `98_TEMPLATES/REQUEST_TEMPLATE.md`). **INBOX ≠ APPROVED.**
- IDs: REQ-NNN · ADV-NNN (advisor) · BUG-NNN · FEAT-NNN — counters in `REQUEST_INDEX.md`, never reused.
- Who moves states: Hermes runs INBOX→PROPOSED; **Jerico alone** flips WAITING FOR APPROVAL→APPROVED; implementer runs APPROVED→TESTING; Cline runs CODE REVIEW→VERIFIED; Hermes closes DOCUMENTED→COMPLETED.
- Database change needed? → **STOP.** Write the full `## DATABASE CHANGE REQUIRED` block (problem, affected tables, exact SQL, risks, rollback) and set WAITING FOR DATABASE APPROVAL. Schema is **LOCKED** 🔒 — no ADD/DROP/ALTER without Jerico's explicit approval.
- Command phrase that triggers the full flow: *"Check 17_REQUESTS_AND_CHANGES/INBOX and implement the approved requests."* Skip anything not APPROVED.

## 6. How to use the vault (conventions)

- **Wikilinks:** notes link as `[[04_DATABASE/DATABASE_SCHEMA]]` — open the file at that path inside the vault folder.
- **Frontmatter:** every note starts with YAML (`project/type/status/last_updated`) — keep it updated when you edit.
- **History preservation:** never overwrite historical info. Record old → new + reason + date. Superseded notes go to `99_ARCHIVE/`; old bugs to FIXED_BUGS/REGRESSIONS; superseded ADRs stay in place with status `superseded`.
- **Logging:** after ANY change append to `13_LOGS/DEVELOPMENT_LOG.md` + `13_LOGS/AI_AGENT_LOG.md` (agent, model, files, result, approval). Test evidence → `13_LOGS/TESTING_LOG.md`. No new logging systems.
- **Honesty tags:** unknown → `[TO VERIFY]`; inferred → `[INFERRED FROM CODE]`. Never claim done/tested/verified without evidence. Implemented ≠ Tested ≠ Verified ≠ Production-ready.
- **Doc updates after implementation:** docs must describe the ACTUAL implemented state — update the affected Layer 1 notes as the final step of every request.

## 7. Hard stops — STOP and ask Jerico first

Schema DDL (any ADD/DROP/ALTER) · auth/RBAC changes · payment-logic changes · data deletion/migration · deleting files or functionality · touching secrets (PayMongo / Pusher / JWT / DB) · git push or production deploy · edits outside the approved request's scope · modifying `00_START_HERE/` or ADRs without approval.

## 8. Quick facts — THIS codebase

| Thing | Value |
|---|---|
| Role | **Working codebase — dev-first, AHEAD of group code.** Features land here first |
| Stack | PHP 8.x OOP · MySQL (PDO prepared statements only) · Pusher WebSockets · JWT HS256 (`hof_token` in localStorage) · Bootstrap 5 · SweetAlert2 · Chart.js |
| Local URL | `http://localhost/HouseOfFriesLiveDomain` |
| Production | https://house-of-fries.great-site.net (InfinityFree) |
| DB connection | **Read `backend/db.php` — never trust docs, never copy credentials into docs/commits/logs** |
| Pusher | channel `hof-orders` · working event **`new-order` ONLY** — `order.status_changed` is NOT sent by the backend (dead bindings; do not code against it) |
| Auth middleware | `backend/auth_middleware.php` → e.g. `authenticate(['Kitchen Staff','Admin','Supervisor'])` |
| Status enums | HYPHENS: `IN-PROGRESS`, `COOKING` — never underscores (exact strings per vault `04_DATABASE/ENUMS_AND_STATUSES.md`) |
| QR identity | `table_id` is canonical; `table_number` is a display label only |
| Landing page | `landing/` (Three.js + GSAP; menu via `backend/get_menu_for_landing.php`); FTPS redeploy tools in `HouseOfFries-Landing\tools\` |

**Sibling codebases:** `C:\xampp\htdocs\houseoffries_group_code` (published baseline, teammates') · `C:\xampp\htdocs\HouseOfFriesLocal` (older local backup).
**Deploy flow:** develop + test HERE on localhost → upload changed files to InfinityFree (cPanel) → test on the live domain → only then mark DONE with evidence.

## 9. First 5 minutes — recipes

**You are a NEW agent dropped into this repo:**
1. Read this file fully → 2. Open the vault, read §3's read order (files 1–5 minimum) → 3. Read `CURRENT_STATUS.md` → 4. Find your role in §4 → 5. If nobody assigned you a task: report what you found and wait. Do not "helpfully" edit anything.

**You are an implementer starting an APPROVED request:**
Read the request file in `17_REQUESTS_AND_CHANGES/` → follow REQUEST_EXECUTION_PROTOCOL → inspect real code first → implement the smallest safe change → `php -l` / `node --check` every changed file → test → record Implementation Result in the request → update logs.

**You are a reviewer (Cline):**
Read CODE_REVIEW_PROTOCOL → review ONLY work you didn't write → verify against the request's acceptance criteria + security checklist → produce classified findings + verdict (APPROVED / APPROVED+NOTES / CHANGES REQUIRED / BLOCKED) in the request file.

**You are Hermes or a coordination agent:**
Analyze INBOX items → write impact analysis + implementation plan into the request → set WAITING FOR APPROVAL → prepare handoff packages for Jerico to dispatch (text in `14_AI_AGENTS/HANDOFFS/`) → after VERIFIED: update docs + logs → COMPLETED.

---
*History: v1 (2026-09-08) replaced the legacy "Project Brain" AGENTS.md (archived at vault `99_ARCHIVE/AGENTS_LiveDomain_old_2026-09-08.md`). v2 (2026-09-08) added the full vault-usage guide: map, roles, lifecycle, conventions, per-agent recipes.*
