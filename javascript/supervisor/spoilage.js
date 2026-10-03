// ==========================================
// SPOILAGE - Admin Module
// Consistent flow: staging table → duplicate detection → review modal → pending
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    let allSpoilageRecords = [];
    let spoilagePage = 1;
    let spoilageTotal = 0;

    function renderAdminSpoilagePager() {
        const pagerEl = document.getElementById('spoilagePager');
        if (!pagerEl) return;
        const pages = Math.max(1, Math.ceil(spoilageTotal / 10));
        let html = '';
        for (let i = 1; i <= pages; i++) {
            html += `<li class="page-item ${i === spoilagePage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }
        pagerEl.innerHTML = html;
        pagerEl.querySelectorAll('a[data-page]').forEach(a => {
            a.addEventListener('click', e => {
                e.preventDefault();
                spoilagePage = parseInt(a.dataset.page, 10);
                fetchSpoilageHistory();
            });
        });
    }
    let spoilageItems = [];

    // --- 1. INITIAL LOAD ---
    fetchMaterialsAndStats();
    fetchSpoilageHistory();

    const inputMaterial = document.getElementById('inputMaterial');
    const addToListBtn = document.getElementById('addToListBtn');
    const spoilageItemBody = document.getElementById('spoilageItemBody');
    const spoilageForm = document.getElementById('spoilageForm');

    const spoilageStagingBody = document.getElementById('spoilageStagingBody');
    const spoilageStagingContainer = document.getElementById('spoilageStagingContainer');

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

    function fetchSpoilageHistory() {
        const historyBody = document.getElementById('spoilageTableBody');
        const pendingBody = document.getElementById('pendingSpoilageTableBody');
        const pendingCountBadge = document.getElementById('pendingApprovalCount');
        const batchActionContainer = document.getElementById('batchActionContainer');

        authenticatedFetch("/backend/admin/manageInventory/get_spoilage_history.php?page=" + spoilagePage)
            .then(r => r.json())
            .then(result => {
                if (result.status === 'success') {
                    allSpoilageRecords = result.data || [];
                    spoilageTotal = (result.pagination && result.pagination.total) || allSpoilageRecords.length;
                    renderAdminSpoilagePager();
                    let pendingHtml = '', historyHtml = '', pendingCount = 0;

                    allSpoilageRecords.forEach(row => {
                        const fd = row.spoilage_date ? new Date(row.spoilage_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
                        const cs = (row.status || 'Pending').toUpperCase();
                        if (cs === 'PENDING') {
                            pendingCount++;
                            pendingHtml += `<tr>
                                <td class="text-center px-0"><input type="checkbox" class="form-check-input spoilage-select-item" value="${row.spoilage_id}"></td>
                                <td class="ps-2 text-wrap" style="word-break:break-word;">
                                    <div class="fw-bold text-dark mb-1" style="font-size:0.85rem;">${row.raw_material_name || 'Unknown'}</div>
                                    <span class="badge bg-light text-danger border px-2 py-0.5 mb-1 d-inline-block" style="font-size:0.75rem;">${row.quantity_lost || 0} ${row.unit || ''}</span>
                                    <div class="text-secondary" style="font-size:0.75rem;"><strong>Type:</strong> ${row.spoilage_type || 'N/A'}<br><strong>Source:</strong> ${row.source || 'RAW'}</div>
                                </td>
                                <td class="text-center px-0"><button type="button" class="btn btn-sm btn-primary view-spoilage-btn" data-id="${row.spoilage_id}"><i class="bi bi-eye"></i></button></td>
                            </tr>`;
                        } else {
                            historyHtml += `<tr>
                                <td class="ps-4"><div class="fw-bold text-dark">${row.raw_material_name || 'Unknown'}</div><small class="text-muted">${row.remarks || ''}</small></td>
                                <td><span class="badge bg-light text-danger border">${row.quantity_lost || 0} ${row.unit || ''}</span></td>
                                <td><span class="text-secondary">${row.spoilage_type || 'N/A'}</span><br><small class="text-muted">Source: ${row.source || 'N/A'}</small></td>
                                <td class="text-muted">${fd}</td>
                                <td class="text-end pe-4"><button type="button" class="btn btn-sm btn-primary view-spoilage-btn" data-id="${row.spoilage_id}"><i class="bi bi-eye"></i></button></td>
                            </tr>`;
                        }
                    });

                    if (pendingCountBadge) pendingCountBadge.textContent = pendingCount;
                    if (batchActionContainer) batchActionContainer.classList.toggle('d-none', pendingCount === 0);

                    if (pendingBody) {
                        pendingBody.innerHTML = pendingHtml || `<tr><td colspan="3" class="text-center py-5 text-muted"><i class="bi bi-shield-check fs-2 d-block mb-2 text-success"></i>No pending requests</td></tr>`;
                    }
                    if (historyBody) {
                        historyBody.innerHTML = historyHtml || `<tr><td colspan="5" class="text-center py-4 text-muted">No historical records found.</td></tr>`;
                    }

                    document.querySelectorAll('.view-spoilage-btn').forEach(btn => {
                        btn.onclick = function () { showSpoilageDetailsSwal(this.getAttribute('data-id')); };
                    });
                }
            })
            .catch(err => console.error('Error fetching spoilage:', err));
    }

    // --- Select All ---
    const masterCheckbox = document.getElementById('selectAllSpoilagePending');
    if (masterCheckbox) {
        masterCheckbox.addEventListener('change', function () {
            document.querySelectorAll('.spoilage-select-item').forEach(cb => cb.checked = this.checked);
        });
    }

    // --- Batch Approve ---
    const batchApproveBtn = document.getElementById('batchApproveSpoilageBtn');
    if (batchApproveBtn) {
        batchApproveBtn.addEventListener('click', function () {
            const selected = document.querySelectorAll('.spoilage-select-item:checked');
            const ids = Array.from(selected).map(cb => cb.value);
            if (ids.length === 0) { Swal.fire('No Selection', 'Check at least one item.', 'warning'); return; }
            Swal.fire({
                title: 'Approve Spoilage?',
                text: `Approve ${ids.length} spoilage record(s)? Stock will be deducted.`,
                icon: 'warning', showCancelButton: true, confirmButtonColor: '#28a745', confirmButtonText: 'Approve'
            }).then(result => {
                if (!result.isConfirmed) return;
                LoadingManager.show(batchApproveBtn, { text: 'Approving...' });
                authenticatedFetch("/backend/admin/manageInventory/batch_approve_spoilage.php", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ spoilage_ids: ids })
                })
                    .then(r => r.json())
                    .then(data => {
                        if (data.status === 'success') {
                            Swal.fire('Success', data.message, 'success').then(() => { fetchMaterialsAndStats(); fetchSpoilageHistory(); });
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
            const source = document.getElementById('inputSource').value;
            const qty = parseFloat(document.getElementById('inputQty').value);

            if (!materialId || !qty || qty <= 0) {
                Swal.fire('Error', 'Select material and enter a valid quantity.', 'error');
                return;
            }

            // Duplicate detection (like Stock In)
            const existing = spoilageItems.find(i => i.material_id === materialId);
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
                        renderStaging();
                    }
                });
                return;
            }

            spoilageItems.push({ material_id: materialId, material_name: materialName, unit, type, source, quantity: qty });
            renderStaging();
            inputMaterial.value = '';
            document.getElementById('inputQty').value = '';
        });
    }

    function renderStaging() {
        if (!spoilageStagingBody || !spoilageStagingContainer) return;
        spoilageStagingContainer.classList.toggle('d-none', spoilageItems.length === 0);
        spoilageStagingBody.innerHTML = '';
        spoilageItems.forEach((item, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.material_name}</td>
                <td>${item.type}</td>
                <td>${item.source}</td>
                <td>${item.quantity} ${item.unit}</td>
                <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger remove-staging-item" data-index="${i}"><i class="bi bi-trash"></i></button></td>
            `;
            spoilageStagingBody.appendChild(tr);
        });
        // Re-bind remove handlers
        spoilageStagingBody.querySelectorAll('.remove-staging-item').forEach(btn => {
            btn.onclick = function () {
                spoilageItems.splice(parseInt(this.dataset.index), 1);
                renderStaging();
            };
        });
    }

    // ==========================================
    // FORM SUBMIT → REVIEW MODAL (like Stock In)
    // ==========================================
    if (spoilageForm) {
        spoilageForm.addEventListener('submit', function (e) {
            e.preventDefault();
            if (spoilageItems.length === 0) {
                Swal.fire('Empty List', 'Add at least one item first.', 'warning');
                return;
            }

            // Build review HTML
            let itemsHtml = spoilageItems.map(item => `
                <tr>
                    <td class="fw-bold">${item.material_name}</td>
                    <td>${item.type}</td>
                    <td>${item.source}</td>
                    <td>${item.quantity} ${item.unit}</td>
                </tr>
            `).join('');

            const date = document.getElementById('spoilageDateDefault')?.value || 'N/A';
            const remarks = document.querySelector('input[name="remarks"]')?.value || '';

            Swal.fire({
                title: 'Review Spoilage / Waste',
                html: `
                    <div class="text-start">
                        <table class="table table-sm table-borderless mb-2">
                            <tr><td class="text-muted">Date:</td><td class="fw-bold">${date}</td></tr>
                            <tr><td class="text-muted">Remarks:</td><td class="fw-bold">${remarks || '—'}</td></tr>
                        </table>
                        <hr>
                        <h6 class="fw-bold">Items to record:</h6>
                        <div class="table-responsive" style="max-height:200px;overflow-y:auto;">
                            <table class="table table-sm table-bordered">
                                <thead class="table-light"><tr><th>Material</th><th>Type</th><th>Source</th><th>Qty</th></tr></thead>
                                <tbody>${itemsHtml}</tbody>
                            </table>
                        </div>
                    </div>`,
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#6c757d',
                confirmButtonText: '<i class="bi bi-check-lg"></i> Confirm & Save',
                cancelButtonText: 'Cancel',
                width: '550px'
            }).then(result => {
                if (!result.isConfirmed) return;

                const submitBtn = spoilageForm.querySelector('button[type="submit"]');

                const photoInput = document.getElementById('spoilagePhoto');
                if (!photoInput || !photoInput.files || photoInput.files.length === 0) {
                    Swal.fire('Photo Required', 'Attach a proof photo for SPOILAGE / WASTE / DAMAGE before confirming.', 'warning');
                    return;
                }
                LoadingManager.show(submitBtn || spoilageForm, { text: 'Recording...' });
                const photoReader = new FileReader();
                photoReader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(img.width * scale));
                        canvas.height = Math.max(1, Math.round(img.height * scale));
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                        const photoBase64 = canvas.toDataURL('image/jpeg', 0.65).split(',')[1];

                        // Build FormData from staging items
                        const fd = new FormData();
                        fd.append('spoilage_date', date);
                        fd.append('remarks', remarks);
                        fd.append('photo', photoBase64);
                        spoilageItems.forEach(item => {
                            fd.append('material_id[]', item.material_id);
                            fd.append('type[]', item.type);
                            fd.append('source[]', item.source);
                            fd.append('quantity[]', item.quantity);
                        });

                        authenticatedFetch("/backend/admin/manageInventory/record_spoilage.php", {
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
                            .finally(() => LoadingManager.hide(submitBtn || spoilageForm));
                    };
                    img.onerror = () => { LoadingManager.hide(submitBtn || spoilageForm); Swal.fire('Error', 'Could not read the photo file.', 'error'); };
                    img.src = ev.target.result;
                };
                photoReader.readAsDataURL(photoInput.files[0]);
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

    function showSpoilageDetailsSwal(id) {
        const item = allSpoilageRecords.find(r => String(r.spoilage_id) === String(id));
        if (!item) { Swal.fire('Error', 'Record not found.', 'error'); return; }
        const status = (item.status || 'Pending').toUpperCase();
        const fd = item.spoilage_date ? new Date(item.spoilage_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
        Swal.fire({
            title: 'Spoilage Details',
            html: `<div class="text-start px-2" style="font-size:0.9rem;">
                <table class="table table-sm table-borderless">
                    <tr><td class="text-muted">Material:</td><td class="fw-bold">${item.raw_material_name}</td></tr>
                    <tr><td class="text-muted">Qty Lost:</td><td>${item.quantity_lost} ${item.unit || ''}</td></tr>
                    <tr><td class="text-muted">Type:</td><td>${item.spoilage_type || 'N/A'}</td></tr>
                    <tr><td class="text-muted">Source:</td><td>${item.source || 'RAW'}</td></tr>
                    <tr><td class="text-muted">Date:</td><td>${fd}</td></tr>
                    <tr><td class="text-muted">Remarks:</td><td>${item.remarks || '—'}</td></tr>
                    <tr><td class="text-muted">Status:</td><td><span class="badge ${status === 'APPROVED' ? 'bg-success' : status === 'PENDING' ? 'bg-warning text-dark' : 'bg-danger'}">${item.status || 'Pending'}</span></td></tr>
                    ${item.photo_data_uri ? `<tr><td class="text-muted align-top">Proof Photo:</td><td><img src="${item.photo_data_uri}" class="img-thumbnail" style="max-width:220px;max-height:180px;object-fit:contain;" alt="Spoilage proof photo"></td></tr>` : ''}
                </table></div>`,
            icon: status === 'APPROVED' ? 'success' : status === 'PENDING' ? 'info' : 'error',
            confirmButtonText: 'Close'
        });
    }

    // Initialize date to today
    const dateInput = document.getElementById('spoilageDateDefault');
    if (dateInput) dateInput.valueAsDate = new Date();
});