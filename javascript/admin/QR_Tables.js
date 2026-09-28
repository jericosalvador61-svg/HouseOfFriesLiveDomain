// ==========================================
// QR Tables Management - Admin Module
// ==========================================
(function () {
    'use strict';

    const API = {
        fetchTables: '../../backend/admin/QRTables/fetch_tables.php',
        addTable: '../../backend/admin/QRTables/add_table.php',
        updateStatus: '../../backend/admin/QRTables/update_table_status.php',
        deleteTable: '../../backend/admin/QRTables/delete_table.php',
        restoreTable: '../../backend/admin/QRTables/restore_table.php'
    };

    let currentPage = 1;
    const limit = 9;
    let totalTables = 0;
    let nextTableNumber = null;
    let selectedType = '';
    let editingTableId = null;
    let allTables = []; // Full dataset for stats (BROKEN-STATS-FIX)

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    function getAuthToken() {
        return localStorage.getItem('hof_token') || '';
    }

    function authFetch(url, options) {
        const token = getAuthToken();
        const headers = options.headers || {};
        headers['Authorization'] = 'Bearer ' + token;
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        }
        options.headers = headers;
        return fetch(url, options);
    }

    function init() {
        const addModalEl = document.getElementById('addTableModal');
        const editModalEl = document.getElementById('editTableModal');
        const btnAdd = document.getElementById('btnAddNewTable');
        const saveBtn = document.getElementById('saveTableBtn');
        const searchInput = document.getElementById('searchInput');
        const filterType = document.getElementById('filterType');
        const filterStatus = document.getElementById('filterStatus');
        const filterDeleted = document.getElementById('filterDeleted');

        if (!addModalEl || !btnAdd) {
            console.warn('QR_Tables: Required elements missing');
            return;
        }

        // Init modals only after bootstrap is available
        let addModal = null, editModal = null;
        try {
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                if (addModalEl) addModal = new bootstrap.Modal(addModalEl, { backdrop: 'static', keyboard: false });
                if (editModalEl) editModal = new bootstrap.Modal(editModalEl, { backdrop: 'static', keyboard: false });
            }
        } catch (e) {
            console.warn('QR_Tables: Bootstrap modal init failed, will retry on click', e);
        }

        // ---- TYPE SELECTION CARDS ----
        document.querySelectorAll('.type-select-card').forEach(function (card) {
            card.addEventListener('click', function () {
                document.querySelectorAll('.type-select-card').forEach(function (c) { c.classList.remove('selected'); });
                card.classList.add('selected');
                selectedType = card.dataset.type;
                // Dine-in uses numeric labels; takeout can use any short label.
                var hint = document.getElementById('tableNumberHint');
                if (selectedType === 'TAKEOUT') {
                    if (tableNumInput) {
                        tableNumInput.value = '';
                        tableNumInput.readOnly = false;
                        tableNumInput.placeholder = 'e.g. Counter A or Takeout 1';
                        tableNumInput.classList.remove('text-muted', 'bg-light');
                    }
                    if (hint) hint.textContent = 'Enter a unique takeout name or label.';
                } else {
                    if (tableNumInput) {
                        tableNumInput.value = nextTableNumber ? String(nextTableNumber) : '';
                        tableNumInput.readOnly = false;
                        tableNumInput.classList.remove('text-muted', 'bg-light');
                        tableNumInput.placeholder = 'e.g. 1';
                    }
                    if (hint) {
                        if (nextTableNumber) {
                            hint.textContent = 'Suggested next: ' + nextTableNumber + ' (you can change it)';
                        } else {
                            hint.textContent = 'Enter a table number (e.g. 1, 2, 3...)';
                        }
                    }
                }
                // QR code is generated AFTER saving (not during preview)
            });
        });

        // ---- TABLE NUMBER INPUT ----
        const tableNumInput = document.getElementById('newTableNumber');
        if (tableNumInput) {
            tableNumInput.addEventListener('input', function () {
                // QR code is generated AFTER saving (not during preview)
            });
        }

        function generateQRPreview() {
                    var tableNum = tableNumInput ? tableNumInput.value.trim() : '';
                    var qrContainer = document.getElementById('qrcode');
                    var qrPreview = document.getElementById('qrPreviewContainer');
                    var hiddenQR = document.getElementById('hiddenQRData');
                    var qrPlaceholder = document.getElementById('qrPlaceholder');

                    if (!qrContainer || !qrPreview) return;

                    qrContainer.innerHTML = '';
                    if (!tableNum || !selectedType) {
                        qrPreview.classList.add('d-none');
                        if (qrPlaceholder) qrPlaceholder.style.display = 'block';
                        if (hiddenQR) hiddenQR.value = '';
                        return;
                    }

                    qrPreview.classList.remove('d-none');
                    if (qrPlaceholder) qrPlaceholder.style.display = 'none';

                    // Generate a temporary QR code with a placeholder URL (without table_id — real one uses DB ID after save)
                    var tempUrl = window.location.origin + '/customer/customer.html?type=' + encodeURIComponent(selectedType);
                    if (typeof QRCode !== 'undefined') {
                        try {
                            new QRCode(qrContainer, {
                                text: tempUrl,
                                width: 150,
                                height: 150,
                                correctLevel: QRCode.CorrectLevel.L
                            });
                            // Grab the generated data URL after a short delay for rendering
                            setTimeout(function () {
                                var img = qrContainer.querySelector('img');
                                var canvas = qrContainer.querySelector('canvas');
                                var qrData = '';
                                if (img && img.src && img.src.startsWith('data:image')) {
                                    qrData = img.src;
                                } else if (canvas) {
                                    try { qrData = canvas.toDataURL('image/png'); } catch (e) {}
                                }
                                if (hiddenQR) hiddenQR.value = qrData;
                            }, 350);
                        } catch (e) {
                            console.warn('QRCode generation failed:', e);
                            qrContainer.innerHTML = '<div class="text-muted p-3 text-center"><i class="bi bi-qr-code" style="font-size:2rem;"></i><br><small>QR preview unavailable</small></div>';
                        }
                    } else {
                        qrContainer.innerHTML = '<div class="text-muted p-3 text-center"><i class="bi bi-qr-code" style="font-size:2rem;"></i><br><small>QR will be generated<br>after saving</small></div>';
                    }
                }

        // ---- ADD NEW TABLE BUTTON ----
        btnAdd.addEventListener('click', function () {
            // Reset form
            if (tableNumInput) tableNumInput.value = '';
            selectedType = '';
            document.querySelectorAll('.type-select-card').forEach(function (c) { c.classList.remove('selected'); });
            var qrPreview = document.getElementById('qrPreviewContainer');
            if (qrPreview) qrPreview.classList.add('d-none');
            var qrContainer = document.getElementById('qrcode');
            if (qrContainer) qrContainer.innerHTML = '';
            var hiddenQR = document.getElementById('hiddenQRData');
            if (hiddenQR) hiddenQR.value = '';
            var hint = document.getElementById('tableNumberHint');
            if (hint) {
                if (nextTableNumber) {
                    hint.textContent = 'Suggested next: ' + nextTableNumber;
                } else {
                    hint.textContent = 'Enter a table number (e.g. 1, 2, 3...)';
                }
            }

            // Ensure modal is initialized
            if (!addModal && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                addModal = new bootstrap.Modal(addModalEl, { backdrop: 'static', keyboard: false });
            }
            if (addModal) addModal.show();
            else {
                // Fallback: show modal manually
                addModalEl.classList.add('show');
                addModalEl.style.display = 'block';
                document.body.classList.add('modal-open');
                var backdrop = document.createElement('div');
                backdrop.className = 'modal-backdrop fade show';
                backdrop.id = 'temp-modal-backdrop';
                document.body.appendChild(backdrop);
            }
        });

        // ---- SAVE TABLE BUTTON ----
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var tableNum = document.getElementById('newTableNumber') ? document.getElementById('newTableNumber').value.trim() : '';

                if (!tableNum) {
                    Swal.fire('Error', selectedType === 'TAKEOUT' ? 'Please enter a takeout name.' : 'Please enter a table number.', 'error');
                    return;
                }
                if (!selectedType) {
                    Swal.fire('Error', 'Please select a table type (DINE IN or TAKEOUT).', 'error');
                    return;
                }

                var submitBtn = saveBtn;
                if (typeof LoadingManager !== 'undefined') {
                    LoadingManager.show(submitBtn, { text: 'Creating...' });
                }

                var formData = new FormData();
                formData.append('table_number', tableNum);
                formData.append('table_type', selectedType);
                // qr_code is NOT sent here — the real QR is generated AFTER save
                // with the actual DB table_id and saved via update_table_status.php

                authFetch(API.addTable, {
                    method: 'POST',
                    body: formData
                })
                    .then(function (res) { return res.json(); })
                    .then(function (data) {
                                            if (data.success) {
                                                // Generate and persist the QR before refreshing the table list.
                                                var realTableId = data.table_id;
                                                var qrContainer = document.getElementById('qrcode');
                                                var qrSavePromise = Promise.resolve();
                                                if (qrContainer && typeof QRCode !== 'undefined' && realTableId) {
                                                    var customerUrl = new URL('../../customer/customer.html?table_id=' + encodeURIComponent(realTableId) + '&type=' + encodeURIComponent(selectedType), window.location.href).href;
                                                    qrContainer.innerHTML = '';
                                                    new QRCode(qrContainer, {
                                                        text: customerUrl,
                                                        width: 150,
                                                        height: 150,
                                                        correctLevel: QRCode.CorrectLevel.L
                                                    });
                                                    qrSavePromise = new Promise(function (resolve, reject) {
                                                        setTimeout(function () {
                                                        var img = qrContainer.querySelector('img');
                                                        var canvas = qrContainer.querySelector('canvas');
                                                        var qrData = '';
                                                        if (img && img.src && img.src.startsWith('data:image')) {
                                                            qrData = img.src;
                                                        } else if (canvas) {
                                                            qrData = canvas.toDataURL('image/png');
                                                        }
                                                        var hiddenQR = document.getElementById('hiddenQRData');
                                                        if (hiddenQR) hiddenQR.value = qrData;

                                                        if (!qrData) {
                                                            reject(new Error('QR code data was not generated.'));
                                                            return;
                                                        }

                                                        authFetch(API.updateStatus, {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ table_id: realTableId, qr_code: qrData })
                                                        })
                                                            .then(function (res) { return res.json(); })
                                                            .then(function (result) {
                                                                if (!result.success) throw new Error(result.error || 'QR code could not be saved.');
                                                                resolve();
                                                            })
                                                            .catch(reject);
                                                        }, 300);
                                                    });
                                                }

                                                qrSavePromise.then(function () {
                                                    if (addModal) addModal.hide();
                                                    else {
                                                        addModalEl.classList.remove('show');
                                                        addModalEl.style.display = 'none';
                                                        document.body.classList.remove('modal-open');
                                                        var backdrop = document.getElementById('temp-modal-backdrop');
                                                        if (backdrop) backdrop.remove();
                                                    }
                                                    fetchTables();
                                                    Swal.fire({
                                                        title: 'Success!',
                                                        text: 'Table ' + tableNum + ' (' + selectedType + ') has been created.',
                                                        icon: 'success',
                                                        confirmButtonColor: '#007d43'
                                                    });
                                                }).catch(function (err) {
                                                    console.error('QR save error:', err);
                                                    Swal.fire('Table created, QR pending', 'The table was created but its QR code could not be saved. Please reload and try again.', 'warning');
                                                    fetchTables();
                                                });
                                            } else if (data.error === 'TABLE_EXISTS_DELETED') {
                                                Swal.fire('Table number already exists', 'This table number or name is already in the Deleted list. Restore that table or choose a different name.', 'warning');
                                            } else if (data.error === 'TABLE_EXISTS') {
                                                Swal.fire('Table number already exists', 'This table number or name is already assigned to an active table. Choose a different name.', 'error');
                                            } else {
                                                Swal.fire('Error', data.error || 'Failed to create table.', 'error');
                                            }
                    })
                    .catch(function (err) {
                        console.error('Save error:', err);
                        Swal.fire('Error', 'Something went wrong. Check console.', 'error');
                    })
                    .finally(function () {
                        if (typeof LoadingManager !== 'undefined') {
                            LoadingManager.hide(submitBtn);
                        }
                    });
            });
        }

        // ---- FETCH TABLES ----
        function fetchTables() {
            var search = searchInput ? searchInput.value.trim() : '';
            var type = filterType ? filterType.value : '';
            var status = filterStatus ? filterStatus.value : '';
            var deleted = filterDeleted ? filterDeleted.value : '0';

            var params = new URLSearchParams();
            if (search) params.append('search', search);
            if (type) params.append('type', type);
            if (status) params.append('status', status);
            if (deleted) params.append('deleted', deleted);
            params.append('page', currentPage);
            params.append('limit', limit);

            authFetch(API.fetchTables + '?' + params.toString(), { method: 'GET', headers: {} })
                .then(function (res) { return res.json(); })
                .then(function (data) {
                                    var tables = data.data || [];
                                    totalTables = data.total || 0;
                                    allTables = data.data || []; // Store full dataset for stats
                                    nextTableNumber = data.next_table_number || null;
                                    renderTables(tables);
                                    updatePagination(data.page || 1, totalTables, data.limit || limit);
                                    updateStats();
                })
                .catch(function (err) {
                    console.error('Fetch error:', err);
                    var grid = document.getElementById('tableGrid');
                    if (grid) grid.innerHTML = '<div class="col-12 text-center py-4"><p class="text-danger">Failed to load tables. Check your session.</p></div>';
                });
        }

        // ---- RENDER TABLES ----
        function renderTables(tables) {
            var grid = document.getElementById('tableGrid');
            var empty = document.getElementById('tableGridEmpty');
            if (!grid) return;
            grid.innerHTML = '';

            if (!tables || tables.length === 0) {
                if (empty) empty.classList.remove('d-none');
                return;
            }
            if (empty) empty.classList.add('d-none');

            tables.forEach(function (t) {
                            var statusLower = (t.status || 'available').toLowerCase();
                            var badgeClass = 'bg-success';
                            var badgeColor = '';
                            if (statusLower === 'occupied') {
                                badgeClass = 'bg-danger';
                            } else if (statusLower === 'maintenance') {
                                badgeClass = 'bg-warning text-dark';
                            } else if (t.table_type === 'TAKEOUT') {
                                badgeClass = '';
                                badgeColor = 'background-color:#fd7e14;';
                            }

                            var safeTableId = escapeHtml(t.table_id);
                            var safeTableNum = escapeHtml(t.table_number);
                            var safeTableType = escapeHtml(t.table_type);
                            var safeStatus = escapeHtml(t.status || 'AVAILABLE');
                            var safeQrCode = escapeHtml(t.qr_code || '');

                            var actionsHtml = '';
                            if (t.is_deleted == 1) {
                                actionsHtml = '<button class="btn btn-outline-secondary w-100 restore-btn" data-id="' + safeTableId + '" data-num="' + safeTableNum + '"><i class="bi bi-arrow-counterclockwise me-1"></i>Restore</button>';
                            } else {
                                actionsHtml = '<div class="d-flex gap-1">' +
                                    '<button class="btn btn-outline-info flex-fill download-btn" data-num="' + safeTableNum + '" data-qr="' + encodeURIComponent(safeQrCode) + '" title="Download QR"><i class="bi bi-download"></i></button>' +
                                    '<button class="btn btn-outline-primary flex-fill edit-btn" data-id="' + safeTableId + '" data-num="' + safeTableNum + '" data-type="' + safeTableType + '" data-status="' + safeStatus + '" title="Edit"><i class="bi bi-pencil"></i></button>' +
                                    '<button class="btn btn-outline-danger flex-fill delete-btn" data-id="' + safeTableId + '" data-num="' + safeTableNum + '" title="Delete"><i class="bi bi-trash"></i></button>' +
                                    '</div>';
                            }

                            var card = '<div class="col-lg-3 col-md-4 col-sm-6 col-12">' +
                                '<div class="card border-0 shadow-sm qr-table-card h-100">' +
                                '<div class="position-relative">' +
                                '<span class="badge ' + badgeClass + ' position-absolute top-0 end-0 m-2 status-badge" style="' + badgeColor + '">' + safeStatus + '</span>' +
                                '<div class="text-center p-3 pb-0">' +
                                '<h6 class="fw-bold mb-1">' + (t.table_type === 'TAKEOUT' ? '' : 'Table ') + safeTableNum + '</h6>' +
                                '<small class="text-muted">' + safeTableType + '</small></div>' +
                                '<div class="text-center p-2"><img src="' + safeQrCode + '" alt="QR" class="img-fluid card-img-top" style="max-width:120px;" onerror="this.style.display=\'none\'"></div></div>' +
                                '<div class="card-body p-3 pt-0">' + actionsHtml + '</div></div></div>';

                            grid.insertAdjacentHTML('beforeend', card);
                        });

            // Bind event listeners using event delegation
            grid.querySelectorAll('.download-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var num = this.dataset.num;
                    var qr = decodeURIComponent(this.dataset.qr);
                    downloadQR(num, qr);
                });
            });
            grid.querySelectorAll('.edit-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    openEditModal(this.dataset.id, this.dataset.num, this.dataset.type, this.dataset.status);
                });
            });
            grid.querySelectorAll('.delete-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    confirmDelete(this.dataset.id, this.dataset.num);
                });
            });
            grid.querySelectorAll('.restore-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    confirmRestore(this.dataset.id, this.dataset.num);
                });
            });
        }

        // ---- STATS (BROKEN-STATS-FIX) ----
                function updateStats() {
                    var total = document.querySelector('.total-count');
                    var avail = document.querySelector('.available-count');
                    var occ = document.querySelector('.occupied-count');
                    var availCount = 0;
                    var occCount = 0;
                    allTables.forEach(function (t) {
                        if (t.is_deleted != 1) {
                            if (t.status === 'AVAILABLE') availCount++;
                            if (t.status === 'OCCUPIED') occCount++;
                        }
                    });
                    if (total) total.textContent = totalTables || 0;
                    if (avail) avail.textContent = availCount;
                    if (occ) occ.textContent = occCount;
                }

        // ---- PAGINATION ----
        function updatePagination(page, total, limitPerPage) {
            var totalPages = Math.ceil(total / limitPerPage) || 1;
            var info = document.getElementById('paginationInfo');
            var prev = document.getElementById('prevPage');
            var next = document.getElementById('nextPage');
            if (info) info.textContent = 'Page ' + page + ' of ' + totalPages;
            if (prev) {
                prev.parentElement.classList.toggle('disabled', page <= 1);
                prev.onclick = function (e) {
                    e.preventDefault();
                    if (currentPage > 1) { currentPage--; fetchTables(); }
                };
            }
            if (next) {
                next.parentElement.classList.toggle('disabled', page >= totalPages);
                next.onclick = function (e) {
                    e.preventDefault();
                    if (currentPage < totalPages) { currentPage++; fetchTables(); }
                };
            }
        }

        // ---- EDIT MODAL ----
        function openEditModal(id, number, type, status) {
            editingTableId = id;
            document.getElementById('editTableNumber').textContent = number;
            document.getElementById('editTableType').textContent = type;
            if (!editModal && typeof bootstrap !== 'undefined' && bootstrap.Modal && editModalEl) {
                editModal = new bootstrap.Modal(editModalEl, { backdrop: 'static', keyboard: false });
            }
            if (editModal) editModal.show();
        }

        document.querySelectorAll('.edit-status-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var newStatus = this.dataset.status;
                var number = document.getElementById('editTableNumber').textContent;
                if (!editingTableId) {
                    Swal.fire('Error', 'No table selected.', 'error');
                    return;
                }
                Swal.fire({
                    title: 'Change status to ' + newStatus + '?',
                    text: 'Table ' + number + ' will be set to ' + newStatus + '.',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: newStatus === 'AVAILABLE' ? '#28a745' : '#ffc107',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: 'Yes, ' + newStatus
                }).then(function (result) {
                    if (result.isConfirmed) {
                        authFetch(API.updateStatus, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ table_id: Number(editingTableId), status: newStatus })
                        })
                            .then(function (res) { return res.json(); })
                            .then(function (data) {
                                if (data.success) {
                                    if (editModal) editModal.hide();
                                    fetchTables();
                                    Swal.fire('Updated!', 'Table ' + number + ' is now ' + newStatus + '.', 'success');
                                } else if (data.error === 'TABLE_HAS_ACTIVE_ORDER') {
                                    Swal.fire('Cannot Free Table', data.message || 'This table still has an active order.', 'warning');
                                } else {
                                    Swal.fire('Error', data.error || 'Failed to update status.', 'error');
                                }
                            })
                            .catch(function (err) {
                                console.error('Update error:', err);
                                Swal.fire('Error', 'Something went wrong.', 'error');
                            });
                    }
                });
            });
        });

        // ---- DELETE TABLE ----
        function confirmDelete(id, number) {
            Swal.fire({
                title: 'Delete Table ' + number + '?',
                text: 'This will soft-delete the table. You can restore it later.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Yes, delete it!'
            }).then(function (result) {
                if (result.isConfirmed) {
                    authFetch(API.deleteTable, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ table_id: parseInt(id) })
                    })
                        .then(function (res) { return res.json(); })
                        .then(function (data) {
                            if (data.success) {
                                fetchTables();
                                Swal.fire('Deleted!', 'Table ' + number + ' has been soft-deleted.', 'success');
                            } else if (data.error === 'TABLE_HAS_ACTIVE_ORDER') {
                                Swal.fire('Cannot Delete Table', data.message || 'This table still has an active order.', 'warning');
                            } else {
                                Swal.fire('Error', data.error || 'Failed to delete table.', 'error');
                            }
                        })
                        .catch(function (err) {
                            console.error('Delete error:', err);
                            Swal.fire('Error', 'Something went wrong.', 'error');
                        });
                }
            });
        }

        // ---- RESTORE TABLE ----
        function confirmRestore(id, number) {
            Swal.fire({
                title: 'Restore Table ' + number + '?',
                text: 'This will restore the soft-deleted table.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#28a745',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Yes, restore it!'
            }).then(function (result) {
                if (result.isConfirmed) {
                    authFetch(API.restoreTable, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ table_id: parseInt(id) })
                    })
                        .then(function (res) { return res.json(); })
                        .then(function (data) {
                            if (data.success) {
                                fetchTables();
                                Swal.fire('Restored!', 'Table ' + number + ' has been restored.', 'success');
                            } else {
                                Swal.fire('Error', data.error || 'Failed to restore table.', 'error');
                            }
                        })
                        .catch(function (err) {
                            console.error('Restore error:', err);
                            Swal.fire('Error', 'Something went wrong.', 'error');
                        });
                }
            });
        }

        // ---- DOWNLOAD QR ----
        function downloadQR(tableNumber, base64Data) {
            if (!base64Data) {
                Swal.fire('No QR', 'No QR code data available for this table.', 'info');
                return;
            }
            var link = document.createElement('a');
            link.href = base64Data;
            link.download = 'HOF_Table_' + tableNumber + '_QR.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // ---- FILTER EVENTS ----
        if (searchInput) {
            searchInput.addEventListener('input', function () { currentPage = 1; fetchTables(); });
        }
        if (filterType) {
            filterType.addEventListener('change', function () { currentPage = 1; fetchTables(); });
        }
        if (filterStatus) {
            filterStatus.addEventListener('change', function () { currentPage = 1; fetchTables(); });
        }
        if (filterDeleted) {
            filterDeleted.addEventListener('change', function () { currentPage = 1; fetchTables(); });
        }

        // ---- INITIAL LOAD ----
        fetchTables();

        // Clean up backdrop on modal hide
        if (addModalEl) {
            addModalEl.addEventListener('hidden.bs.modal', function () {
                var backdrop = document.getElementById('temp-modal-backdrop');
                if (backdrop) backdrop.remove();
            });
        }
    }

    // Wait for DOM and dependencies
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();