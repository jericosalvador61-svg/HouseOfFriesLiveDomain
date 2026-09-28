# Generate Code Button — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a visible **"Generate Code"** button inside the Add/Edit User modal that the admin can press any number of times to get a new 8-character code, and that code becomes the user's password on submit.

**Architecture:** A lightweight AJAX endpoint returns a fresh code. The button calls it on click, displays the code in a read-only field, and stores it in the hidden password input so the existing backend picks it up on submit.

**Tech Stack:** PHP (PDO/MySQL), vanilla JS, Bootstrap 5, SweetAlert2

---

## Current State

The existing system already has a `temp_code` / `must_change_password` flow. When the admin leaves the password field blank, the backend auto-generates a 6-character code. The user wants:

1. ✅ **A visible button** inside the form — not auto-generation on submit
2. ✅ **Press multiple times** — each press generates a new code
3. ✅ **The code is displayed** in a field so admin can see and copy it
4. ✅ **Code is 8 characters** (not 6)
5. ✅ **Works for both** Add User and Edit User (password reset)

---

## Step-by-Step Plan

### Task 1: Create AJAX endpoint for code generation

**Objective:** A lightweight PHP endpoint that returns a fresh 8-char temp code as JSON, callable from JS without form submit.

**Files:**
- Create: `backend/admin/manageUsers/generate_temp_code.php`

**Complete code:**

```php
<?php
require_once __DIR__ . '/temp_code_helper.php';

header('Content-Type: application/json');

$code = hof_generate_temp_code(8);

echo json_encode([
    'success' => true,
    'code'    => $code
]);
```

**Verification:**
```bash
curl -s http://localhost/backend/admin/manageUsers/generate_temp_code.php
# Expected: {"success":true,"code":"XK4P9M2B"}
```

---

### Task 2: Update generator to 8 characters

**Objective:** Change the default length from 6 to 8.

**Files:**
- Modify: `backend/admin/manageUsers/temp_code_helper.php:13`

```php
// Change line 13 from:
function hof_generate_temp_code($length = 6) {
// To:
function hof_generate_temp_code($length = 8) {
```

**Verification:**
```bash
php -r "require 'backend/admin/manageUsers/temp_code_helper.php'; echo hof_generate_temp_code();"
# Expected: 8-character string like "XK4P9M2B"
```

---

### Task 3: Add Generate Code UI to the Add/Edit modal

**Objective:** After the existing password input field, add a new row with a "Generate Code" button, a display field, and a copy button.

**Files:**
- Modify: `public/admin/manage_users.html`

**What to add** (insert after the password input group around line 400):

```html
<!-- GENERATE CODE ROW -->
<div class="mb-3" id="tempCodeRow" style="display:none;">
    <label class="form-label fw-semibold">
        <i class="bi bi-key-fill text-warning me-1"></i>First-Login Code
    </label>
    <div class="input-group">
        <input type="text" class="form-control font-monospace" id="generatedCodeDisplay"
               readonly placeholder="Click Generate Code below"
               style="font-size:1.1rem;letter-spacing:4px;background:#FFF9E6;">
        <button class="btn btn-outline-warning" type="button" id="btnGenerateCode" title="Generate new code">
            <i class="bi bi-arrow-clockwise"></i> Generate Code
        </button>
        <button class="btn btn-outline-secondary" type="button" id="btnCopyCode" title="Copy code">
            <i class="bi bi-clipboard"></i>
        </button>
    </div>
    <div class="form-text text-muted mt-1">
        Click <strong>Generate Code</strong> to create a random 8-character password.
        Give this code to the user. They must change it on first login.
    </div>
</div>
```

Also add a **"Reset password" checkbox** for the Edit modal (insert after the role field):

```html
<div class="form-check mb-3" id="resetPasswordRow">
    <input class="form-check-input" type="checkbox" id="resetPasswordCheck">
    <label class="form-check-label fw-semibold" for="resetPasswordCheck">
        <i class="bi bi-arrow-repeat text-warning me-1"></i> Reset password for this user
    </label>
</div>
```

