// javascript/admin/sales_and_reports.js

const APP_ROOT = (() => {
    const path = window.location.pathname;
    const match = path.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
    return match && match[1] ? match[1] : '';
})();

const API_BASE = `${APP_ROOT}/backend/admin/salesReports/`;

// Helper for API calls
function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    
    // Fetch the token dynamically on every request
    const token = localStorage.getItem('hof_token');
    
    const headers = {
        'Authorization': `Bearer ${token}`
    };

    if (options.body && options.method !== 'GET') {
        headers['Content-Type'] = 'application/json';
    }

    const fetchOptions = {
        ...options,
        headers: { ...headers, ...options.headers }
    };

    if (options.body && options.method !== 'GET') {
        fetchOptions.body = JSON.stringify(options.body);
    }

    return fetch(url, fetchOptions)
        .then(async res => {
            const text = await res.text();
            if (!text) {
                throw new Error(`Empty response from ${endpoint}`);
            }
            try {
                return JSON.parse(text);
            } catch (err) {
                throw new Error(`Invalid JSON from ${endpoint}: ${text}`);
            }
        });
} // <-- Fixed: Added missing closing bracket here

// Chart instances
let salesChartInstance = null;
let hourlyChartInstance = null;

// State
let currentFilters = {
    start_date: '',
    end_date: '',
    group_by: 'day',
    menu_item_id: ''
};

let autoRefreshInterval = null;

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    init();
});

function init() {
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const chartLabel = document.getElementById('chartPeriodLabel');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    if (startDateInput) {
        startDateInput.value = formatDate(startDate);
    }
    if (endDateInput) {
        endDateInput.value = formatDate(endDate);
    }

    currentFilters.start_date = formatDate(startDate);
    currentFilters.end_date = formatDate(endDate);

    if (chartLabel) {
        const labelStart = new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const labelEnd = new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        chartLabel.textContent = `${labelStart} - ${labelEnd}`;
    }

    loadMenuItems();
    loadAllData();
    setupEvents();

    autoRefreshInterval = setInterval(() => {
        loadAllData();
    }, 30000);
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function setupEvents() {
    const applyBtn = document.getElementById('applyFiltersBtn');
    const resetBtn = document.getElementById('resetFiltersBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const printBtn = document.getElementById('printBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportExcelBtn = document.getElementById('exportExcelBtn');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');

    if (applyBtn) applyBtn.addEventListener('click', applyFilters);
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadAllData();
            Swal.fire({
                icon: 'success',
                title: 'Refreshed!',
                text: 'Data has been updated.',
                timer: 1500,
                showConfirmButton: false
            });
        });
    }

    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print();
        });
    }

    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportExcel);

    if (startDateInput) {
        startDateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') applyFilters();
        });
    }
    if (endDateInput) {
        endDateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') applyFilters();
        });
    }
}

// ==========================================
// LOAD DATA
// ==========================================
function loadAllData() {
    loadStats();
    loadChartData();
    loadTopSelling();
    loadHourlyDistribution();
}

function applyFilters() {
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const groupByInput = document.getElementById('groupBy');
    const menuItemInput = document.getElementById('menuItemFilter');

    const startDate = startDateInput ? startDateInput.value : currentFilters.start_date;
    const endDate = endDateInput ? endDateInput.value : currentFilters.end_date;
    const groupBy = groupByInput ? groupByInput.value : currentFilters.group_by;
    const menuItemId = menuItemInput ? menuItemInput.value : currentFilters.menu_item_id;

    if (!startDate || !endDate) {
        Swal.fire({
            icon: 'warning',
            title: 'Date Required',
            text: 'Please select both start and end dates.'
        });
        return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        Swal.fire({
            icon: 'error',
            title: 'Invalid Date Range',
            text: 'Start date cannot be after end date.'
        });
        return;
    }

    currentFilters.start_date = startDate;
    currentFilters.end_date = endDate;
    currentFilters.group_by = groupBy;
    currentFilters.menu_item_id = menuItemId;

    const label = document.getElementById('chartPeriodLabel');
    if (label) {
        const start = new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const end = new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        label.textContent = `${start} - ${end}`;
    }

    loadAllData();
}

