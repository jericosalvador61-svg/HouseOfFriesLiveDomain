// ==========================================
// RETURNS - Admin Module
// Consistent flow: staging table → duplicate detection → review modal → pending
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    let allReturnsRecords = [];
    let returnsItems = [];

    // --- 1. INITIAL LOAD ---
    fetchMaterialsAndStats();
    fetchReturnsHistory();

    const inputMaterial = document.getElementById('inputMaterial');
    const addToListBtn = document.getElementById('addToListBtn');
    const returnsItemBody = document.getElementById('returnsItemBody');
    const returnsForm = document.getElementById('returnsForm');
    const returnsStagingBody = document.getElementById('returnsStagingBody');
    const returnsStagingContainer = document.getElementById('returnsStagingContainer');

    function authenticatedFetch(url, options = {}) {
        const token = localStorage.getItem('hof_token');
        if (!options.headers) options.headers = {};
        options.headers['Authorization'] = `Bearer ${token}`;
        return fetch(url, options).then(response => {
            if (response.status === 401) {
                Swal.fire("Unauthorized", "Your session expired.", "error");
                throw new Error("Unauthorized (401)");
            }
            return response;
        });
    }

    function fetchMaterialsAndStats() {
        authenticatedFetch("/backend/admin/manageInventory/get_materials.php")
            .then(r => r.json())
            .then(result => {
                if (result.status === 'success') {
                    updateCount('totalItems', result.stats?.total);
                    updateCount('lowStock', result.stats?.low);
                    updateCount('outStock', result.stats?.out);
                    updateCount('damagedStock', result.stats?.damaged);
                    checkStockAlerts(result.data);
                    if (inputMaterial && Array.isArray(result.data)) {
                        inputMaterial.innerHTML = '<option value="" selected disabled>Select Material...</option>';
                        result.data.forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m.raw_material_id;
                            opt.dataset.name = m.raw_material_name;
                            opt.dataset.unit = m.unit;
                            opt.textContent = `${m.raw_material_name} (${m.current_quantity} ${m.unit} available)`;
                            inputMaterial.appendChild(opt);
                        });
                    }
                }
            })
            .catch(err => console.error('Error fetching stats:', err));
    }

    function fetchReturnsHistory() {
        const historyBody = document.getElementById('returnsTableBody');
        const pendingBody = document.getElementById('pendingReturnsTableBody');
        const pendingCountBadge = document.getElementById('pendingApprovalCount');
        const batchActionContainer = document.getElementById('batchActionContainer');

        authenticatedFetch("/backend/admin/manageInventory/get_return_history.php")
            .then(r => r.json())
            .then(result => {
                if (result.success) {
                    allReturnsRecords = result.data || [];
                    let pendingHtml = '', historyHtml = '', pendingCount = 0;

                    allReturnsRecords.forEach(row => {
                        const items = row.items || [];
                        const fd = row.return_date ? new Date(row.return_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
                        const cs = (row.status || 'Pending').toUpperCase();

                        if (cs === 'PENDING') {
                            pendingCount++;
                            pendingHtml += `<tr>
                                <td class="text-center px-0"><input type="checkbox" class="form-check-input return-select-item" value="${row.return_id}"></td>
                                <td class="ps-2 text-wrap" style="word-break:break-word;">
                                    <div class="fw-bold text-dark mb-1" style="font-size:0.85rem;">${row.reference_number || 'RET-...'}</div>
                                    ${items.map(item => `<span class="badge bg-light text-dark border px-2 py-0.5 mb-1 d-inline-block" style="font-size:0.75rem;">${item.material || ''}: ${item.quantity || 0} ${item.unit || ''}</span>`).join('')}
                                    <div class="text-secondary" style="font-size:0.75rem;"><strong>Type:</strong> ${row.return_type || 'OTHER'}<br><strong>Reason:</strong> ${row.reason || 'N/A'}</div>
                                </td>
                                <td class="text-center px-0"><button type="button" class="btn btn-sm btn-primary view-return-btn" data-id="${row.return_id}"><i class="bi bi-eye"></i></button></td>
                            </tr>`;
                        } else {
                            const itemsHtml = items.map(item => `<span class="badge bg-light text-dark border me-1">${item.material || ''}: ${item.quantity || 0} ${item.unit || ''}</span>`).join('');
                            let badgeClass = 'bg-warning text-dark';
                            if (cs === 'APPROVED') badgeClass = 'bg-success text-white';
                            else if (cs === 'REJECTED') badgeClass = 'bg-danger text-white';
                            historyHtml += `<tr>
                                <td class="ps-4"><span class="fw-bold">${row.reference_number || 'N/A'}</span></td>
                                <td>${itemsHtml || '<span class="text-muted">No items</span>'}</td>
                                <td>${items.map(i => `${i.quantity || 0} ${i.unit || ''}`).join(', ') || '0'}</td>
                                <td>${row.return_type || 'OTHER'}</td>
                                <td>${row.reason || ''}</td>
                                <td class="text-end pe-4">${fd}</td>
                                <td><span class="badge ${badgeClass}">${row.status || 'Pending'}</span></td>
                            </tr>`;
                        }
                    });

                    if (pendingCountBadge) pendingCountBadge.textContent = pendingCount;
                    if (batchActionContainer) batchActionContainer.classList.toggle('d-none', pendingCount === 0);

                    if (pendingBody) {
                        pendingBody.innerHTML = pendingHtml || `<tr><td colspan="3" class="text-center py-5 text-muted"><i class="bi bi-shield-check fs-2 d-block mb-2 text-success"></i>No pending returns</td></tr>`;
                    }
                    if (historyBody) {
                        historyBody.innerHTML = historyHtml || `<tr><td colspan="7" class="text-center py-4 text-muted">No return records found.</td></tr>`;
                    }

                    document.querySelectorAll('.view-return-btn').forEach(btn => {
                        btn.onclick = function () { showReturnDetailsSwal(this.getAttribute('data-id')); };
                    });
                }
            })
            .catch(err => console.error('Error fetching returns:', err));
    }

    // --- Select All ---
    const masterCheckbox = document.getElementById('selectAllReturnsPending');
    if (masterCheckbox) {
        masterCheckbox.addEventListener('change', function () {
            document.querySelectorAll('.return-select-item').forEach(cb => cb.checked = this.checked);
        });
    }

    // --- Batch Approve ---
    const batchApproveBtn = document.getElementById('batchApproveReturnsBtn');
    if (batchApproveBtn) {
        batchApproveBtn.addEventListener('click', function () {
            const selected = document.querySelectorAll('.return-select-item:checked');
            const ids = Array.from(selected).map(cb => cb.value);
            if (ids.length === 0) { Swal.fire('No Selection', 'Check at least one item.', 'warning'); return; }
            Swal.fire({
                title: 'Approve Returns?',
                text: `Approve ${ids.length} return(s)? Stock will be added back.`,
                icon: 'warning', showCancelButton: true, confirmButtonColor: '#28a745', confirmButtonText: 'Approve'
            }).then(result => {
                if (!result.isConfirmed) return;
                LoadingManager.show(batchApproveBtn, { text: 'Approving...' });
                authenticatedFetch("/backend/admin/manageInventory/batch_approve_returns.php", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ return_ids: ids })
                })
                    .then(r => r.json())
                    .then(data => {
                        if (data.status === 'success') {
                            Swal.fire('Success', data.message, 'success').then(() => { fetchMaterialsAndStats(); fetchReturnsHistory(); });
                        } else { Swal.fire('Error', data.message, 'error'); }
                    })
                    .catch(err => { console.error(err); Swal.fire('Error', 'Server error.', 'error'); })
                    .finally(() => LoadingManager.hide(batchApproveBtn));
            });
        });
    }

    function updateCount(id, val) { const el = document.getElementById(id); if (el) el.textContent = val ?? 0; }

    // ==========================================
    // ADD ITEM TO STAGING (with duplicate detection)
    // ==========================================
    if (addToListBtn) {
        addToListBtn.addEventListener('click', function () {
            const materialId = inputMaterial.value;
            const opt = inputMaterial.options[inputMaterial.selectedIndex];
            const materialName = opt?.dataset?.name || (opt ? opt.text.split('(')[0].trim() : '');
            const unit = opt?.dataset?.unit || '';
            const type = document.getElementById('inputType').value;
            const qty = parseFloat(document.getElementById('inputQty').value);
            const cost = parseFloat(document.getElementById('inputCost').value) || 0;

            if (!materialId || !qty || qty <= 0) {
                Swal.fire('Error', 'Select material and enter a valid quantity.', 'error');
                return;
            }

            // Duplicate detection (like Stock In)
            const existing = returnsItems.find(i => i.material_id === materialId);
            if (existing) {
                Swal.fire({
                    title: 'Already Added',
                    text: `"${materialName}" is already in your list. Combine quantities?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, merge!'
                }).then(result => {
                    if (result.isConfirmed) {
                        existing.quantity += qty;
                        existing.unit_cost = (existing.unit_cost + cost) / 2; // average cost
                        renderStaging();
                    }
                });
                return;
            }

            returnsItems.push({ material_id: materialId, material_name: materialName, unit, type, quantity: qty, unit_cost: cost });
            renderStaging();
            inputMaterial.value = '';
            document.getElementById('inputQty').value = '';
            document.getElementById('inputCost').value = '';
        });
    }

    function renderStaging() {
        if (!returnsStagingBody || !returnsStagingContainer) return;
        returnsStagingContainer.classList.toggle('d-none', returnsItems.length === 0);
        returnsStagingBody.innerHTML = '';
        returnsItems.forEach((item, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.material_name}</td>
                <td>${item.type}</td>
                <td>${item.quantity} ${item.unit}</td>
                <td>₱${item.unit_cost.toFixed(2)}</td>
                <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger remove-staging-item" data-index="${i}"><i class="bi bi-trash"></i></button></td>
            `;
            returnsStagingBody.appendChild(tr);
        });
        returnsStagingBody.querySelectorAll('.remove-staging-item').forEach(btn => {
            btn.onclick = function () {
                returnsItems.splice(parseInt(this.dataset.index), 1);
                renderStaging();
            };
        });
    }

    // ==========================================
    // FORM SUBMIT → REVIEW MODAL (like Stock In)
    // ==========================================
    if (returnsForm) {
        returnsForm.addEventListener('submit', function (e) {
            e.preventDefault();
            if (returnsItems.length === 0) {
                Swal.fire('Empty List', 'Add at least one item first.', 'warning');
                return;
            }

            // Build review HTML
            let itemsHtml = returnsItems.map(item => `
                <tr>
                    <td class="fw-bold">${item.material_name}</td>
                    <td>${item.type}</td>
                    <td>${item.quantity} ${item.unit}</td>
                    <td>₱${item.unit_cost.toFixed(2)}</td>
                </tr>
            `).join('');

            const date = document.getElementById('returnsDateDefault')?.value || 'N/A';
            const reason = document.querySelector('input[name="reason"]')?.value || '';

            Swal.fire({
                title: 'Review Return',
                html: `
                    <div class="text-start">
                        <table class="table table-sm table-borderless mb-2">
                            <tr><td class="text-muted">Date:</td><td class="fw-bold">${date}</td></tr>
                            <tr><td class="text-muted">Reason:</td><td class="fw-bold">${reason || '—'}</td></tr>
                        </table>
                        <hr>
                        <h6 class="fw-bold">Items to return:</h6>
                        <div class="table-responsive" style="max-height:200px;overflow-y:auto;">
                            <table class="table table-sm table-bordered">
                                <thead class="table-light"><tr><th>Material</th><th>Type</th><th>Qty</th><th>Cost</th></tr></thead>
                                <tbody>${itemsHtml}</tbody>
                            </table>
                        </div>
                    </div>`,
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#ffc107',
                confirmButtonText: '<i class="bi bi-check-lg"></i> Confirm & Save',
                cancelButtonText: 'Cancel',
                width: '550px'
            }).then(result => {
                if (!result.isConfirmed) return;

                const submitBtn = returnsForm.querySelector('button[type="submit"]');
                LoadingManager.show(submitBtn || returnsForm, { text: 'Recording...' });

                const fd = new FormData();
                fd.append('return_date', date);
                fd.append('reason', reason);
                returnsItems.forEach(item => {
                    fd.append('material_id[]', item.material_id);
                    fd.append('return_type[]', item.type);
                    fd.append('quantity[]', item.quantity);
                    fd.append('unit_cost[]', item.unit_cost);
                });

                authenticatedFetch("/backend/admin/manageInventory/record_return.php", {
                    method: "POST", body: fd
                })
                    .then(r => r.json())
                    .then(result => {
                        if (result.status === 'success') {
                            Swal.fire('Success', result.message, 'success').then(() => location.reload());
                        } else {
                            Swal.fire('Error', result.message, 'error');
                        }
                    })
                    .catch(err => { console.error(err); Swal.fire('Error', 'Server error.', 'error'); })
                    .finally(() => LoadingManager.hide(submitBtn || returnsForm));
            });
        });
    }

    function checkStockAlerts(materialsList) {
        const badge = document.getElementById('notificationBadge');
        const menu = document.getElementById('notificationMenu');
        if (!menu || !badge || !Array.isArray(materialsList)) return;
        let alerts = [];
        materialsList.forEach(m => {
            const qty = parseFloat(m.current_quantity);
            const rl = parseFloat(m.reorder_level);
            if (!isNaN(qty) && !isNaN(rl)) {
                if (qty <= 0) alerts.push({ text: `⚠️ <strong>${m.raw_material_name}</strong> is out of stock!`, critical: true });
                else if (qty <= rl) alerts.push({ text: `⚠️ <strong>${m.raw_material_name}</strong> is low (${qty} ${m.unit || 'pcs'})`, critical: false });
            }
        });
        menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark">Stock Alerts</li>';
        if (alerts.length > 0) {
            alerts.forEach(a => { menu.innerHTML += `<li><a class="dropdown-item py-2 border-bottom text-wrap" href="manage_inventory.html"><div style="color:${a.critical ? '#dc3545' : '#b57d00'};">${a.text}</div></a></li>`; });
            badge.textContent = alerts.length; badge.classList.remove('d-none');
        } else { badge.classList.add('d-none'); menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All normal.</span></li>`; }
    }

    function showReturnDetailsSwal(id) {
        const item = allReturnsRecords.find(r => String(r.return_id) === String(id));
        if (!item) { Swal.fire('Error', 'Record not found.', 'error'); return; }
        const items = item.items || [];
        const fd = item.return_date ? new Date(item.return_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
        const cs = (item.status || 'Pending').toUpperCase();
        let itemsHtml = items.map(i => `<tr><td>${i.material || 'Unknown'}</td><td>${i.quantity || 0} ${i.unit || ''}</td><td>₱${parseFloat(i.unit_cost || 0).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-muted">No items</td></tr>';
        Swal.fire({
            title: `Return - ${item.reference_number || 'N/A'}`,
            html: `<div class="text-start px-2" style="font-size:0.9rem;">
                <table class="table table-sm table-borderless"><tr><td class="text-muted">Reference:</td><td class="fw-bold">${item.reference_number || 'N/A'}</td></tr>
                <tr><td class="text-muted">Date:</td><td>${fd}</td></tr>
                <tr><td class="text-muted">Type:</td><td>${item.return_type || 'OTHER'}</td></tr>
                <tr><td class="text-muted">Reason:</td><td>${item.reason || 'N/A'}</td></tr>
                <tr><td colspan="2"><hr><h6 class="fw-bold">Items</h6><table class="table table-sm"><thead><tr><th>Material</th><th>Qty</th><th>Cost</th></tr></thead><tbody>${itemsHtml}</tbody></table></td></tr>
                <tr><td class="text-muted">Status:</td><td><span class="badge ${cs === 'APPROVED' ? 'bg-success' : cs === 'PENDING' ? 'bg-warning text-dark' : 'bg-danger'}">${item.status || 'Pending'}</span></td></tr></table></div>`,
            icon: cs === 'APPROVED' ? 'success' : cs === 'PENDING' ? 'info' : 'error',
            confirmButtonText: 'Close', width: '540px'
        });
    }

    // Initialize date to today
    const dateInput = document.getElementById('returnsDateDefault');
    if (dateInput) dateInput.valueAsDate = new Date();
});