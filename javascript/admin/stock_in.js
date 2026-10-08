document.addEventListener("DOMContentLoaded", () => {

    const addBtn = document.getElementById("addItemBtn");
    const tbody = document.getElementById("stockInItemBody");
    const tableContainer = document.getElementById("stockInTableContainer");
    const grandTotalEl = document.getElementById("stockInGrandTotal");
    const form = document.getElementById("stockInForm");

    const qtyInput = document.getElementById("tempQty");
    const costInput = document.getElementById("tempCost");
    const expInput = document.getElementById("tempExp");
    const materialSelect = document.getElementById("tempMaterial");
    const subtotalDisplay = document.getElementById("tempSubtotalDisplay");

    let items = [];
    let allStockInRecords = [];
    let stockInPage = 1;
    let stockInTotal = 0;

    function renderAdminStockInPager() {
        const pagerEl = document.getElementById('stockInPager');
        if (!pagerEl) return;
        const pages = Math.max(1, Math.ceil(stockInTotal / 10));
        let html = '';
        for (let i = 1; i <= pages; i++) {
            html += `<li class="page-item ${i === stockInPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }
        pagerEl.innerHTML = html;
        pagerEl.querySelectorAll('a[data-page]').forEach(a => {
            a.addEventListener('click', e => {
                e.preventDefault();
                stockInPage = parseInt(a.dataset.page, 10);
                loadStockInRecords();
            });
        });
    }

    // Helper method to centrally inject JWT authorization tokens across all actions
    function getHeaders(contentType = "application/json") {
        const token = localStorage.getItem("hof_token");
        const headers = {
            "Authorization": `Bearer ${token}`
        };
        if (contentType) {
            headers["Content-Type"] = contentType;
        }
        return headers;
    }

    // ==========================================
    // INITIALIZATION RUNTIME
    // ==========================================
    loadMaterialsAndStats();
    loadStockInRecords();

    // ==========================================
    // POPULATE SUPPLIER DROPDOWN ON MODAL OPEN
    // ==========================================
    const stockInModal = document.getElementById('stockInModal');
    if (stockInModal) {
        stockInModal.addEventListener('shown.bs.modal', function () {
            const select = document.getElementById('supplierSelect');
            if (select && select.options.length <= 1) {
                fetch('../../backend/admin/suppliers/list.php?limit=100')
                    .then(r => r.json())
                    .then(data => {
                        if (data.status === 'success' && data.data && data.data.items) {
                            data.data.items.forEach(function(s) {
                                const opt = document.createElement('option');
                                opt.value = s.supplier_id;
                                opt.textContent = s.supplier_name;
                                select.appendChild(opt);
                            });
                        }
                    })
                    .catch(function() {});
            }
        });
    }

    // ==========================================
    // CORE DATA FETCH: MATERIALS & CARD STATS
    // ==========================================
    async function loadMaterialsAndStats() {
        try {
            const res = await fetch("/backend/admin/manageInventory/get_materials.php", {
                method: "GET",
                headers: getHeaders(null) // Dynamic injection fixes 401 on initialization
            });
            const json = await res.json();

            if (json.status === 'success' || json.success) {
                // 1. Populate the 4 Stats Dashboard Cards
                // REQ-068: KPI cards come from the inventoryReports stats endpoint (get_materials no longer returns stats)
                if (document.getElementById("totalItems") || document.getElementById("lowStock") || document.getElementById("outStock") || document.getElementById("damagedStock")) {
                    fetch("/backend/admin/inventoryReports/get_stats.php", { method: "GET", headers: getHeaders(null) })
                        .then(r => r.json())
                        .then(s => {
                            const d = s.data || {};
                            if (document.getElementById("totalItems")) document.getElementById("totalItems").textContent = d.total || 0;
                            if (document.getElementById("lowStock")) document.getElementById("lowStock").textContent = d.low || 0;
                            if (document.getElementById("outStock")) document.getElementById("outStock").textContent = d.out || 0;
                            if (document.getElementById("damagedStock")) document.getElementById("damagedStock").textContent = d.damaged || 0;
                        })
                        .catch(() => {});
                }

                // 2. Fire live navbar notification alerts
                checkStockAlerts(json.data);

                // 3. Populate Material Select Input Field Options
                let options = `<option value="" selected disabled>Choose Material...</option>`;
                if (Array.isArray(json.data)) {
                    json.data.forEach(mat => {
                        options += `
                            <option value="${mat.raw_material_id}" 
                                    data-name="${mat.raw_material_name}" 
                                    data-perishable="${mat.is_perishable}">
                                ${mat.raw_material_name} ${mat.unit ? '(' + mat.unit + ')' : ''}
                            </option>`;
                    });
                }
                materialSelect.innerHTML = options;

            } else {
                throw new Error(json.message || "Failed to load materials database.");
            }
        } catch (err) {
            console.error("Material load error:", err);
            if (materialSelect) materialSelect.innerHTML = `<option value="" disabled>Error loading materials</option>`;
        }
    }

    // ==========================================
    // PERISHABLE CALENDAR SELECTION LOGIC
    // ==========================================
    materialSelect.addEventListener("change", function () {
        const selectedOption = this.options[this.selectedIndex];
        const isPerishable = selectedOption.dataset.perishable == "1";

        if (isPerishable) {
            expInput.disabled = false;
            expInput.classList.remove("bg-light");
        } else {
            expInput.disabled = true;
            expInput.value = "";
            expInput.classList.add("bg-light");
        }
    });

    // ==========================================
    // AUTO CALCULATE ITEM COST SUBTOTALS
    // ==========================================
    function calculateTempSubtotal() {
        const qty = parseFloat(qtyInput.value) || 0;
        const cost = parseFloat(costInput.value) || 0;
        const subtotal = qty * cost;
        subtotalDisplay.value = subtotal.toFixed(2);
    }

    qtyInput.addEventListener("input", calculateTempSubtotal);
    costInput.addEventListener("input", calculateTempSubtotal);

    // ==========================================
    // MODAL STAGING: ADD ITEM TO STAGED BATCH
    // ==========================================
    addBtn.addEventListener("click", () => {
        const qty = parseFloat(qtyInput.value);
        const cost = parseFloat(costInput.value);
        const exp = expInput.value;

        const materialId = materialSelect.value;
        const selectedOption = materialSelect.options[materialSelect.selectedIndex];
        const materialName = selectedOption?.dataset.name;
        const isPerishable = selectedOption?.dataset.perishable == "1";

        if (!materialId || isNaN(qty) || isNaN(cost) || qty <= 0) {
            Swal.fire("Missing Data", "Please select a material and enter valid quantity/cost", "warning");
            return;
        }

        if (isPerishable && !exp) {
            Swal.fire("Required Field", "Please provide an expiration date for this perishable item.", "warning");
            return;
        }

        const subtotal = qty * cost;

        const newItem = {
            material_id: materialId,
            material_name: materialName,
            quantity: qty,
            unit_cost: cost,
            expiration_date: exp,
            subtotal: subtotal
        };

        const duplicateIndex = items.findIndex(item => item.material_id === newItem.material_id);

        if (duplicateIndex !== -1) {
            Swal.fire({
                title: 'Item Already Added',
                text: `"${newItem.material_name}" is already in your staging list. Would you like to combine the quantities?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, merge them!'
            }).then((result) => {
                if (result.isConfirmed) {
                    const totalQty = parseFloat(items[duplicateIndex].quantity) + newItem.quantity;
                    updateItemQuantity(duplicateIndex, totalQty);
                    clearInputs();
                }
            });
            return;
        }

        items.push(newItem);
        renderTable();
        clearInputs();
    });

    // ==========================================
    // RENDER LOCAL TRANSACTION BATCH TABLE
    // ==========================================
    function renderTable() {
        tbody.innerHTML = "";
        let grandTotal = 0;

        items.forEach((item, index) => {
            grandTotal += item.subtotal;

            const row = document.createElement("tr");
            row.innerHTML = `
                <td class="ps-3 align-middle">${item.material_name}</td>
                <td class="align-middle">
                    <div class="input-group input-group-sm" style="max-width: 130px;">
                        <button type="button" class="btn btn-outline-secondary minus-btn">-</button>
                        <input type="number" class="form-control text-center qty-input" value="${item.quantity}" min="1" step="any">
                        <button type="button" class="btn btn-outline-secondary plus-btn">+</button>
                    </div>
                </td>
                <td class="align-middle">₱${item.unit_cost.toFixed(2)}</td>
                <td class="fw-bold text-primary align-middle">₱${item.subtotal.toFixed(2)}</td>
                <td class="align-middle">${item.expiration_date || "-"}</td>
                <td class="text-center align-middle">
                    <button type="button" class="btn btn-sm btn-danger remove-btn">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>`;

            row.querySelector(".minus-btn").addEventListener("click", () => {
                if (item.quantity > 1) {
                    updateItemQuantity(index, parseFloat(item.quantity) - 1);
                }
            });

            row.querySelector(".plus-btn").addEventListener("click", () => {
                updateItemQuantity(index, parseFloat(item.quantity) + 1);
            });

            row.querySelector(".qty-input").addEventListener("change", (e) => {
                let val = parseFloat(e.target.value) || 1;
                if (val < 1) val = 1;
                updateItemQuantity(index, val);
            });

            row.querySelector(".remove-btn").addEventListener("click", () => {
                removeItem(index);
            });

            tbody.appendChild(row);
        });

        grandTotalEl.textContent = "₱" + grandTotal.toFixed(2);
        tableContainer.classList.toggle("d-none", items.length === 0);
    }

    function updateItemQuantity(index, newQty) {
        items[index].quantity = newQty;
        items[index].subtotal = items[index].quantity * items[index].unit_cost;
        renderTable();
    }

    function removeItem(index) {
        items.splice(index, 1);
        renderTable();
    }

    function clearInputs() {
        materialSelect.value = "";
        qtyInput.value = "";
        costInput.value = "";
        expInput.value = "";
        expInput.disabled = true;
        subtotalDisplay.value = "";
    }

    // ==========================================
    // SUBMIT TRANSACTION PACKET TO BACKEND PHP
    // ==========================================
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (items.length === 0) {
            Swal.fire("No Items", "Add at least one item to the list first", "warning");
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        LoadingManager.show(submitBtn || form, { text: 'Submitting stock in...' });

        const formData = new FormData(form);
        const supplierId = formData.get("supplier_id") || document.getElementById("supplierSelect")?.value || document.getElementById("supplier_id")?.value;
        const stockInDate = formData.get("stock_in_date") || document.getElementById("stockInDate")?.value || document.getElementById("stock_in_date")?.value;
        const remarksValue = formData.get("remarks") || document.getElementById("stockInRemarks")?.value || "";

        const payload = {
            supplier_id: supplierId ? parseInt(supplierId) : null,
            stock_in_date: stockInDate || null,
            remarks: remarksValue.trim(),
            items: items.map(item => ({
                material_id: parseInt(item.material_id),
                quantity: parseFloat(item.quantity),
                unit_cost: parseFloat(item.unit_cost),
                subtotal: parseFloat(item.subtotal),
                expiration_date: item.expiration_date || null
            }))
        };

        try {
            const res = await fetch("/backend/admin/manageInventory/add_stock_in.php", {
                method: "POST",
                headers: getHeaders("application/json"),
                body: JSON.stringify(payload)
            });

            const textResponse = await res.text();
            let data;
            try {
                data = JSON.parse(textResponse);
            } catch (jsonErr) {
                console.error("Server raw response was not valid JSON:", textResponse);
                throw new Error("Server returned an invalid format instead of JSON data.");
            }

            if (res.status === 401) {
                Swal.fire("Unauthorized", "Your session token expired. Please re-authenticate.", "error");
                return;
            }

            if (!data.success) {
                Swal.fire("Validation Failure", data.message || "The database rejected your payload structure.", "warning");
                return;
            }

            Swal.fire({
                icon: "success",
                title: "Stock In Recorded",
                text: data.message || "Inventory logs recorded successfully."
            }).then(() => {
                items = [];
                renderTable();
                form.reset();

                const modalEl = document.getElementById("stockInModal");
                if (modalEl) {
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    if (modal) modal.hide();
                }
                location.reload();
            });

        } catch (err) {
            console.error("Fetch implementation failed entirely:", err);
            Swal.fire("Error", err.message || "Server connection failed", "error");
        } finally {
            LoadingManager.hide(submitBtn || form);
        }
    });

    // ==========================================
    // FETCH AND DISPLAY COMPLETED RECORDS HISTORY
    // ==========================================
    async function loadStockInRecords() {
        const mainTbody = document.getElementById("stockinTableBody");
        const pendingTbody = document.querySelector(".pending-table-card tbody");
        const pendingBadge = document.querySelector(".pending-table-card .badge");
        const pendingCard = document.querySelector(".pending-table-card");

        try {
            const res = await fetch("/backend/admin/manageInventory/get_stock_in_list.php?page=" + stockInPage, {
                method: "GET",
                headers: getHeaders(null) // Dynamic injection fixes 401 here too
            });
            const json = await res.json();

            if (json.success) {
                const approvedArr = Array.isArray(json.approved) ? json.approved : [];
                const pendingArr = Array.isArray(json.pending) ? json.pending : [];
                allStockInRecords = [...approvedArr, ...pendingArr];
                stockInTotal = (json.pagination && json.pagination.total) || approvedArr.length;
                renderAdminStockInPager();

                if (approvedArr.length > 0 && mainTbody) {
                    mainTbody.innerHTML = approvedArr.map(item => {
                        const statusText = item.status || 'Approved';
                        let badgeClass = 'bg-success text-white';

                        if (statusText.toLowerCase() === 'rejected' || statusText.toLowerCase() === 'cancelled') {
                            badgeClass = 'bg-danger text-white';
                        } else if (statusText.toLowerCase() === 'pending') {
                            badgeClass = 'bg-warning text-dark';
                        }

                        return `
                        <tr>
                            <td class="ps-4">
                                <div class="fw-bold">${item.raw_material_name}</div>
                            </td>
                            <td>${parseFloat(item.quantity).toFixed(2)}</td>
                            <td>₱${parseFloat(item.unit_cost).toFixed(2)}</td>
                            <td class="text-primary fw-bold">₱${parseFloat(item.subtotal).toFixed(2)}</td>
                            <td>
                                <span class="badge ${badgeClass}">${statusText}</span>
                            </td>
                            <td>
                                <button type="button" class="btn btn-sm btn-primary view-stockin-btn" data-id="${item.stock_in_id || item.id || ''}">
                                    <i class="bi bi-eye"></i>
                                </button>
                            </td>
                        </tr>`;
                    }).join('');
                } else if (mainTbody) {
                    mainTbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No completed history found.</td></tr>`;
                }

                if (pendingBadge) pendingBadge.textContent = pendingArr.length;

                setupPendingCardHeaders(pendingCard, pendingArr.length);

                if (pendingArr.length > 0 && pendingTbody) {
                    pendingTbody.innerHTML = pendingArr.map(item => `
                    <tr>
                        <td class="ps-3 py-2" style="width: 40px;">
                            <input type="checkbox" class="form-check-input pending-select-chk" data-id="${item.stock_in_id}">
                        </td>
                        <td class="py-2">
                            <div class="fw-bold text-dark">${item.raw_material_name}</div>
                            <small class="text-muted">Qty: ${parseFloat(item.quantity).toFixed(2)} | By: ${item.first_name || ''} ${item.last_name || 'Staff'}</small>
                        </td>
                        <td class="text-end pe-3">
                            <button type="button" class="btn btn-sm btn-primary view-stockin-btn" data-id="${item.stock_in_id}">
                                <i class="bi bi-eye"></i>
                            </button>
                        </td>
                    </tr>`).join('');

                    document.getElementById("pendingActionFooter")?.classList.remove("d-none");
                } else if (pendingTbody) {
                    pendingTbody.innerHTML = `
                    <tr>
                        <td colspan="3" class="text-center py-4 text-muted small">
                            <i class="bi bi-check-circle text-success d-block mb-1 fs-4"></i>
                            No pending approvals.
                        </td>
                    </tr>`;
                    document.getElementById("pendingActionFooter")?.classList.add("d-none");
                }

                document.querySelectorAll('.view-stockin-btn').forEach(btn => {
                    btn.removeEventListener('click', handleViewClick);
                    btn.addEventListener('click', handleViewClick);
                });

                initBatchApprovalListeners();
            }
        } catch (err) {
            console.error("Error loading history table layouts:", err);
        }
    }

    function handleViewClick() {
        const id = this.getAttribute('data-id');
        if (typeof showStockInDetailsSwal === 'function') {
            showStockInDetailsSwal(id);
        }
    }

    function setupPendingCardHeaders(cardEl, pendingCount) {
        if (!cardEl) return;

        let headerCheck = document.getElementById("selectAllPendingHeader");
        if (!headerCheck && pendingCount > 0) {
            const cardHeader = cardEl.querySelector(".card-header") || cardEl;
            const div = document.createElement("div");
            div.id = "selectAllPendingHeader";
            div.className = "d-flex align-items-center mt-2 pt-2 border-top";
            div.innerHTML = `
                <input type="checkbox" id="selectAllPendingChk" class="form-check-input me-2 ms-1">
                <label for="selectAllPendingChk" class="small fw-bold text-secondary" style="cursor:pointer;">Select All Pending Items</label>
            `;
            cardHeader.appendChild(div);
        } else if (headerCheck && pendingCount === 0) {
            headerCheck.remove();
        }

        let footerCheck = document.getElementById("pendingActionFooter");
        if (!footerCheck && cardEl) {
            const footer = document.createElement("div");
            footer.id = "pendingActionFooter";
            footer.className = "card-footer bg-white d-none py-2 text-end border-top-0";
            footer.innerHTML = `
                <button type="button" id="approveSelectedBtn" class="btn btn-sm btn-success w-100 fw-bold py-2">
                    <i class="bi bi-check2-all me-1"></i> Approve Selected
                </button>
            `;
            cardEl.appendChild(footer);
        }
    }

    function initBatchApprovalListeners() {
        const selectAllChk = document.getElementById("selectAllPendingChk");
        const itemCheckboxes = document.querySelectorAll(".pending-select-chk");
        const approveBtn = document.getElementById("approveSelectedBtn");

        if (selectAllChk) {
            selectAllChk.checked = false;
            selectAllChk.addEventListener("change", function () {
                itemCheckboxes.forEach(chk => chk.checked = this.checked);
            });
        }

        if (approveBtn) {
            approveBtn.addEventListener("click", async () => {
                const selectedIds = [];
                document.querySelectorAll(".pending-select-chk:checked").forEach(chk => {
                    selectedIds.push(chk.getAttribute("data-id"));
                });

                if (selectedIds.length === 0) {
                    Swal.fire("Selection Empty", "Please check at least one pending record to approve.", "warning");
                    return;
                }

                const confirmAction = await Swal.fire({
                    title: 'Batch Approval',
                    text: `Are you sure you want to approve all ${selectedIds.length} selected stock-in requests?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: '#198754',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: 'Yes, Approve All!'
                });

                if (!confirmAction.isConfirmed) return;

                // REQ-056: BEFORE approving, ALWAYS let the approver update the
                // unit cost of the pending materials (persisted as the new
                // raw_materials.cost_per_unit used for future cost).
                let costUpdates = {};
                try {
                    const pendingRows = allStockInRecords.filter(r => selectedIds.includes(String(r.stock_in_id)));
                    // Unique raw materials among the selected pending rows
                    const seen = {};
                    const rows = [];
                    pendingRows.forEach(r => {
                        const mid = r.raw_material_id;
                        if (!seen[mid]) { seen[mid] = true; rows.push(r); }
                    });
                    if (rows.length > 0) {
                        const costResult = await Swal.fire({
                            title: 'Unit Cost changed? If yes, edit + save new cost_per_unit',
                            html: rows.map(r => `
                                <div class="d-flex align-items-center justify-content-between mb-2 text-start" style="font-size:.9rem;">
                                    <span class="me-2">${escapeHtml(r.raw_material_name)}</span>
                                    <input type="number" class="form-control form-control-sm" style="max-width:150px;" step="0.01" min="0"
                                           id="cost_${r.raw_material_id}" value="${Number(r.current_cost || 0).toFixed(2)}">
                                </div>`).join(''),
                            icon: 'question',
                            showCancelButton: true,
                            confirmButtonColor: '#198754',
                            cancelButtonColor: '#6c757d',
                            confirmButtonText: 'Approve',
                            focusConfirm: false,
                            preConfirm: () => {
                                rows.forEach(r => {
                                    const input = document.getElementById('cost_' + r.raw_material_id);
                                    const newVal = parseFloat(input ? input.value : NaN);
                                    const oldVal = parseFloat(r.current_cost || 0);
                                    if (!isNaN(newVal) && Math.abs(newVal - oldVal) > 0.001) {
                                        costUpdates[r.raw_material_id] = newVal;
                                    }
                                });
                            }
                        });
                        if (!costResult.isConfirmed) return;
                    }
                } catch (e) {
                    // If the cost prompt fails for any reason, proceed with approval only.
                    costUpdates = {};
                }

                LoadingManager.show(approveBtn, { text: 'Approving...' });

                try {
                    const res = await fetch("/backend/admin/manageInventory/batch_approve_stock_in.php", {
                        method: "POST",
                        headers: getHeaders("application/json"),
                        body: JSON.stringify({ stock_in_ids: selectedIds, cost_updates: costUpdates })
                    });
                    const data = await res.json();

                    if (data.success) {
                        Swal.fire("Approved!", data.message, "success").then(() => {
                            location.reload();
                        });
                    } else {
                        Swal.fire("Error", data.message, "error");
                    }
                } catch (err) {
                    console.error(err);
                    Swal.fire("Error", "Server sync communication failure.", "error");
                } finally {
                    LoadingManager.hide(approveBtn);
                }
            });
        }
    }

    function checkStockAlerts(materialsList) {
        const badge = document.getElementById('notificationBadge');
        const menu = document.getElementById('notificationMenu');
        if (!menu || !badge || !Array.isArray(materialsList)) return;

        let activeAlerts = [];

        materialsList.forEach(material => {
            const qty = parseFloat(material.current_quantity);
            const reorderLevel = parseFloat(material.reorder_level);

            let alertText = "";
            let isCritical = false;

            if (!isNaN(qty) && !isNaN(reorderLevel)) {
                if (qty <= 0) {
                    alertText = `⚠️ <strong>${material.raw_material_name}</strong> is completely out of stock! Restock immediately.`;
                    isCritical = true;
                } else if (qty <= reorderLevel) {
                    alertText = `⚠️ <strong>${material.raw_material_name}</strong> is low on stock (${qty} ${material.unit || 'pcs'} left). Restock soon!`;
                    isCritical = false;
                }
            }

            if (alertText) {
                activeAlerts.push({
                    text: alertText,
                    isCritical: isCritical,
                    updatedAt: material.updated_at ? new Date(material.updated_at).getTime() : 0
                });
            }
        });

        menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';

        if (activeAlerts.length > 0) {
            activeAlerts.sort((a, b) => b.updatedAt - a.updatedAt);

            activeAlerts.forEach(alert => {
                menu.innerHTML += `
                <li>
                    <a class="dropdown-item py-2 border-bottom text-wrap" href="manage_inventory.html" style="font-size: 0.9rem;">
                        <div style="color: ${alert.isCritical ? '#dc3545' : '#b57d00'};">
                            ${alert.text}
                        </div>
                    </a>
                </li>`;
            });

            badge.textContent = activeAlerts.length;
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
            menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All inventory levels are normal.</span></li>`;
        }
    }

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString('en-US', options);
    }

    function showStockInDetailsSwal(id) {
        const item = allStockInRecords.find(record => String(record.stock_in_id) === String(id));

        if (!item) {
            Swal.fire('Error', 'Could not locate record details locally.', 'error');
            return;
        }

        const unitCost = item.unit_cost ? `₱${parseFloat(item.unit_cost).toFixed(2)}` : '₱0.00';
        const totalCost = item.subtotal ? `₱${parseFloat(item.subtotal).toFixed(2)}` : '₱0.00';

        const expDate = item.expiration_date && item.expiration_date !== '0000-00-00' ? formatDate(item.expiration_date) : 'N/A';
        const stockInDate = item.stock_in_date ? formatDate(item.stock_in_date) : 'N/A';
        const approvedAt = item.approved_at && item.approved_at !== '0000-00-00 00:00:00' ? formatDate(item.approved_at) : 'N/A';

        const currentStatus = (item.status || 'Pending').toUpperCase();

        let approverDisplay = '<em>Awaiting Review</em>';
        if (currentStatus === 'APPROVED') {
            approverDisplay = item.approver_name || `Admin (ID: ${item.approved_by})`;
        } else if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') {
            approverDisplay = item.approver_name || `Declined by Admin`;
        }

        const htmlContent = `
            <div class="table-responsive text-start px-2" style="font-size: 0.95rem;">
                <table class="table table-sm table-borderless align-middle my-2">
                    <tbody>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted w-50">Raw Material:</td>
                            <td class="text-dark fw-bold">${item.raw_material_name}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Supplier:</td>
                            <td class="text-dark">${item.supplier_name || 'N/A'}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Quantity:</td>
                            <td class="text-dark fw-bold">${item.quantity || 0}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Expiration Date:</td>
                            <td class="${expDate !== 'N/A' ? 'text-danger fw-bold' : 'text-dark'}">${expDate}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Remarks:</td>
                            <td class="text-secondary text-wrap" style="max-width: 220px;">${item.remarks || '<em>None</em>'}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Unit Cost:</td>
                            <td class="text-dark">${unitCost}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Total Cost:</td>
                            <td class="text-primary fw-bold">${totalCost}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Stock In Date:</td>
                            <td class="text-dark">${stockInDate}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Stock In by:</td>
                            <td class="text-dark">${item.staff_name || `User ID: ${item.user_id}`}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Approved By:</td>
                            <td class="text-dark fw-bold">${approverDisplay}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Approved At:</td>
                            <td class="text-dark">${approvedAt}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Approval Remarks:</td>
                            <td class="text-secondary text-wrap" style="max-width: 220px;">${item.approval_remarks || '<em>No remarks provided</em>'}</td>
                        </tr>
                        <tr>
                            <td class="fw-bold text-muted">Status:</td>
                            <td class="text-dark fw-bold">${item.status || 'Pending'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;

        let titleIcon = 'info';
        if (currentStatus === 'APPROVED') titleIcon = 'success';
        if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') titleIcon = 'error';

        Swal.fire({
            title: `Stock In Reference Detail`,
            html: htmlContent,
            icon: titleIcon,
            confirmButtonText: 'Close Window',
            confirmButtonColor: '#3085d6',
            width: '520px',
            customClass: {
                popup: 'rounded-4 shadow-lg'
            }
        });
    }
});