function resetFilters() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const groupByInput = document.getElementById('groupBy');
    const menuItemInput = document.getElementById('menuItemFilter');

    if (startDateInput) startDateInput.value = formatDate(startDate);
    if (endDateInput) endDateInput.value = formatDate(endDate);
    if (groupByInput) groupByInput.value = 'day';
    if (menuItemInput) menuItemInput.value = '';

    currentFilters.start_date = formatDate(startDate);
    currentFilters.end_date = formatDate(endDate);
    currentFilters.group_by = 'day';
    currentFilters.menu_item_id = '';

    const label = document.getElementById('chartPeriodLabel');
    if (label) {
        const start = new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const end = new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        label.textContent = `${start} - ${end}`;
    }

    loadAllData();
}

// ==========================================
// LOAD MENU ITEMS FOR DROPDOWN
// ==========================================
function loadMenuItems() {
    apiFetch('get_menu_items.php?t=' + Date.now(), { method: 'GET' })
        .then(data => {
            if (data.status === 'success') {
                const select = document.getElementById('menuItemFilter');
                select.innerHTML = '<option value="">All Items</option>';
                data.data.forEach(item => {
                    const option = document.createElement('option');
                    option.value = item.menu_item_id;
                    option.textContent = `${item.item_name} (₱${parseFloat(item.price).toFixed(2)})`;
                    select.appendChild(option);
                });
            }
        })
        .catch(err => console.error('Error loading menu items:', err));
}

// ==========================================
// LOAD STATS (KPI CARDS)
// ==========================================
function loadStats() {
    const params = new URLSearchParams({
        start_date: currentFilters.start_date,
        end_date: currentFilters.end_date
    });

    apiFetch(`get_stats.php?${params.toString()}`, { method: 'GET' })
        .then(data => {
            if (data.status === 'success') {
                const stats = data.data;
                animateCurrency('totalRevenue', stats.total_revenue);
                animateNumber('totalOrders', stats.total_orders);
                animateCurrency('avgOrderValue', stats.avg_order_value);
                if (typeof stats.total_discount !== 'undefined') animateCurrency('totalDiscount', stats.total_discount);

                if (stats.best_seller) {
                    document.getElementById('bestSeller').textContent = stats.best_seller.item_name;
                    document.getElementById('bestSellerRevenue').textContent = 
                        '₱' + parseFloat(stats.best_seller.total_revenue).toLocaleString('en-US', { minimumFractionDigits: 2 });
                } else {
                    document.getElementById('bestSeller').textContent = '—';
                    document.getElementById('bestSellerRevenue').textContent = 'No data';
                }
            } else {
                throw new Error(data.message || 'Failed to load stats');
            }
        })
        .catch(err => {
            console.error('Error loading stats:', err);
            document.getElementById('totalRevenue').textContent = '₱0.00';
            document.getElementById('totalOrders').textContent = '0';
            document.getElementById('avgOrderValue').textContent = '₱0.00';
            document.getElementById('totalDiscount').textContent = '₱0.00';
            document.getElementById('bestSeller').textContent = '—';
            document.getElementById('bestSellerRevenue').textContent = 'No data';
        });
}

// ==========================================
// LOAD CHART DATA
// ==========================================
function loadChartData() {
    const params = new URLSearchParams({
        start_date: currentFilters.start_date,
        end_date: currentFilters.end_date,
        group_by: currentFilters.group_by
    });

    if (currentFilters.menu_item_id) {
        params.append('menu_item_id', currentFilters.menu_item_id);
    }

    apiFetch(`get_chart_data.php?${params.toString()}`, { method: 'GET' })
        .then(data => {
            if (data.status === 'success') {
                renderChart(data.data);
            } else {
                throw new Error(data.message || 'Failed to load chart data');
            }
        })
        .catch(err => {
            console.error('Error loading chart data:', err);
            const ctx = document.getElementById('salesChart');
            if (ctx) {
                const chartContext = ctx.getContext('2d');
                if (salesChartInstance) salesChartInstance.destroy();
                chartContext.clearRect(0, 0, ctx.width, ctx.height);
            }
        });
}

