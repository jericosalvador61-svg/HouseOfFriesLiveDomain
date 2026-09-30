# Orca Demo — Practice Session

> Created by OpenCode in the `practive-demo` worktree. Reviewed by Cline. Committed and pushed for Jerico to verify.

## What this demonstrates

- Orca-managed worktree `practive-demo` (branch `jericosalvador61-svg/practive-demo`)
- Agent handoff: OpenCode implements -> Cline reviews -> commit -> push
- Review comment integration so Jerico can see the Cline verdict in git

## House of Fries — tech stack recap

| Layer | Tech |
|---|---|
| Backend | PHP 8.x OOP, PDO prepared statements |
| Realtime | Pusher (`hof-orders`, events `new-order`, `order-status-changed`) |
| Auth | JWT HS256 (`hof_token` in localStorage + cookie; read server-side by `auth_middleware.php` / `page_gate.php`) |
| Frontend | Bootstrap 5, SweetAlert2, Chart.js |
| Landing | Three.js + GSAP |

## Review status

- [x] Reviewed by Cline (independent reviewer) — verdict below

## Cline verdict

**CHANGES REQUIRED** (doc-only, applied by OpenCode and re-submitted).
_Recorded by Cline (independent reviewer)._