---

### Task 4: Wire JavaScript — generate, display, copy, regenerate

**Objective:** Connect the button to the AJAX endpoint, show the code, allow re-generation, copy to clipboard.

**Files:**
- Modify: `javascript/admin/manage_users.js`

**Add inside `DOMContentLoaded`:**

```javascript
// ========== TEMP CODE GENERATOR ==========
const btnGenerateCode = document.getElementById('btnGenerateCode');
const btnCopyCode    = document.getElementById('btnCopyCode');
const codeDisplay    = document.getElementById('generatedCodeDisplay');
const passwordInput  = document.getElementById('password');
const tempCodeRow    = document.getElementById('tempCodeRow');
const resetCheck     = document.getElementById('resetPasswordCheck');
const resetRow       = document.getElementById('resetPasswordRow');

function generateCode() {
    if (!btnGenerateCode) return;
    btnGenerateCode.disabled = true;
    btnGenerateCode.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    fetch('/backend/admin/manageUsers/generate_temp_code.php')
        .then(r => r.json())
        .then(data => {
            if (data.success && data.code) {
                codeDisplay.value = data.code;
                passwordInput.value = data.code;
                passwordInput.dataset.generated = 'true';
            } else {
                Swal.fire('Error', 'Failed to generate code', 'error');
            }
        })
        .catch(() => Swal.fire('Error', 'Network error generating code', 'error'))
        .finally(() => {
            btnGenerateCode.disabled = false;
            btnGenerateCode.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Generate Code';
        });
}

function copyGeneratedCode() {
    if (!codeDisplay || !codeDisplay.value) return;
    navigator.clipboard.writeText(codeDisplay.value).then(() => {
        const orig = btnCopyCode.innerHTML;
        btnCopyCode.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
        setTimeout(() => { btnCopyCode.innerHTML = orig; }, 1500);
    });
}

// Wire buttons
if (btnGenerateCode) btnGenerateCode.addEventListener('click', generateCode);
if (btnCopyCode) btnCopyCode.addEventListener('click', copyGeneratedCode);

// Show code row on Add modal open
if (addUserModalEl) {
    addUserModalEl.addEventListener('show.bs.modal', () => {
        if (tempCodeRow) tempCodeRow.style.display = '';
        if (resetRow) resetRow.style.display = 'none'; // hide reset checkbox on Add
        if (resetCheck) resetCheck.checked = false;
        if (passwordInput) { passwordInput.value = ''; delete passwordInput.dataset.generated; }
        if (codeDisplay) codeDisplay.value = '';
    });
}

// Reset checkbox on Edit modal — show/hide code row
if (resetCheck && tempCodeRow) {
    resetCheck.addEventListener('change', () => {
        tempCodeRow.style.display = resetCheck.checked ? '' : 'none';
        if (!resetCheck.checked) {
            passwordInput.value = '';
            delete passwordInput.dataset.generated;
            if (codeDisplay) codeDisplay.value = '';
        }
    });
}

// Listen for Edit modal open — show reset checkbox, hide code row initially
// (use mutation observer or event delegation on the edit button clicks)
```

**Also update `openAddUserModal`** — clear fields:

```javascript
function openAddUserModal() {
    passwordInput.value = '';
    delete passwordInput.dataset.generated;
    if (codeDisplay) codeDisplay.value = '';
    if (tempCodeRow) tempCodeRow.style.display = '';
    if (resetRow) resetRow.style.display = 'none';
    // ... existing code ...
}
```

**Also update `openEditUserModal`** — show reset checkbox, hide code row:

```javascript
function openEditUserModal(user) {
    if (resetRow) resetRow.style.display = '';
    if (resetCheck) resetCheck.checked = false;
    if (tempCodeRow) tempCodeRow.style.display = 'none';
    passwordInput.value = '';
    delete passwordInput.dataset.generated;
    if (codeDisplay) codeDisplay.value = '';
    // ... existing code ...
}
```