function renderChart(chartData) {
    const ctx = document.getElementById('salesChart').getContext('2d');

    if (salesChartInstance) {
        salesChartInstance.destroy();
    }

    salesChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Revenue (₱)',
                    data: chartData.revenue,
                    backgroundColor: 'rgba(255, 193, 7, 0.8)',
                    borderColor: '#ffc107',
                    borderWidth: 2,
                    borderRadius: 4,
                    yAxisID: 'y',
                    order: 1
                },
                {
                    label: 'Orders',
                    data: chartData.orders,
                    type: 'line',
                    backgroundColor: 'rgba(13, 110, 253, 0.1)',
                    borderColor: '#0d6efd',
                    borderWidth: 3,
                    pointBackgroundColor: '#0d6efd',
                    pointRadius: 4,
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1',
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            let value = context.raw || 0;
                            if (context.dataset.label.includes('Revenue')) {
                                return label + ': ₱' + value.toLocaleString('en-US', { minimumFractionDigits: 2 });
                            }
                            return label + ': ' + value;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        maxRotation: 45,
                        font: { size: 10 }
                    }
                },
                y: {
                    position: 'left',
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        callback: function(value) {
                            return '₱' + value.toLocaleString();
                        }
                    }
                },
                y1: {
                    position: 'right',
                    beginAtZero: true,
                    grid: { display: false },
                    ticks: {
                        callback: function(value) {
                            return value;
                        }
                    }
                }
            }
        }
    });
}

// ==========================================
// LOAD TOP SELLING
// ==========================================
function loadTopSelling() {
    const params = new URLSearchParams({
        start_date: currentFilters.start_date,
        end_date: currentFilters.end_date,
        limit: 10
    });

    apiFetch(`get_top_selling.php?${params.toString()}`, { method: 'GET' })
        .then(data => {
            if (data.status === 'success') {
                renderTopSelling(data.data);
            } else {
                throw new Error(data.message || 'Failed to load top selling');
            }
        })
        .catch(err => {
            console.error('Error loading top selling:', err);
            document.getElementById('topSellingList').innerHTML = '<div class="text-center py-4 text-muted">No sales data available.</div>';
        });
}

