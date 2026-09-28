# Auto-Generated Password Code Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Change the existing admin `manage_users.html` first-login code system from 6-character to **8-character randomly generated codes**, displayed prominently beside the username with a clean copy button, for use on first login.

**Architecture:** The system already has a `temp_code` / `must_change_password` flow. The plan extends it: backend generates 8-char codes, frontend shows them inline with a better UX. The code is the user's first-login password.

**Tech Stack:** PHP (PDO/MySQL), vanilla JS, Bootstrap 5, SweetAlert2

---

## Current State (what exists)

The codebase **already has** a temp-code system:

| Piece | File | Current |
|-------|------|---------|
| Generator | `backend/admin/manageUsers/temp_code_helper.php` | `hof_generate_temp_code(6)` — 6 chars |
| Backend add | `add_user.php` | Generates 6-char code, stores in `temp_code` column, `must_change_password=1` |
| Backend update | `update_user.php` | On password reset, stores new code as `temp_code` |
| Backend fetch | `fetch_users.php` | Returns `temp_code` when `must_change_password=1` |
| JS display | `manage_users.js` (lines 86-93) | Shows `<badge>` + Copy button below username in table |
| JS modal | `manage_users.js` (lines 311-323) | Shows `tempPassword` in Swal alert with Copy button |

**What the user wants changed:**
1. Code length: **6 → 8 characters**
2. Display: The code badge should sit **beside** the username inline (not below), with a clean copy icon
3. The code is what the user types on their first login (already works)

---

## Proposed Changes

### Task 1: Update temp_code_helper.php — 6 → 8 characters

**Objective:** Change the code generator to produce 8-character codes.

**Files:**
- Modify: `backend/admin/manageUsers/temp_code_helper.php:13`

**Step 1: Change length parameter**

```php
// Change default from 6 to 8
function hof_generate_temp_code($length = 8) {
```

**Step 2: Verify**

```bash
php -r "require 'backend/admin/manageUsers/temp_code_helper.php'; echo hof_generate_temp_code();"
// Expected: 8-character string like "XK4P9M2B"
```

**Step 3: Commit**

```bash
git add backend/admin/manageUsers/temp_code_helper.php
git commit -m "feat: increase temp code from 6 to 8 characters"
```

---

### Task 2: Update JS display — inline code badge beside username

**Objective:** Make the temp code display inline beside the username with a cleaner copy button, instead of below it.

**Files:**
- Modify: `javascript/admin/manage_users.js:86-94`

**Current code (lines 86-94):**
```javascript
const pendingCode = (u.must_change_password == 1 && u.temp_code)
    ? `<div class="d-flex align-items-center gap-1 mt-1">
           <span class="badge bg-warning text-dark" style="font-family:monospace;letter-spacing:2px;" title="Pending first-login code">${u.temp_code}</span>
           <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1" style="font-size:.65rem;"
               onclick="navigator.clipboard.writeText('${u.temp_code}').then(()=>{event.target.innerHTML='Copied';setTimeout(()=>event.target.innerHTML='Copy',1200)})">Copy</button>
       </div>`
    : '';
```

**Step 1: Rewrite to inline display**

Replace the pendingCode variable with inline HTML:

```javascript
const pendingCode = (u.must_change_password == 1 && u.temp_code)
    ? `<span class="badge bg-warning text-dark ms-2" style="font-family:monospace;font-size:0.75rem;letter-spacing:3px;padding:3px 8px;border-radius:6px;cursor:pointer;" 
           title="Click to copy first-login code"
           onclick="navigator.clipboard.writeText('${u.temp_code}').then(()=>{const el=event.currentTarget;el.textContent='Copied!';el.className='badge bg-success text-white ms-2';setTimeout(()=>{el.textContent='${u.temp_code}';el.className='badge bg-warning text-dark ms-2';},1800)})">
           <i class="bi bi-files me-1" style="font-size:0.65rem;"></i>${u.temp_code}
       </span>`
    : '';
```

This makes the badge itself clickable — no separate Copy button needed. The badge sits inline beside the username on the same row.

