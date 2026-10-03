document.addEventListener("DOMContentLoaded", () => {
    // Initial backend fetch for administrative telemetry
    fetchAdminDashboardData();

    // Auto-refresh every 60s: new PAID transactions (cash/GCash) reflect
    // in revenue + charts immediately, regardless of kitchen status.
    setInterval(fetchAdminDashboardData, 60000);
});

// Variable to store our active chart instance tracker layout
let salesChartInstance = null;

// ==========================================
// CORE ADMINISTRATIVE DATA GATEWAY
// ==========================================
function fetchAdminDashboardData() {
    // Calling our combined statistics gateway endpoint file (Fixed path)
    fetch("/backend/admin/adminDashboard/get_stats.php")
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success') {
                populateRecentOrdersList(result.recent_orders);
                populateTopSellingLeaderboard(result.top_selling);

                // 1. POPULATE ADMIN BUSINESS QUICK STATS (Real-time live database values)
                animateCurrencyDisplay('todayRevenueDisplay', result.sales_stats.today_revenue);
                updateAdminStat('activeOrdersDisplay', result.sales_stats.active_orders);
                updateAdminStat('customersTodayDisplay', result.sales_stats.customers_today);
                animateCurrencyDisplay('grossProfitDisplay', result.sales_stats.gross_profit);

                // 2. RUN NOTIFICATION DROPDOWN SYSTEM
                checkStockAlerts(result.data);

                // 3. POPULATE EXPIRATION WATCHLIST SIDE CARD
                populateAdminExpirationWatchlist(result.expiration_watchlist);

                // 🌟 RUN THE CHART VISUAL RENDERING PIPELINE WITH BACKEND RECORDS
                renderWeeklySalesGraph(result.weekly_sales);
            }
        })
        .catch(error => console.error('Error compiling admin telemetry data:', error));
}

// ==========================================
// CHART.JS GRAPH COMPILER
// ==========================================
function renderWeeklySalesGraph(weeklySalesData) {
    const canvas = document.getElementById('weeklySalesChart');
    if (!canvas) return;

    if (typeof Chart === 'undefined') {
        console.error("Chart.js library has not finished loading from CDN yet.");
        setTimeout(() => renderWeeklySalesGraph(weeklySalesData), 300);
        return;
    }

    const cleanData = Array.isArray(weeklySalesData) ? weeklySalesData : [];
    const chartLabels = cleanData.map(item => item.day);
    const chartValues = cleanData.map(item => item.sales);

    if (salesChartInstance) {
        salesChartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');
    salesChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels.length ? chartLabels : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Gross Revenue (₱)',
                data: chartValues.length ? chartValues : [0, 0, 0, 0, 0, 0, 0],
                backgroundColor: 'rgba(255, 193, 7, 0.85)',
                borderColor: '#ffc107',
                borderWidth: 1.5,
                borderRadius: 6,
                borderSkipped: false,
                hoverBackgroundColor: '#e0a800'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let value = context.raw || 0;
                            return ' Revenue: ₱' + value.toLocaleString('en-US', { minimumFractionDigits: 2 });
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#6c757d', font: { weight: '500' } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#f8f9fa' },
                    ticks: {
                        color: '#6c757d',
                        callback: function (value) { return '₱' + value.toLocaleString(); }
                    }
                }
            }
        }
    });
}

