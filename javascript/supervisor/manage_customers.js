/**
 * javascript/supervisor/manage_customers.js
 * REQ-052 Batch 3 — Supervisor manage-customers page (list/search, toggle
 * is_active, generate password-reset code).
 * Mirrors javascript/admin/manage_customers.js against the shared backend
 * endpoints (backend/admin/customer_manage + customer_reset).
 */
document.addEventListener("DOMContentLoaded", () => {
    'use strict';

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function getAuthToken() {
        return localStorage.getItem('hof_token') || '';
    }
    function authFetch(url, options = {}) {
        const token = getAuthToken();
        const headers = options.headers || {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        options.headers = headers;
        return fetch(url, options);
    }

    const API = {
        list: "../../backend/admin/customer_manage/list_customers.php",
        create: "../../backend/admin/customer_manage/create_customer.php",
        toggle: "../../backend/admin/customer_manage/toggle_customer.php",
        reset: "../../backend/admin/customer_reset/generate_reset_code.php"
    };

    let customers = [];
    let currentPage = 1;
    const ITEMS_PER_PAGE = 10;

    const tableBody = document.getElementById("customersTableBody");
    const searchInput = document.getElementById("searchCustomer");
    const topSearchInput = document.getElementById("topSearchCustomer");
    const filterStatus = document.getElementById("filterStatus");
    const clearFiltersBtn = document.getElementById("clearFiltersBtn");
    const paginationInfo = document.getElementById("paginationInfo");
    const prevPage = document.getElementById("prevPage");
    const nextPage = document.getElementById("nextPage");

    const btnAddCustomer = document.getElementById("btnAddCustomer");
    const addCustomerForm = document.getElementById("addCustomerForm");
    const customerName = document.getElementById("customerName");
    const customerPhone = document.getElementById("customerPhone");
    const addCustomerModalEl = document.getElementById("addCustomerModal");
    let addCustomerModal = null;
    if (addCustomerModalEl) addCustomerModal = new bootstrap.Modal(addCustomerModalEl);

    async function fetchCustomers() {
        if (!tableBody) return;
        try {
            const res = await authFetch(API.list);
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Failed to load customers');
            customers = data.customers || [];
            currentPage = 1;
            applyFiltersAndRender();
        } catch (err) {
            console.error("Failed to fetch customers:", err);
            if (tableBody) tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Failed to load customers.</td></tr>';
        }
    }

    function renderCustomers(list) {
        if (!tableBody) return;
        tableBody.innerHTML = "";

        if (!list.length) {
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No customers found</td></tr>';
            return;
        }

        list.forEach(c => {
            const tr = document.createElement("tr");
            const isActive = String(c.is_active) === '1';
            const statusBadge = isActive
                ? '<span class="badge bg-success-subtle text-success">Active</span>'
                : '<span class="badge bg-danger-subtle text-danger" title="Locked / deactivated">Locked</span>';
            const created = c.created_at ? new Date(c.created_at + 'Z').toLocaleDateString('en-PH') : '—';
            const ordersCount = (c.paid_orders_count ? c.paid_orders_count : 0)
                + (c.orders_count && c.orders_count > (c.paid_orders_count || 0) ? ' (' + c.orders_count + ' total)' : '');

            tr.innerHTML = `
                <td class="px-3 py-3 fw-semibold">${escapeHtml(c.phone_number)}</td>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(ordersCount)}</td>
                <td>${escapeHtml(created)}</td>
                <td>${statusBadge}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-warning btn-reset me-1" data-id="${escapeHtml(c.customer_id)}" data-phone="${escapeHtml(c.phone_number)}" title="Generate reset code">
                        <i class="bi bi-key"></i> Reset Code
                    </button>
                    <button class="btn btn-sm ${isActive ? 'btn-outline-danger' : 'btn-outline-success'} btn-toggle" data-id="${escapeHtml(c.customer_id)}" data-active="${isActive ? '1' : '0'}" title="${isActive ? 'Deactivate / Lock' : 'Reactivate'}">
                        <i class="bi bi-${isActive ? 'x-circle' : 'check-circle'}"></i> ${isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function applyFiltersAndRender() {
        const q = ((searchInput && searchInput.value) || (topSearchInput && topSearchInput.value) || '').toLowerCase();
        const status = filterStatus ? filterStatus.value : "";

        let filtered = customers;
        if (q) {
            filtered = filtered.filter(c =>
                (c.name && c.name.toLowerCase().includes(q)) ||
                (c.phone_number && c.phone_number.toLowerCase().includes(q))
            );
        }
        if (status !== '') {
            const wantActive = status === '1';
            filtered = filtered.filter(c => (String(c.is_active) === '1') === wantActive);
        }

        const totalItems = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
        if (currentPage > totalPages) currentPage = totalPages;

        const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
        const pageItems = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);

        renderCustomers(pageItems);
        updatePagination(totalItems, totalPages);
    }

    function updatePagination(totalItems, totalPages) {
        if (!paginationInfo) return;
        const start = totalItems ? ((currentPage - 1) * ITEMS_PER_PAGE) + 1 : 0;
        const end = Math.min(currentPage * ITEMS_PER_PAGE, totalItems);
        paginationInfo.textContent = `Showing ${start}-${end} of ${totalItems} customers`;

        if (prevPage) prevPage.parentElement.classList.toggle("disabled", currentPage <= 1);
        if (nextPage) nextPage.parentElement.classList.toggle("disabled", currentPage >= totalPages);

        const controls = document.getElementById("paginationControls");
        if (!controls || !prevPage) return;
        const items = controls.querySelectorAll("li:not(:first-child):not(:last-child)");
        items.forEach(li => li.remove());
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
                currentPage = i;
                applyFiltersAndRender();
            });
            li.appendChild(a);
            controls.insertBefore(li, prevPage.nextSibling);
        }
    }

    async function generateResetCode(customerId, phone) {
        try {
            const confirm = await Swal.fire({
                title: 'Generate Reset Code',
                text: 'Generate a 15-minute password-reset code for ' + phone + '?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#ffc107',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Generate'
            });
            if (!confirm.isConfirmed) return;
            const res = await authFetch(API.reset, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            if (!data.success) {
                return Swal.fire('Error', data.message || 'Could not generate a reset code.', 'error');
            }
            Swal.fire({
                title: 'Reset Code',
                html: (data.code
                    ? 'Give this code to the customer. It expires in <b>15 minutes</b> and can be used once.<br><br>' +
                      '<div style="font-family:monospace;font-size:1.8rem;font-weight:800;letter-spacing:6px;background:#FFF9E6;border:2px dashed #ffc107;border-radius:12px;padding:10px 16px;color:#331A11;">' + escapeHtml(data.code) + '</div>' +
                      '<button type="button" class="btn btn-sm btn-outline-secondary mt-2" onclick="navigator.clipboard.writeText(' + JSON.stringify(String(data.code)) + ')">Copy Code</button>'
                    : (data.message || 'No reset code was generated.')) +
                    (data.code ? '' : '<div style="font-size:12px;color:#666;margin-top:8px;">' + escapeHtml(data.message || '') + '</div>'),
                confirmButtonColor: '#ffc107',
                confirmButtonText: 'Done'
            });
        } catch (err) {
            Swal.fire('Error', 'Could not generate a reset code.', 'error');
        }
    }

    async function toggleCustomer(customerId, currentlyActive) {
        const action = currentlyActive ? 'deactivate' : 'reactivate';
        const confirmResult = await Swal.fire({
            title: 'Are you sure?',
            text: `You want to ${action} this customer?${currentlyActive ? ' A deactivated customer cannot log in until reactivated.' : ''}`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: currentlyActive ? '#dc3545' : '#28a745',
            cancelButtonColor: '#888',
            confirmButtonText: `Yes, ${action}`
        });
        if (!confirmResult.isConfirmed) return;

        try {
            const res = await authFetch(API.toggle, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customer_id: customerId })
            });
            const data = await res.json();
            if (!data.success) return Swal.fire('Error', data.message || 'Update failed.', 'error');
            fetchCustomers();
            Swal.fire('Success', data.message || 'Customer updated.', 'success');
        } catch (err) {
            Swal.fire('Error', 'Something went wrong.', 'error');
        }
    }

    async function createCustomer(name, phone) {
        const btn = document.getElementById("btnSaveCustomer");
        const originalHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving...';
        }
        try {
            const res = await authFetch(API.create, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, phone_number: phone })
            });
            const data = await res.json();
            if (!data.success) {
                Swal.fire('Error', data.message || 'Could not create the customer.', 'error');
                return false;
            }
            if (addCustomerModal) addCustomerModal.hide();
            if (addCustomerForm) addCustomerForm.reset();
            fetchCustomers();
            Swal.fire('Success', data.message || 'Customer created.', 'success');
            return true;
        } catch (err) {
            console.error("Failed to create customer:", err);
            Swal.fire('Error', 'Something went wrong.', 'error');
            return false;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
    }

    if (btnAddCustomer && addCustomerModal) {
        btnAddCustomer.addEventListener("click", () => {
            if (addCustomerForm) addCustomerForm.reset();
            addCustomerModal.show();
        });
    }
    if (addCustomerForm) {
        addCustomerForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = customerName ? customerName.value.trim() : '';
            const phone = customerPhone ? customerPhone.value.trim() : '';
            if (!name || !phone) {
                Swal.fire('Error', 'Name and phone number are required.', 'error');
                return;
            }
            await createCustomer(name, phone);
        });
    }

    if (tableBody) {
        tableBody.addEventListener("click", (e) => {
            const resetBtn = e.target.closest(".btn-reset");
            const toggleBtn = e.target.closest(".btn-toggle");
            if (resetBtn) {
                generateResetCode(resetBtn.dataset.id, resetBtn.dataset.phone);
            } else if (toggleBtn) {
                toggleCustomer(toggleBtn.dataset.id, toggleBtn.dataset.active === '1');
            }
        });
    }

    if (searchInput) searchInput.addEventListener("input", () => { currentPage = 1; applyFiltersAndRender(); });
    if (topSearchInput) topSearchInput.addEventListener("input", () => { currentPage = 1; applyFiltersAndRender(); });
    if (filterStatus) filterStatus.addEventListener("change", () => { currentPage = 1; applyFiltersAndRender(); });
    if (clearFiltersBtn) clearFiltersBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (topSearchInput) topSearchInput.value = "";
        if (filterStatus) filterStatus.value = "";
        currentPage = 1;
        applyFiltersAndRender();
    });
    if (prevPage) prevPage.addEventListener("click", (e) => { e.preventDefault(); if (currentPage > 1) { currentPage--; applyFiltersAndRender(); } });
    if (nextPage) nextPage.addEventListener("click", (e) => {
        e.preventDefault();
        const totalItems = getFilteredCount();
        const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
        if (currentPage < totalPages) { currentPage++; applyFiltersAndRender(); }
    });

    function getFilteredCount() {
        const q = ((searchInput && searchInput.value) || (topSearchInput && topSearchInput.value) || '').toLowerCase();
        const status = filterStatus ? filterStatus.value : "";
        let f = customers;
        if (q) f = f.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone_number || '').toLowerCase().includes(q));
        if (status !== '') { const want = status === '1'; f = f.filter(c => (String(c.is_active) === '1') === want); }
        return f.length;
    }

    fetchCustomers();
});