**Step 2: Update the username table cell to use flexbox**

The username `<td>` currently renders:
```html
<td>${u.username}${pendingCode}</td>
```

Change to:
```html
<td>
    <div class="d-flex align-items-center flex-nowrap">
        <span style="white-space:nowrap;">${u.username}</span>
        ${pendingCode}
    </div>
</td>
```

**Step 3: Update the Swal modal (lines 311-323) — keep 8-char code display**

The existing Swal alert already shows the code with a nice copy button. Just update the inline style to match the new 8-char width:

```javascript
// Line 318 — increase font size and spacing for 8 chars
<span id="tempPassCode" style="font-family:monospace;font-size:2rem;font-weight:800;letter-spacing:8px;background:#FFF9E6;border:2px dashed #ffc107;border-radius:12px;padding:10px 22px;color:#331A11;">${result.temp_password}</span>
```

**Step 4: Commit**

```bash
git add javascript/admin/manage_users.js
git commit -m "feat: inline temp code display with click-to-copy badge"
```

---

### Task 3: Update the "CODE PENDING" status badge styling

**Objective:** The second status badge ("CODE PENDING" below the Active/Inactive badge) should also be updated for consistency.

**Files:**
- Modify: `javascript/admin/manage_users.js:101`

**Current:**
```javascript
{u.must_change_password == 1 ? '<div><span class="badge bg-warning-subtle text-warning-emphasis mt-1" style="font-size:.62rem;">CODE PENDING</span></div>' : ''}
```

**Change to:**
```javascript
{u.must_change_password == 1 ? '<div><span class="badge bg-warning-subtle text-warning-emphasis mt-1" style="font-size:.65rem;letter-spacing:1px;">🔑 FIRST LOGIN PENDING</span></div>' : ''}
```

This makes the label clearer — "FIRST LOGIN PENDING" is more descriptive than "CODE PENDING".

---

### Task 4: Verify the full flow end-to-end

**Objective:** Confirm the 8-char code works through the entire lifecycle.

**Step 1: Add a new user as admin**
- Open `admin/manage_users.html`
- Click "Add New Staff"
- Fill in username, role, leave password blank
- Submit → Should see 8-char code in the Swal alert
- Verify the code appears as a clickable badge beside the username in the table

**Step 2: Logout and login as the new user**
- Go to login page
- Enter the username and the 8-char code
- Should be prompted to change password
- Verify the new password meets requirements (min. 6 chars, 1 uppercase, 1 number, 1 special character)

**Step 3: Verify admin view after first login**
- Log back in as admin
- Go to manage_users.html
- Verify the user's code badge is gone (because `must_change_password` is now 0)
- Verify status is still Active

---

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `backend/admin/manageUsers/temp_code_helper.php` | Modify (line 13) | 1 line changed |
| `javascript/admin/manage_users.js` | Modify (lines 86-94, 101, 318) | ~15 lines changed |

**No new files needed.** The existing system already has the full flow — we're just improving the UX and making the code longer.

---

## Risks & Tradeoffs

| Risk | Mitigation |
|------|-----------|
| Existing users with 6-char temp codes still pending | Their codes remain valid — they were already stored in the DB. Only new users get 8-char codes. |
| 8-char code harder to type on phone | The alphabet excludes ambiguous chars (I/O/0/1) — same as before. 8 chars is still manageable. |
| Click-to-copy badge might confuse users who expect a separate Copy button | The badge has a `cursor:pointer` style and a clipboard icon (`bi-files`). The onclick changes to "Copied!" with green background as feedback. |

---

## Open Questions

None. The requirement is clear and the existing infrastructure supports it fully.

---

## Verification Checklist

- [ ] `hof_generate_temp_code()` produces 8 characters (not 6)
- [ ] Add user → 8-char code shown in Swal with Copy button
- [ ] Code badge appears inline beside username in table
- [ ] Clicking the badge copies the code to clipboard
- [ ] Using the 8-char code on login works (triggers first-login password change)
- [ ] After first login, code badge disappears from admin table
- [ ] Update/reset password for an existing user → new 8-char code generated