// ==========================================
// DYNAMIC EXPIRATION WATCHLIST RENDERER
// ==========================================
function populateAdminExpirationWatchlist(watchlist) {
    const container = document.getElementById('expirationWatchlist');
    if (!container) return;

    container.innerHTML = '';

    if (!Array.isArray(watchlist) || watchlist.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4 text-muted">
                <i class="bi bi-shield-check text-success fs-2 d-block mb-1"></i>
                No expiring batches detected.
            </div>`;
        return;
    }

    let html = '';
    watchlist.forEach(item => {
        const daysLeft = parseInt(item.days_left, 10);
        let textClass = 'text-warning-emphasis';
        let statusMessage = `Expires in ${daysLeft} days`;

        if (daysLeft < 0) {
            textClass = 'text-danger fw-bold';
            statusMessage = `Expired ${Math.abs(daysLeft)} days ago`;
        } else if (daysLeft === 0) {
            textClass = 'text-danger fw-bold';
            statusMessage = 'Expiring Today';
        } else if (daysLeft === 1) {
            textClass = 'text-danger fw-medium';
            statusMessage = 'Expiring Tomorrow';
        } else if (daysLeft > 7) {
            textClass = 'text-info-emphasis';
        }

        html += `
            <div class="list-group-item d-flex justify-content-between align-items-center px-0 py-2.5 border-bottom-0">
                <div>
                    <h6 class="mb-0 fw-semibold text-dark" style="font-size: 0.9rem;">${item.raw_material_name}</h6>
                    <small class="${textClass} fw-medium">
                        <i class="bi bi-clock-history me-1"></i>${statusMessage}
                    </small>
                    <small class="text-muted d-block" style="font-size: 0.75rem;">Batch Qty: ${parseFloat(item.total_batch_quantity)} ${item.unit || ''}</small>
                </div>
                <button type="button" class="btn btn-sm btn-outline-primary px-2.5 py-1 fw-semibold" 
                        onclick="viewMaterialBatches(${item.raw_material_id}, '${escapeHtml(item.raw_material_name)}')">
                    <i class="bi bi-eye"></i> View
                </button>
            </div>`;
    });
    container.innerHTML = html;
}

// ==========================================
// NOTIFICATION LIVE ALERTS
// ==========================================
function checkStockAlerts(materialsList) {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    if (!menu || !badge) return;

    menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';

    if (!Array.isArray(materialsList) || materialsList.length === 0) {
        badge.classList.add('d-none');
        menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All inventory levels are normal.</span></li>`;
        return;
    }

    let activeAlerts = [];

    materialsList.forEach(material => {
        const qty = parseFloat(material.current_quantity) || 0;
        const reorderLevel = parseFloat(material.reorder_level) || 0;

        let alertText = "";
        let isCritical = false;

        if (qty <= 0) {
            alertText = `⚠️ <strong>${material.raw_material_name}</strong> is completely out of stock! Restock immediately.`;
            isCritical = true;
        } else if (qty <= reorderLevel) {
            alertText = `⚠️ <strong>${material.raw_material_name}</strong> is low on stock (${qty} ${material.unit || 'pcs'} left). Restock soon!`;
            isCritical = false;
        }

        if (alertText) {
            activeAlerts.push({
                text: alertText,
                isCritical: isCritical,
                updatedAt: material.updated_at ? new Date(material.updated_at).getTime() : 0
            });
        }
    });

    if (activeAlerts.length > 0) {
        activeAlerts.sort((a, b) => b.updatedAt - a.updatedAt);

        activeAlerts.forEach(alert => {
            menu.innerHTML += `
                <li>
                    <a class="dropdown-item py-2 border-bottom text-wrap" href="inventoryStaff_RawMaterials.html" style="font-size: 0.9rem;">
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

// ==========================================
// SWEETALERT2 DYNAMIC BATCH VIEWER MODAL
// ==========================================
function viewMaterialBatches(materialId, materialName) {
    Swal.fire({
        title: 'Loading Batch Summary...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    // Fixed path
    fetch(`/backend/admin/adminDashboard/get_material_batches.php?raw_material_id=${materialId}`)
        .then(response => response.json())
        .then(res => {
            if (res.status !== 'success') {
                throw new Error(res.message || 'Failed processing batch contents.');
            }

            if (!res.batches || res.batches.length === 0) {
                Swal.fire({
                    icon: 'info',
                    title: materialName,
                    text: 'No recorded stock-in active batches match this material currently.',
                    confirmButtonColor: '#198754'
                });
                return;
            }

            let rowsHtml = '';
            res.batches.forEach(batch => {
                const daysLeft = parseInt(batch.days_left, 10);
                let badgeHtml = '';

                if (daysLeft < 0) {
                    badgeHtml = `<span class="badge bg-danger">Expired (${Math.abs(daysLeft)}d ago)</span>`;
                } else if (daysLeft === 0) {
                    badgeHtml = `<span class="badge bg-danger">Expires Today</span>`;
                } else if (daysLeft <= 3) {
                    badgeHtml = `<span class="badge bg-warning text-dark">Critical (${daysLeft}d left)</span>`;
                } else {
                    badgeHtml = `<span class="badge bg-success">${daysLeft} days left</span>`;
                }

                const batchDate = new Date(batch.stock_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const expDate = batch.expiration_date ? new Date(batch.expiration_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';

                rowsHtml += `
                    <tr style="font-size: 0.85rem;">
                        <td class="text-start fw-medium text-dark">${batch.reference_number || 'N/A'}<br><small class="text-muted">In: ${batchDate}</small></td>
                        <td class="fw-bold text-center">${parseFloat(batch.quantity)}</td>
                        <td class="text-center">${expDate}</td>
                        <td class="text-center">${badgeHtml}</td>
                    </tr>`;
            });

            Swal.fire({
                title: `<div class="fs-5 fw-bold text-start text-dark"><i class="bi bi-layers text-primary me-2"></i>Batch Distribution</div><div class="text-muted text-start" style="font-size:0.8rem; font-weight:normal;">${materialName}</div>`,
                html: `
                    <div class="table-responsive mt-2 border rounded" style="max-height: 300px;">
                        <table class="table table-sm table-striped table-hover align-middle mb-0">
                            <thead class="table-dark text-nowrap sticky-top">
                                <tr>
                                    <th class="text-start py-2">Ref / Date</th>
                                    <th class="text-center py-2">Qty</th>
                                    <th class="text-center py-2">Expiration</th>
                                    <th class="text-center py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>`,
                width: '600px',
                confirmButtonText: 'Close Panel',
                confirmButtonColor: '#6c757d',
                customClass: { popup: 'p-3' }
            });
        })
        .catch(err => {
            console.error(err);
            Swal.fire({ icon: 'error', title: 'Lookup Fault', text: 'Error trying to trace historical batches.' });
        });
}