---

### Task 5: Update `add_user.php` — use generated code from form

**Objective:** If the admin generated a code via the button, the password field is already filled. Use it directly instead of auto-generating on submit.

**Files:**
- Modify: `backend/admin/manageUsers/add_user.php`

**Change lines 27-33:**

```php
// Before:
if ($password === '') {
    $tempPassword = hof_generate_temp_code(6);
} else {
    $tempPassword = $password;
}

// After:
if ($password === '') {
    $tempPassword = hof_generate_temp_code(8);
} else {
    $tempPassword = $password;
}
```

The rest of the file already hashes it and stores it in `temp_code` + `must_change_password = 1`.

---

### Task 6: Verify `update_user.php` already works

**Files:**
- Verify: `backend/admin/manageUsers/update_user.php`

The existing code at lines 76-100 already handles this:

```php
if ($hashedPassword) {
    $fields .= ", password = :password, must_change_password = 1, temp_code = :temp_code";
    $mustChangePassword = true;
}
```

When the password field has a generated code, it hashes it, stores it, and sets `must_change_password = 1`. **No changes needed.**

---

## User Flow

### Creating a new account
```
Admin clicks "Add New Staff"
  → Modal opens
  → Admin fills username, role, etc.
  → Admin clicks "Generate Code" button
  → "XK4P9M2B" appears in the display field
  → Admin clicks again → "3N7RQ1KZ" → old code replaced
  → Admin clicks Copy → gives code to user
  → Admin submits
  → User created with password = XK4P9M2B
  → User logs in → forced to change password
```

### Resetting an existing user's password
```
Admin clicks Edit on a user
  → Modal opens
  → Admin checks "Reset password for this user"
  → Generate Code row appears
  → Admin clicks Generate Code → new code
  → Admin copies and gives to user
  → Admin submits
  → User's password updated, must_change_password = 1
  → User logs in with new code → forced to change
```

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `backend/admin/manageUsers/generate_temp_code.php` | **NEW** | AJAX endpoint returning fresh 8-char code |
| `backend/admin/manageUsers/temp_code_helper.php` | Modify (1 line) | `$length = 6` → `$length = 8` |
| `public/admin/manage_users.html` | Modify | Add Generate Code row + reset password checkbox in the modal |
| `javascript/admin/manage_users.js` | Modify (~40 lines) | Wire AJAX, copy, show/hide logic, modal reset |
| `backend/admin/manageUsers/add_user.php` | Modify (1 line) | `hof_generate_temp_code(6)` → `hof_generate_temp_code(8)` |
| `backend/admin/manageUsers/update_user.php` | No change | Already handles password reset |

---

## Risks & Tradeoffs

| Risk | Mitigation |
|------|-----------|
| Admin closes modal without saving — code is lost | No problem — not stored in DB until submit |
| User generates many codes (spam) | No rate limit needed — admin-only, lightweight |
| 8-char code harder to type on phone | Alphabet excludes ambiguous chars (I/O/0/1) — same as before |
| Existing 6-char codes still pending | They remain valid — already in DB. Only new codes are 8 chars |

---

## Verification Checklist

- [ ] `generate_temp_code.php` returns valid JSON with 8-char code
- [ ] Clicking "Generate Code" in Add modal shows code in display field
- [ ] Generated code is also stored in the hidden password field
- [ ] Clicking Generate again replaces the previous code
- [ ] Copy button copies the displayed code
- [ ] Reset password checkbox in Edit modal shows/hides the Generate Code row
- [ ] New user can log in with the generated code
- [ ] New user is forced to change password on first login
- [ ] After password change, code badge disappears from admin table
- [ ] Password reset via generated code works for existing users

---

**Plan complete and saved. Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?**