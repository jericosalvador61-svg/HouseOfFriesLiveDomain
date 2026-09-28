

const APP_ROOT = (() => {
    const path = window.location.pathname;
    const match = path.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
    return match && match[1] ? match[1] : '';
})();

const API_BASE = `${APP_ROOT}/backend/admin/suppliers/`;
const token = localStorage.getItem('hof_token');

// Helper for fetch with Authorization header
function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
    // For GET we don't send body, for others we do
    const isGet = options.method === 'GET' || !options.method;
    const fetchOptions = {
        ...options,
        headers: { ...headers, ...options.headers },
    };
    if (!isGet && options.body) {
        fetchOptions.body = JSON.stringify(options.body);
    }
    return fetch(url, fetchOptions).then(res => res.json());
}

// State
let currentPage = 1;
let currentLimit = 10;
let currentSearch = '';
let totalPages = 1;
let totalItems = 0;

// Supervisor build is VIEW-ONLY for suppliers: suppliers/create.php,
// suppliers/update.php, suppliers/delete.php and suppliers/set-status.php are
// all authenticate(['Admin']) on the backend. Only list.php / get.php are readable,
// so every write control stays hidden unless the JWT role is admin.
function canManageSuppliers() {
    try {
        const t = localStorage.getItem('hof_token');
        if (!t) return false;
        const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return String(payload.role || '').toLowerCase() === 'admin';
    } catch (e) { return false; }
}

document.addEventListener('DOMContentLoaded', () => {
    init();
});

function init() {
    loadSuppliers();
    setupEvents();
}

function setupEvents() {
    // Search input with debounce
    const searchInput = document.getElementById('searchInput');
    let debounceTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            currentPage = 1;
            loadSuppliers();
        }, 300);
    });

    // Limit change
    document.getElementById('limitSelect').addEventListener('change', (e) => {
        currentLimit = parseInt(e.target.value);
        currentPage = 1;
        loadSuppliers();
    });

    // Add button — removed from the Supervisor build (view-only).
    const addSupplierBtn = document.getElementById('addSupplierBtn');
    if (addSupplierBtn) {
        addSupplierBtn.addEventListener('click', () => {
            openModal();
        });
    }

    // Save button in modal
    const saveSupplierBtn = document.getElementById('saveSupplierBtn');
    if (saveSupplierBtn) {
        saveSupplierBtn.addEventListener('click', saveSupplier);
    }

    // Modal hidden reset
    const supplierModalEl = document.getElementById('supplierModal');
    if (supplierModalEl) {
        supplierModalEl.addEventListener('hidden.bs.modal', () => {
            resetForm();
        });
    }
}

