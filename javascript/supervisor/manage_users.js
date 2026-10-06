document.addEventListener("DOMContentLoaded", () => {
    // JWT auth helper — same pattern as manage_menu.js (fixes 401 on CRUD)
    function getAuthToken() {
        return localStorage.getItem('hof_token') || '';
    }
    function authFetch(url, options = {}) {
        const token = getAuthToken();
        const headers = options.headers || {};
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        options.headers = headers;
        return fetch(url, options);
    }

    const API = {
        roles: "../../backend/admin/manageUsers/fetch_roles.php",
        users: "../../backend/admin/manageUsers/fetch_users.php"
    };

    let roles = [];
    let users = [];

    const addUserBtn = document.getElementById("btnAddUser");
    const addUserForm = document.getElementById("addUserForm");
    const usersTableBody = document.getElementById("usersTableBody");
    const searchInput = document.getElementById("searchUser");
    const roleSelect = document.getElementById("roleId");
    const passwordInput = document.getElementById("password");
    const passwordHint = document.getElementById("passwordHint");
    const passwordInfo = document.getElementById("passwordInfo");
    const codeDisplay    = document.getElementById("generatedCodeDisplay");
    const btnGenerateCode = document.getElementById("btnGenerateCode");
    const btnCopyCode     = document.getElementById("btnCopyCode");
    const tempCodeRow     = document.getElementById("tempCodeRow");
    const resetCheck      = document.getElementById("resetPasswordCheck");
    const resetRow        = document.getElementById("resetPasswordRow");

    // Filter & pagination elements
    const filterRole = document.getElementById("filterRole");
    const filterStatus = document.getElementById("filterStatus");
    const clearFiltersBtn = document.getElementById("clearFiltersBtn");
    const paginationInfo = document.getElementById("paginationInfo");
    const prevPage = document.getElementById("prevPage");
    const nextPage = document.getElementById("nextPage");

    const ITEMS_PER_PAGE = 10;
    let currentPage = 1;

    const addUserModalEl = document.getElementById("addUserModal");
    let addUserModal = null;
    if (addUserModalEl) {
        addUserModal = new bootstrap.Modal(addUserModalEl, { backdrop: 'static', keyboard: false });
    }

    async function fetchRoles() {
        // Supervisor build has no #roleId select (the add/edit modal was removed),
        // so the early-out must be keyed on the FILTER dropdown, not roleSelect.
        if (!roleSelect && !filterRole) return;
        try {
            const res = await authFetch(API.roles);
            roles = await res.json();
            if (roleSelect) {
                roleSelect.innerHTML = `<option value="">Select role</option>`;
                roles.forEach(r => {
                    const opt = document.createElement("option");
                    opt.value = r.role_id;
                    opt.textContent = r.role_name;
                    roleSelect.appendChild(opt);
                });
            }
            // Also populate the filter dropdown
            if (filterRole) {
                filterRole.innerHTML = `<option value="">All Roles</option>`;
                roles.forEach(r => {
                    const opt = document.createElement("option");
                    opt.value = r.role_id;
                    opt.textContent = r.role_name;
                    filterRole.appendChild(opt);
                });
            }
        } catch (err) {
            console.error("Failed to fetch roles:", err);
        }
    }

    async function fetchUsers() {
        if (!usersTableBody) return;
        try {
            const res = await authFetch(API.users);
            users = await res.json();
            currentPage = 1;
            applyFiltersAndRender();
        } catch (err) {
            console.error("Failed to fetch users:", err);
        }
    }

    function renderUsers(list) {
        if (!usersTableBody) return;
        usersTableBody.innerHTML = "";

        if (!list.length) {
            usersTableBody.innerHTML = `
                <tr><td colspan="6" class="text-center text-muted">No users found</td></tr>
            `;
            return;
        }

        list.forEach(u => {
            const tr = document.createElement("tr");
            const pendingCode = (u.must_change_password == 1 && u.temp_code)
                ? `<div class="d-flex align-items-center gap-1 mt-1">
                       <span class="badge bg-warning text-dark" style="font-family:monospace;letter-spacing:2px;" title="Pending first-login code">${u.temp_code}</span>
                       <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1" style="font-size:.65rem;"
                           onclick="navigator.clipboard.writeText('${u.temp_code}').then(()=>{event.target.innerHTML='Copied';setTimeout(()=>event.target.innerHTML='Copy',1200)})">Copy</button>
                   </div>`
                : '';
            tr.innerHTML = `
                <td>${u.username}${pendingCode}</td>
                <td>${u.first_name} ${u.last_name}</td>
                <td>${u.role_name}</td>
                <td>${u.contact_number || "-"}</td>
                <td><span class="badge ${u.status === 'Active' ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}">${u.status}</span>
                    ${u.must_change_password == 1 ? '<div><span class="badge bg-warning-subtle text-warning-emphasis mt-1" style="font-size:.62rem;">CODE PENDING</span></div>' : ''}
                </td>
            `;
            usersTableBody.appendChild(tr);
        });
    }

    function applyFiltersAndRender() {
        const q = searchInput ? searchInput.value.toLowerCase() : "";
        const roleId = filterRole ? filterRole.value : "";
        const status = filterStatus ? filterStatus.value : "";

        let filtered = users;

        // Search filter
        if (q) {
            filtered = filtered.filter(u =>
                (u.username && u.username.toLowerCase().includes(q)) ||
                (u.role_name && u.role_name.toLowerCase().includes(q)) ||
                (u.first_name && u.first_name.toLowerCase().includes(q)) ||
                (u.last_name && u.last_name.toLowerCase().includes(q))
            );
        }

        // Role filter
        if (roleId) {
            filtered = filtered.filter(u => String(u.role_id) === String(roleId));
        }

        // Status filter
        if (status) {
            filtered = filtered.filter(u => u.status === status);
        }

        // Pagination
        const totalItems = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));

        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIdx = startIdx + ITEMS_PER_PAGE;
        const pageItems = filtered.slice(startIdx, endIdx);

        renderUsers(pageItems);
        updatePagination(totalItems, totalPages);
    }

    function updatePagination(totalItems, totalPages) {
        if (!paginationInfo) return;
        const start = totalItems ? ((currentPage - 1) * ITEMS_PER_PAGE) + 1 : 0;
        const end = Math.min(currentPage * ITEMS_PER_PAGE, totalItems);
        paginationInfo.textContent = `Showing ${start}-${end} of ${totalItems} users`;

        // Prev / Next buttons
        if (prevPage) {
            prevPage.parentElement.classList.toggle("disabled", currentPage <= 1);
        }
        if (nextPage) {
            nextPage.parentElement.classList.toggle("disabled", currentPage >= totalPages);
        }

        // Page number buttons
        const paginationControls = document.getElementById("paginationControls");
        if (!paginationControls) return;

        // Remove old page number buttons (keep first and last li)
        const items = paginationControls.querySelectorAll("li:not(:first-child):not(:last-child)");
        items.forEach(li => li.remove());

        const prevLi = paginationControls.querySelector("li:first-child");
        if (!prevLi) return;

        for (let i = 1; i <= totalPages; i++) {
            const li = document.createElement("li");
            li.className = `page-item${i === currentPage ? " active" : ""}`;
            const a = document.createElement("a");
            a.className = "page-link";
            a.href = "#";
            a.textContent = i;
            a.dataset.page = i;
            a.addEventListener("click", (e) => {
                e.preventDefault();
                if (currentPage !== i) {
                    currentPage = i;
                    applyFiltersAndRender();
                }
            });
            li.appendChild(a);
            // FIX (REQ-063): insert before the last <li> (Next) — the old
            // prevLi.nextSibling re-inserted in front of the prior number,
            // rendering the pager REVERSED ("Previous 2 1 Next").
            paginationControls.insertBefore(li, paginationControls.querySelector("li:last-child"));
        }
    }

    function openAddUserModal() {
        if (!addUserModal) return;
        document.getElementById("userModalTitle").textContent = "Add New User";
        document.getElementById("userSubmitBtn").textContent = "Add User";
        addUserForm.reset();
        document.getElementById("editUserId").value = '';
        document.getElementById("username").readOnly = false;
        passwordInput.required = false;
        passwordInput.placeholder = "Click Generate Code below";
        passwordHint.textContent = "(click Generate Code to create a random 8-character password)";
        passwordInfo.textContent = "The code is shown below. Give it to the user. They must change it on first login.";
        if (tempCodeRow) tempCodeRow.style.display = '';
        if (resetRow) resetRow.style.display = 'none';
        if (resetCheck) resetCheck.checked = false;
        if (codeDisplay) codeDisplay.value = '';
        passwordInput.value = '';
        delete passwordInput.dataset.generated;
        addUserModal.show();
    }

    function openEditUserModal(user) {
        if (!addUserModal) return;
        document.getElementById("userModalTitle").textContent = "Edit User";
        document.getElementById("userSubmitBtn").textContent = "Update User";
        document.getElementById("editUserId").value = user.user_id;
        document.getElementById("username").value = user.username;
        passwordInput.value = '';
        document.getElementById("firstName").value = user.first_name;
        document.getElementById("lastName").value = user.last_name;
        document.getElementById("gender").value = user.gender;
        document.getElementById("contactNumber").value = user.contact_number;
        document.getElementById("emailAddress").value = user.email_address;
        document.getElementById("socialAccount").value = user.social_account;
        document.getElementById("roleId").value = user.role_id;
        document.getElementById("status").value = user.status;
        document.getElementById("username").readOnly = true;
        passwordInput.required = false;
        passwordInput.placeholder = "Type a new code to reset, or click Generate Code below";
        passwordHint.textContent = "(leave blank to keep current, click Generate Code to create a new 8-character password)";
        passwordInfo.textContent = "⚠️ Resetting the password will require the user to change it on next login. The code stays visible here until they do.";
        if (resetRow) resetRow.style.display = '';
        if (resetCheck) resetCheck.checked = false;
        if (tempCodeRow) tempCodeRow.style.display = 'none';
        if (codeDisplay) codeDisplay.value = '';
        passwordInput.value = '';
        delete passwordInput.dataset.generated;
        addUserModal.show();
    }

    if (usersTableBody) {
        // Supervisor build is READ-ONLY: the Edit/Delete buttons are not rendered
        // (add_user.php / update_user.php / delete_user.php / generate_temp_code.php
        // are all Admin-only on the backend), so no write handler is wired here.
        usersTableBody.addEventListener("click", async (e) => {
            const editBtn = e.target.closest(".edit-btn");
            const deleteBtn = e.target.closest(".delete-btn");

            if (editBtn || deleteBtn) {
                await Swal.fire({
                    title: 'Read-only access',
                    text: 'Supervisors can view the staff list but cannot create, edit or deactivate accounts.',
                    icon: 'info'
                });
            }
        });
    }
    if (addUserForm) {
        addUserForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            // Client-side email validation
            var emailInput = document.getElementById('emailAddress');
            if (emailInput) {
                var email = emailInput.value.trim();
                if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    Swal.fire({ icon: 'error', title: 'Invalid Email', text: 'Please enter a valid email address (e.g., name@domain.com)' });
                    return;
                }
            }

            const formData = new FormData(addUserForm);
            const userId = document.getElementById("editUserId").value;
            const url = userId
                ? "../../backend/admin/manageUsers/update_user.php"
                : "../../backend/admin/manageUsers/add_user.php";

            const submitBtn = addUserForm.querySelector('button[type="submit"]');
            LoadingManager.show(submitBtn || addUserForm, { text: 'Saving...' });

            try {
                const res = await authFetch(url, { method: "POST", body: formData });
                const result = await res.json();

                if (!result.success) {
                    return Swal.fire('Error!', result.message, 'error');
                }

                if (addUserModal) addUserModal.hide();
                addUserForm.reset();
                fetchUsers();

                if (result.temp_password) {
                    Swal.fire({
                        title: 'User Created!',
                        icon: 'success',
                        html: `
                            <p class="mb-2">Share this <b>temporary password</b> with the user:</p>
                            <div class="d-flex align-items-center justify-content-center gap-2 mb-3">
                                <span id="tempPassCode" style="font-family:monospace;font-size:1.9rem;font-weight:800;letter-spacing:6px;background:#FFF9E6;border:2px dashed #ffc107;border-radius:12px;padding:8px 18px;color:#331A11;">${result.temp_password}</span>
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="navigator.clipboard.writeText('${result.temp_password}').then(()=>{const b=event.target;b.innerHTML='Copied!';setTimeout(()=>b.innerHTML='Copy',1500);})">Copy</button>
                            </div>
                            <small class="text-muted d-block">This code stays visible in the Staff list until the user logs in and sets a new password
                            (min. 6 chars, 1 uppercase, 1 number, 1 special character).</small>`,
                        confirmButtonColor: '#ffc107',
                        confirmButtonText: 'Done'
                    });
                } else if (result.must_change_password) {
                    Swal.fire({
                        title: 'Success!',
                        html: `User updated successfully!<br><small class="text-muted">Password has been reset. User must change it on next login.</small>`,
                        icon: 'success'
                    });
                } else {
                    Swal.fire('Success!', 'User saved successfully!', 'success');
                }
            } catch (err) {
                Swal.fire('Error!', 'Something went wrong.', 'error');
            } finally {
                LoadingManager.hide(submitBtn || addUserForm);
            }
        });
    }

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    // Filter by Role
    if (filterRole) {
        filterRole.addEventListener("change", () => {
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    // Filter by Status
    if (filterStatus) {
        filterStatus.addEventListener("change", () => {
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    // Clear Filters
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            if (filterRole) filterRole.value = "";
            if (filterStatus) filterStatus.value = "";
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    // Pagination: Previous
    if (prevPage) {
        prevPage.addEventListener("click", (e) => {
            e.preventDefault();
            if (currentPage > 1) {
                currentPage--;
                applyFiltersAndRender();
            }
        });
    }

    // Pagination: Next
    if (nextPage) {
        nextPage.addEventListener("click", (e) => {
            e.preventDefault();
            const totalItems = getFilteredCount();
            const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
            if (currentPage < totalPages) {
                currentPage++;
                applyFiltersAndRender();
            }
        });
    }

    // Helper to get filtered count for pagination
    function getFilteredCount() {
        const q = searchInput ? searchInput.value.toLowerCase() : "";
        const roleId = filterRole ? filterRole.value : "";
        const status = filterStatus ? filterStatus.value : "";
        let filtered = users;
        if (q) {
            filtered = filtered.filter(u =>
                (u.username && u.username.toLowerCase().includes(q)) ||
                (u.role_name && u.role_name.toLowerCase().includes(q)) ||
                (u.first_name && u.first_name.toLowerCase().includes(q)) ||
                (u.last_name && u.last_name.toLowerCase().includes(q))
            );
        }
        if (roleId) {
            filtered = filtered.filter(u => String(u.role_id) === String(roleId));
        }
        if (status) {
            filtered = filtered.filter(u => u.status === status);
        }
        return filtered.length;
    }

    if (addUserBtn) {
        addUserBtn.addEventListener("click", openAddUserModal);
    }

    // ========== TEMP CODE GENERATOR ==========
    function generateCode() {
        if (!btnGenerateCode) return;
        btnGenerateCode.disabled = true;
        btnGenerateCode.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        authFetch('../../backend/admin/manageUsers/generate_temp_code.php')
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

    if (btnGenerateCode) btnGenerateCode.addEventListener('click', generateCode);
    if (btnCopyCode) btnCopyCode.addEventListener('click', copyGeneratedCode);

    // Reset checkbox — show/hide the Generate Code row on Edit
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

    fetchRoles();
    fetchUsers();
});