function renderTopSelling(items) {
    const container = document.getElementById('topSellingList');
    if (!items || items.length === 0) {
        container.innerHTML = '<div class="text-center py-4 text-muted">No sales data available.</div>';
        return;
    }

    let html = '';
    items.forEach((item, index) => {
        const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : '';
        const badge = index < 3 ? 
            `<span class="badge bg-warning text-dark ms-2">Top ${index + 1}</span>` : 
            `<span class="badge bg-secondary ms-2">#${index + 1}</span>`;

        const revenue = parseFloat(item.total_revenue);
        const quantity = parseInt(item.total_quantity);
        const price = parseFloat(item.price);

        html += `
            <div class="top-item-row d-flex align-items-center">
                <div class="rank-badge ${rankClass} me-3 flex-shrink-0">
                    ${index + 1}
                </div>
                <div class="flex-grow-1">
                    <div class="d-flex align-items-center flex-wrap">
                        <h6 class="mb-0 fw-semibold me-2">${escapeHtml(item.item_name)}</h6>
                        ${badge}
                    </div>
                    <div class="d-flex gap-3 text-muted small">
                        <span><i class="bi bi-box me-1"></i>${quantity} sold</span>
                        <span><i class="bi bi-tag me-1"></i>₱${price.toFixed(2)} each</span>
                    </div>
                </div>
                <div class="text-end">
                    <div class="fw-bold text-dark">₱${revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    <small class="text-muted">Revenue</small>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ==========================================
// LOAD HOURLY DISTRIBUTION (PEAK HOUR)
// ==========================================
function loadHourlyDistribution() {
    const params = new URLSearchParams({
        start_date: currentFilters.start_date,
        end_date: currentFilters.end_date
    });

    apiFetch(`get_hourly_distribution.php?${params.toString()}`, { method: 'GET' })
        .then(data => {
            if (data.status === 'success') {
                renderHourlyData(data.data);
            } else {
                throw new Error(data.message || 'Failed to load hourly data');
            }
        })
        .catch(err => {
            console.error('Error loading hourly data:', err);
            document.getElementById('peakHourLabel').textContent = 'No Data';
            document.getElementById('peakHourStats').textContent = 'No orders in this period';
            const ctx = document.getElementById('hourlyChart');
            if (ctx) {
                const chartContext = ctx.getContext('2d');
                if (hourlyChartInstance) hourlyChartInstance.destroy();
                chartContext.clearRect(0, 0, ctx.width, ctx.height);
            }
        });
}

function renderHourlyData(hourlyData) {
    const peak = hourlyData.peak_hour;
    if (peak) {
        document.getElementById('peakHourLabel').textContent = peak.time_label;
        document.getElementById('peakHourStats').textContent = 
            `${peak.order_count} orders · ₱${parseFloat(peak.revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })} revenue`;
    } else {
        document.getElementById('peakHourLabel').textContent = 'No Data';
        document.getElementById('peakHourStats').textContent = 'No orders in this period';
    }

    renderHourlyChart(hourlyData.hourly_data);
}

function renderHourlyChart(hourlyData) {
    const ctx = document.getElementById('hourlyChart').getContext('2d');

    if (hourlyChartInstance) {
        hourlyChartInstance.destroy();
    }

    const labels = hourlyData.map(d => {
        const hour = d.hour;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        return `${hour12}${ampm}`;
    });

    const orders = hourlyData.map(d => d.order_count);

    hourlyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Orders',
                data: orders,
                backgroundColor: 'rgba(255, 193, 7, 0.6)',
                borderColor: '#ffc107',
                borderWidth: 1,
                borderRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.raw + ' orders';
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { size: 8 },
                        maxTicksLimit: 24
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        font: { size: 8 },
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// ==========================================
// EXPORT FUNCTIONS
// ==========================================
function exportCSV() {
    const params = new URLSearchParams({
        start_date: currentFilters.start_date,
        end_date: currentFilters.end_date
    });

    if (currentFilters.menu_item_id) {
        params.append('menu_item_id', currentFilters.menu_item_id);
    }

    const url = `${API_BASE}export_csv.php?${params.toString()}`;
    const token = localStorage.getItem('hof_token');

    fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(response => response.blob())
    .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `sales_report_${formatDate(new Date())}.csv`;
        link.click();
    })
    .catch(err => {
        Swal.fire('Error', 'Failed to export CSV.', 'error');
        console.error(err);
    });
}

function exportExcel() {
    const params = new URLSearchParams({
        start_date: currentFilters.start_date,
        end_date: currentFilters.end_date
    });

    if (currentFilters.menu_item_id) {
        params.append('menu_item_id', currentFilters.menu_item_id);
    }

    const url = `${API_BASE}export_excel.php?${params.toString()}`;
    const token = localStorage.getItem('hof_token');

    fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(response => response.blob())
    .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `sales_report_${formatDate(new Date())}.xls`;
        link.click();
    })
    .catch(err => {
        Swal.fire('Error', 'Failed to export Excel.', 'error');
        console.error(err);
    });
}

// ==========================================
// ANIMATION HELPERS
// ==========================================
function animateCurrency(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const target = parseFloat(targetValue) || 0;
    const current = parseFloat(element.textContent.replace(/[^0-9.-]/g, '')) || 0;

    if (current === target) {
        element.textContent = '₱' + target.toLocaleString('en-US', { minimumFractionDigits: 2 });
        return;
    }

    animateValue(element, current, target, 400, true);
}

function animateNumber(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const target = parseInt(targetValue) || 0;
    const current = parseInt(element.textContent.replace(/,/g, '')) || 0;

    if (current === target) {
        element.textContent = target.toLocaleString('en-US');
        return;
    }

    animateValue(element, current, target, 400, false);
}

function animateValue(element, start, end, duration, isCurrency) {
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const currentValue = start + progress * (end - start);

        if (isCurrency) {
            element.textContent = '₱' + currentValue.toLocaleString('en-US', { minimumFractionDigits: 2 });
        } else {
            element.textContent = Math.floor(currentValue).toLocaleString('en-US');
        }

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            if (isCurrency) {
                element.textContent = '₱' + end.toLocaleString('en-US', { minimumFractionDigits: 2 });
            } else {
                element.textContent = end.toLocaleString('en-US');
            }
        }
    }
    requestAnimationFrame(step);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}