function loadSuppliers() {
    const tableBody = document.getElementById('suppliersTableBody');
    tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4">Loading...</td></tr>`;

    const params = new URLSearchParams({
        page: currentPage,
        limit: currentLimit,
        search: currentSearch
    });

    apiFetch(`list.php?${params.toString()}`, { method: 'GET' })
        .then(data => {
            if (data.status === 'success') {
                const { items, total, page, limit, total_pages } = data.data;
                totalItems = total;
                totalPages = total_pages;
                renderTable(items);
                renderPagination(page, totalPages);
                document.getElementById('totalSuppliersLabel').textContent = `Total: ${total}`;
                updatePaginationInfo(page, limit, total);
            } else {
                throw new Error(data.message);
            }
        })
        .catch(err => {
            console.error('Error loading suppliers:', err);
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Failed to load suppliers. ${err.message}</td></tr>`;
        });
}

function renderTable(suppliers) {
    const tbody = document.getElementById('suppliersTableBody');
    if (!suppliers || suppliers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4">No suppliers found.</td></tr>`;
        return;
    }

    let html = '';
    suppliers.forEach(s => {
        const statusBadge = s.status === 'ACTIVE' ?
            '<span class="badge bg-success">Active</span>' :
            '<span class="badge bg-secondary">Inactive</span>';
        html += `
            <tr>
                <td><strong>${escapeHtml(s.supplier_name)}</strong></td>
                <td>${escapeHtml(s.contact_person || '-')}</td>
                <td>${escapeHtml(s.contact_number || '-')}</td>
                <td>${escapeHtml(s.email || '-')}</td>
                <td>${escapeHtml(s.address || '-')}</td>
                <td>${statusBadge}</td>
                <td class="table-actions">
                    ${canManageSuppliers() ? `
                    <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${s.supplier_id}">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${s.supplier_id}">
                        <i class="bi bi-trash"></i>
                    </button>
                    ${s.status === 'ACTIVE' ?
                        `<button class="btn btn-sm btn-outline-warning toggle-status-btn" data-id="${s.supplier_id}" data-status="INACTIVE">
                            <i class="bi bi-toggle-on"></i> Deactivate
                        </button>` :
                        `<button class="btn btn-sm btn-outline-success toggle-status-btn" data-id="${s.supplier_id}" data-status="ACTIVE">
                            <i class="bi bi-toggle-off"></i> Activate
                        </button>`
                    }` : '<span class="text-muted small">View only</span>'}
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    // Attach event listeners to buttons
    tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => editSupplier(parseInt(btn.dataset.id)));
    });
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteSupplier(parseInt(btn.dataset.id)));
    });
    tbody.querySelectorAll('.toggle-status-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleStatus(parseInt(btn.dataset.id), btn.dataset.status));
    });
}

function renderPagination(currentPage, totalPages) {
    const container = document.getElementById('paginationControls');
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    let html = '';
    // Previous
    html += `<li class="page-item ${currentPage <= 1 ? 'disabled' : ''}">
                <a class="page-link" data-page="${currentPage - 1}">&laquo;</a>
            </li>`;
    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" data-page="${i}">${i}</a>
                </li>`;
    }
    // Next
    html += `<li class="page-item ${currentPage >= totalPages ? 'disabled' : ''}">
                <a class="page-link" data-page="${currentPage + 1}">&raquo;</a>
            </li>`;
    container.innerHTML = html;

    // Add click listeners
    container.querySelectorAll('.page-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = parseInt(link.dataset.page);
            if (page && page !== currentPage && page >= 1 && page <= totalPages) {
                currentPage = page;
                loadSuppliers();
            }
        });
    });
}

function updatePaginationInfo(page, limit, total) {
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);
    const info = document.getElementById('paginationInfo');
    if (total === 0) {
        info.textContent = 'Showing 0-0 of 0';
    } else {
        info.textContent = `Showing ${start}-${end} of ${total}`;
    }
}

// Modal operations
let modalInstance = null;
function getModal() {
    if (!modalInstance) {
        const modalEl = document.getElementById('supplierModal');
        modalInstance = new bootstrap.Modal(modalEl);
    }
    return modalInstance;
}

function openModal(supplierData = null) {
    const modal = getModal();
    const title = document.getElementById('supplierModalTitle');
    const form = document.getElementById('supplierForm');
    form.reset();
    document.querySelectorAll('.invalid-feedback').forEach(el => el.textContent = '');
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));

    if (supplierData) {
        title.textContent = 'Edit Supplier';
        document.getElementById('editSupplierId').value = supplierData.supplier_id;
        document.getElementById('supplierName').value = supplierData.supplier_name;
        document.getElementById('contactPerson').value = supplierData.contact_person || '';
        document.getElementById('contactNumber').value = supplierData.contact_number || '';
        document.getElementById('email').value = supplierData.email || '';
        document.getElementById('address').value = supplierData.address || '';
        document.getElementById('statusSelect').value = supplierData.status;
    } else {
        title.textContent = 'Add Supplier';
        document.getElementById('editSupplierId').value = 0;
        document.getElementById('statusSelect').value = 'ACTIVE';
    }
    modal.show();
}

function resetForm() {
    document.getElementById('supplierForm').reset();
    document.querySelectorAll('.invalid-feedback').forEach(el => el.textContent = '');
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
}

function editSupplier(id) {
    apiFetch(`get.php?id=${id}`, { method: 'GET' })
        .then(data => {
            if (data.status === 'success') {
                openModal(data.data);
            } else {
                Swal.fire('Error', data.message, 'error');
            }
        })
        .catch(err => Swal.fire('Error', 'Failed to fetch supplier data.', 'error'));
}