// ==========================================
// VISUAL RENDERING ANIMATION ENGINE
// ==========================================
function updateAdminStat(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const target = parseInt(targetValue, 10) || 0;
    const current = parseInt(element.textContent.replace(/,/g, ''), 10) || 0;

    if (current === target) {
        element.textContent = target;
        return;
    }

    animateValue(element, current, target, 400, false);
}

function animateCurrencyDisplay(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const target = parseFloat(targetValue) || 0;
    const current = parseFloat(element.textContent.replace(/[^0-9.-]/g, '')) || 0;

    if (current === target) {
        element.textContent = '₱' + target.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return;
    }

    animateValue(element, current, target, 400, true);
}

function animateValue(element, start, end, duration, isCurrency) {
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const currentValue = start + progress * (end - start);

        if (isCurrency) {
            element.textContent = '₱' + currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else {
            element.textContent = Math.floor(currentValue).toLocaleString('en-US');
        }

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            if (isCurrency) {
                element.textContent = '₱' + end.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            } else {
                element.textContent = end.toLocaleString('en-US');
            }
        }
    }
    requestAnimationFrame(step);
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==========================================
// DYNAMIC RECENT ORDERS RENDERING BAR
// ==========================================
function populateRecentOrdersList(orders) {
    const container = document.getElementById('recentOrdersContainer');
    if (!container) return;

    container.innerHTML = '';

    if (!Array.isArray(orders) || orders.length === 0) {
        container.innerHTML = `<p class="text-muted small text-center py-4">No incoming store orders processed yet today.</p>`;
        return;
    }

    orders.forEach(order => {
        const seconds = parseInt(order.time_ago_seconds, 10);
        let timeAgoText = 'Just now';
        if (seconds >= 60) {
            const mins = Math.floor(seconds / 60);
            timeAgoText = `${mins} min${mins > 1 ? 's' : ''} ago`;
        }

        const tableDisplay = order.table_number ? `Table ${order.table_number}` : 'Takeout / Walk-in';
        const itemsSummaryText = order.items_summary ? escapeHtml(order.items_summary) : 'No item specs verified';
        const totalAmountFormatted = parseFloat(order.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 });

        container.innerHTML += `
            <div class="item-row d-flex align-items-center pb-2 border-bottom last-border-0">
                <div class="flex-grow-1">
                    <h6 class="mb-0 fw-bold">#${order.reference_number || order.order_id} 
                        <span class="text-muted fw-normal ms-2" style="font-size: 0.85rem;">${tableDisplay}</span>
                    </h6>
                    <p class="text-muted small mb-0 text-truncate" style="max-width: 320px;">${itemsSummaryText}</p>
                </div>
                <div class="text-end">
                    <div class="fw-bold text-dark">₱${totalAmountFormatted}</div>
                    <div class="small text-muted" style="font-size: 0.75rem;"><i class="bi bi-clock me-1"></i>${timeAgoText}</div>
                </div>
            </div>`;
    });
}

// ==========================================
// DYNAMIC LEADERBOARD FOR TOP SELLING ITEMS
// ==========================================
function populateTopSellingLeaderboard(menuItems) {
    const container = document.getElementById('topSellingContainer');
    if (!container) return;

    container.innerHTML = '';

    if (!Array.isArray(menuItems) || menuItems.length === 0) {
        container.innerHTML = `<p class="text-muted small text-center py-4">No completed transaction volumes found.</p>`;
        return;
    }

    menuItems.forEach((item, index) => {
        const itemGrossSales = parseFloat(item.total_gross_revenue).toLocaleString('en-US', { maximumFractionDigits: 0 });
        const orderCounts = parseInt(item.total_orders_count, 10);

        container.innerHTML += `
            <div class="item-row d-flex align-items-center pb-2">
                <div class="rank-circle me-3 d-flex align-items-center justify-content-center fw-bold rounded-circle text-white bg-secondary" 
                     style="width: 28px; height: 28px; font-size: 0.85rem; background-color: ${index === 0 ? '#ffc107 !important; color:#000 !important;' : '#6c757d'};">
                    ${index + 1}
                </div>
                <div class="flex-grow-1">
                    <h6 class="mb-0 fw-bold" style="font-size: 0.9rem;">${escapeHtml(item.item_name)}</h6>
                    <p class="text-muted small mb-0">${orderCounts} order${orderCounts > 1 ? 's' : ''}</p>
                </div>
                <div class="text-end">
                    <div class="fw-bold text-dark">₱${itemGrossSales}</div>
                    <div class="text-success small fw-bold" style="font-size: 0.75rem;"><i class="bi bi-graph-up me-1"></i>Top Item</div>
                </div>
            </div>`;
    });
}