function saveSupplier() {
    const id = parseInt(document.getElementById('editSupplierId').value);
    const name = document.getElementById('supplierName').value.trim();
    const contact = document.getElementById('contactPerson').value.trim();
    const phone = document.getElementById('contactNumber').value.trim();
    const email = document.getElementById('email').value.trim();
    const address = document.getElementById('address').value.trim();
    const status = document.getElementById('statusSelect').value;

    // Basic frontend validation (will be re-checked backend)
    let valid = true;
    document.querySelectorAll('.invalid-feedback').forEach(el => el.textContent = '');
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));

    if (!name) {
        document.getElementById('supplierNameError').textContent = 'Supplier name is required.';
        document.getElementById('supplierName').classList.add('is-invalid');
        valid = false;
    }
    if (!address) {
        document.getElementById('addressError').textContent = 'Address is required.';
        document.getElementById('address').classList.add('is-invalid');
        valid = false;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        document.getElementById('emailError').textContent = 'Invalid email format.';
        document.getElementById('email').classList.add('is-invalid');
        valid = false;
    }
    if (!valid) return;

    const payload = {
        supplier_name: name,
        contact_person: contact,
        contact_number: phone,
        email: email,
        address: address,
        status: status
    };
    if (id > 0) {
        payload.supplier_id = id;
    }

    const endpoint = id > 0 ? 'update.php' : 'create.php';
    const method = id > 0 ? 'PUT' : 'POST';

    const saveBtn = document.getElementById('saveSupplierBtn');
    LoadingManager.show(saveBtn, { text: 'Saving...' });

    apiFetch(endpoint, { method, body: payload })
        .then(data => {
            if (data.status === 'success') {
                Swal.fire('Success', data.message, 'success');
                getModal().hide();
                loadSuppliers();
            } else {
                // Handle validation errors
                if (data.errors) {
                    // Map errors to fields
                    for (const [field, msg] of Object.entries(data.errors)) {
                        const errorEl = document.getElementById(`${field}Error`);
                        const inputEl = document.getElementById(field);
                        if (errorEl && inputEl) {
                            errorEl.textContent = msg;
                            inputEl.classList.add('is-invalid');
                        } else {
                            // Fallback: show general error
                            Swal.fire('Error', msg, 'error');
                        }
                    }
                } else {
                    Swal.fire('Error', data.message, 'error');
                }
            }
        })
        .catch(err => Swal.fire('Error', 'Network error. Please try again.', 'error'))
        .finally(() => LoadingManager.hide(saveBtn));
}

function deleteSupplier(id) {
    Swal.fire({
        title: 'Are you sure?',
        text: "This action cannot be undone.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, delete it!'
    }).then((result) => {
        if (result.isConfirmed) {
            apiFetch('delete.php', { method: 'DELETE', body: { supplier_id: id } })
                .then(data => {
                    if (data.status === 'success') {
                        Swal.fire('Deleted!', data.message, 'success');
                        loadSuppliers();
                    } else {
                        Swal.fire('Error', data.message, 'error');
                    }
                })
                .catch(err => Swal.fire('Error', 'Network error.', 'error'));
        }
    });
}

function toggleStatus(id, newStatus) {
    const action = newStatus === 'ACTIVE' ? 'activate' : 'deactivate';
    const confirmText = `Are you sure you want to ${action} this supplier?`;
    Swal.fire({
        title: 'Confirm Status Change',
        text: confirmText,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#ffc107',
        cancelButtonColor: '#6c757d',
        confirmButtonText: `Yes, ${action}`
    }).then((result) => {
        if (result.isConfirmed) {
            apiFetch('set-status.php', { method: 'POST', body: { supplier_id: id, status: newStatus } })
                .then(data => {
                    if (data.status === 'success') {
                        Swal.fire('Status Updated', data.message, 'success');
                        loadSuppliers();
                    } else {
                        Swal.fire('Error', data.message, 'error');
                    }
                })
                .catch(err => Swal.fire('Error', 'Network error.', 'error'));
        }
    });
}

// Utility to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}