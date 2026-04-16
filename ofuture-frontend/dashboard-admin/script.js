// ============================================================
// O'Future Admin Dashboard - Complete Enterprise JavaScript
// Tích hợp: Logic Gốc + Phân trang (Pagination) + Modals + Charts + CSV Export
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
// Extract base URL for image uploads (remove /api suffix)
const BACKEND_BASE_URL = API_BASE_URL.replace('/api', '') || 'http://localhost:5000';

// ── 1. GLOBAL STATE & DATA ────────────────────────────────────
let currentAdmin = null;
let allUsers = [];
let allEscrow = [];
let allPayments = [];
let allLogs = [];
let allModerationProducts = [];
let allModerationReviews = [];
let allAIKnowledge = [];
let allLiveChats = [];
let activeChatId = null;
let activeRequests = 0;

// Trạng thái phân trang (Pagination State)
const pageState = {
    users: { page: 1, limit: 15, totalPages: 1 },
    products: { page: 1, limit: 15, totalPages: 1 },
    reviews: { page: 1, limit: 15, totalPages: 1 },
    escrow: { page: 1, limit: 15, totalPages: 1 },
    payments: { page: 1, limit: 15, totalPages: 1 },
    logs: { page: 1, limit: 30, totalPages: 1 }
};

// Biến lưu trữ biểu đồ & Modal target
let revenueChartInstance = null;
let targetIdForModal = null;
let targetActionForModal = null;


// ── 2. AUTHENTICATION & INITIALIZATION ────────────────────────
async function initializeDashboard() {
    const token = localStorage.getItem('accessToken');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    if (!token || user.role !== 'admin') {
        alert('Bạn không có quyền truy cập! Đang chuyển hướng về trang Login.');
        window.location.href = '../login.html';
        return;
    }

    currentAdmin = user;
    const usernameEl = document.getElementById('username');
    if (usernameEl) usernameEl.textContent = currentAdmin.username || 'Admin';

    setupEventListeners();
    await loadDashboardData();
}

async function apiCall(endpoint, options = {}) {
    activeRequests += 1; showAdminSpinner();
    try {
        // Tái sử dụng fetchAPI toàn cục nếu có, hoặc fetch thuần có kèm token
        if (typeof fetchAPI === 'function') {
            return await fetchAPI(endpoint, options);
        } else {
            const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` };
            const res = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Lỗi API');
            return data;
        }
    } catch (error) {
        console.error('Admin API Error:', error);
        throw error;
    } finally {
        activeRequests = Math.max(0, activeRequests - 1);
        if (activeRequests === 0) hideAdminSpinner();
    }
}

function showAdminSpinner(){ const el = document.getElementById('globalSpinner'); if(el) el.style.display='flex'; }
function hideAdminSpinner(){ const el = document.getElementById('globalSpinner'); if(el) el.style.display='none'; }


// ── 3. DATA LOADING (Tích hợp Pagination) ─────────────────────
async function loadDashboardData() {
    try {
        await Promise.all([
            loadStats(),
            loadUsers(),
            loadLogs(),
            loadDisputedEscrow(),
            loadPayments(),
            loadModerationProducts(),
            loadModerationReviews(),
            loadAIKnowledge(),
            loadLiveChats(),
            loadSettings() // Nạp thêm Cài đặt hệ thống
        ]);
        updatePlatformRevenue();
    } catch (error) {
        console.error('Lỗi kết nối Backend:', error);
    }
}

async function loadStats() {
    try {
        const res = await apiCall('/admin/stats');
        const stats = res.data || {};
        
        if (document.getElementById('totalUsers')) document.getElementById('totalUsers').textContent = stats.users?.total_users || 0;
        if (document.getElementById('totalSellers')) document.getElementById('totalSellers').textContent = stats.users?.sellers || 0;
        if (document.getElementById('totalTransactions')) document.getElementById('totalTransactions').textContent = stats.orders?.total_orders || 0;
        if (document.getElementById('totalEscrowBalance')) document.getElementById('totalEscrowBalance').textContent = '$' + (stats.escrow?.total_held || 0).toLocaleString();
        
        if (document.getElementById('escrowHeld')) document.getElementById('escrowHeld').textContent = '$' + (stats.escrow?.total_held || 0).toLocaleString();
        if (document.getElementById('escrowReleased')) document.getElementById('escrowReleased').textContent = '$' + (stats.escrow?.released || 0).toLocaleString();
        if (document.getElementById('escrowPending')) document.getElementById('escrowPending').textContent = '$' + (stats.escrow?.pending || 0).toLocaleString();

        if (stats.trends) renderCharts(stats.trends);
    } catch (err) { console.warn('Không thể tải thống kê stats', err); }
}

async function loadUsers(page = 1) {
    pageState.users.page = page;
    const search = document.getElementById('userSearch')?.value || '';
    try {
        const response = await apiCall(`/admin/users?page=${page}&limit=${pageState.users.limit}&search=${encodeURIComponent(search)}`);
        allUsers = response.data || [];
        if(response.pagination) pageState.users.totalPages = response.pagination.totalPages;
        renderUsersTable();
        renderPagination('usersPagination', pageState.users, loadUsers);
    } catch (error) {
        const tbody = document.getElementById('usersTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red;">Lỗi tải dữ liệu người dùng</td></tr>';
    }
}

async function loadLogs(page = 1) {
    pageState.logs.page = page;
    const severity = document.getElementById('systemLogSeverityFilter')?.value || '';
    const eventType = document.getElementById('logTypeFilter')?.value || '';
    try {
        let url = `/admin/logs?page=${page}&limit=${pageState.logs.limit}`;
        if(severity) url += `&severity=${severity}`;
        if(eventType) url += `&eventType=${eventType}`;
        
        const response = await apiCall(url);
        allLogs = response.data || [];
        if(response.pagination) pageState.logs.totalPages = response.pagination.totalPages;
        
        renderLogsTable();    
        renderActivityLogs(); 
        renderPagination('logsPagination', pageState.logs, loadLogs);
    } catch (error) {
        const tbody = document.getElementById('systemLogsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red;">Lỗi tải nhật ký hệ thống</td></tr>';
        const container = document.getElementById('logsContainer');
        if (container) container.innerHTML = '<p class="text-center" style="color:red;">Lỗi tải nhật ký hoạt động</p>';
    }
}

async function loadDisputedEscrow(page = 1) {
    pageState.escrow.page = page;
    const status = document.getElementById('escrowStatusFilter')?.value || '';
    try {
        let url = `/admin/escrow?page=${page}&limit=${pageState.escrow.limit}`;
        if(status) url += `&status=${status}`;
        
        const response = await apiCall(url);
        allEscrow = response.data || [];
        if(response.pagination) pageState.escrow.totalPages = response.pagination.totalPages;
        renderEscrowTable();
        renderPagination('escrowPagination', pageState.escrow, loadDisputedEscrow);
    } catch (error) {
        const tbody = document.getElementById('escrowTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center">Error loading escrow disputes</td></tr>';
    }
}

async function loadPayments(page = 1) {
    pageState.payments.page = page;
    const status = document.getElementById('paymentStatusFilter')?.value || '';
    try {
        let url = `/admin/payments?page=${page}&limit=${pageState.payments.limit}`;
        if(status) url += `&status=${status}`;
        
        const response = await apiCall(url);
        allPayments = response.data || [];
        if(response.pagination) pageState.payments.totalPages = response.pagination.totalPages;
        renderPaymentsTable();
        renderPagination('paymentsPagination', pageState.payments, loadPayments);
    } catch (error) {
        const tbody = document.getElementById('paymentsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error loading payments</td></tr>';
    }
}

async function loadModerationProducts(page = 1) {
    pageState.products.page = page;
    try {
        const res = await apiCall(`/admin/products?page=${page}&limit=${pageState.products.limit}`);
        allModerationProducts = res.data || [];
        if(res.pagination) pageState.products.totalPages = res.pagination.totalPages;
        renderModerationProducts();
        renderPagination('productsPagination', pageState.products, loadModerationProducts);
    } catch (err) {
        const tbody = document.getElementById('productsModerationBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error loading products</td></tr>';
    }
}

async function loadModerationReviews(page = 1) {
    pageState.reviews.page = page;
    try {
        const res = await apiCall(`/admin/reviews?page=${page}&limit=${pageState.reviews.limit}`);
        allModerationReviews = res.data || [];
        if(res.pagination) pageState.reviews.totalPages = res.pagination.totalPages;
        renderModerationReviews();
        renderPagination('reviewsPagination', pageState.reviews, loadModerationReviews);
    } catch (err) {
        const tbody = document.getElementById('reviewsModerationBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error loading reviews</td></tr>';
    }
}

async function loadAIKnowledge() {
    try {
        const res = await apiCall('/admin/ai-knowledge');
        allAIKnowledge = res.data || [];
        renderAIKnowledge();
    } catch (err) {
        const tbody = document.getElementById('aiKnowledgeBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center">Error loading data</td></tr>';
    }
}

async function loadLiveChats() {
    try {
        const res = await apiCall('/admin/chats?status=handoff_to_admin');
        allLiveChats = res.data || [];
        renderLiveChatsList();
    } catch (err) {
        const el = document.getElementById('liveChatsList');
        if (el) el.innerHTML = '<li class="text-center">Error loading chats</li>';
    }
}

async function loadSettings() {
    try {
        const res = await apiCall('/admin/settings');
        const settings = res.data || {};
        const feeInput = document.getElementById('settingPlatformFee');
        if(feeInput) feeInput.value = settings.platform_fee_percent || '2.5';
    } catch (err) { console.warn('Lỗi tải cài đặt:', err); }
}


// ── 4. RENDERING FUNCTIONS ────────────────────────────────────

function renderUsersTable(data = allUsers) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center">Chưa có người dùng nào</td></tr>'; return; }

    tbody.innerHTML = data.map(u => {
        const activeStatus = u.isActive === true;
        return `
        <tr>
            <td>${u.email || '-'}</td>
            <td>${u.username || '-'}</td>
            <td>${u.fullName || '-'}</td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-info'}">${(u.role || 'user').toUpperCase()}</span></td>
            <td><span class="badge ${activeStatus ? 'badge-success' : 'badge-danger'}">${activeStatus ? 'Hoạt động' : 'Bị khóa'}</span></td>
            <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}</td>
            <td>
                <button class="btn btn-small ${activeStatus ? 'btn-danger' : 'btn-success'}" 
                        onclick="handleSuspendUser('${u.id}', ${activeStatus})">
                    ${activeStatus ? 'Khóa' : 'Mở khóa'}
                </button>
            </td>
        </tr>
    `}).join('');
}

function renderLogsTable() {
    const tbody = document.getElementById('systemLogsTableBody');
    if (!tbody) return;
    if (allLogs.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center">Không có nhật ký nào</td></tr>'; return; }

    tbody.innerHTML = allLogs.map(log => `
        <tr>
            <td class="text-muted">${log.created_at ? new Date(log.created_at).toLocaleString() : '-'}</td>
            <td><span class="badge badge-${getSeverityClass(log.severity)}">${log.severity || 'info'}</span></td>
            <td>${log.event_type || '-'}</td>
            <td class="text-truncate" style="max-width: 300px;" title="${log.message || ''}">${log.message?.substring(0, 50) || '-'}</td>
            <td>${log.actor_username || 'System'}</td> <td>${log.ip_address || '-'}</td>
            <td>${log.endpoint || '-'}</td>
        </tr>
    `).join('');
}

function renderActivityLogs(data = allLogs) {
    const container = document.getElementById('logsContainer');
    if (!container) return;
    if (data.length === 0) { container.innerHTML = '<p class="text-center">Chưa có hoạt động nào được ghi nhận.</p>'; return; }

    container.innerHTML = data.slice(0, 50).map(log => `
        <div class="log-entry" style="padding: 12px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #fff; margin-bottom: 8px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
            <div>
                <strong style="color: #2c3e50;">${log.event_type || 'System Event'}</strong> 
                <span style="color: #64748b; margin-left: 8px;">${log.message || ''}</span>
                <div style="margin-top: 4px; font-size: 0.85em; color: #94a3b8;">
                    👤 Tác nhân: <b>${log.actor_username || 'System'}</b> | 🌐 IP: ${log.ip_address || 'N/A'}
                </div>
            </div>
            <div style="font-size: 0.85em; color: #64748b; white-space: nowrap;">
                🕒 ${log.created_at ? new Date(log.created_at).toLocaleString() : '-'}
            </div>
        </div>
    `).join('');
}

function renderEscrowTable() {
    const tbody = document.getElementById('escrowTableBody');
    if (!tbody) return;
    if (allEscrow.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center">No escrow records found</td></tr>'; return; }

    tbody.innerHTML = allEscrow.map(escrow => `
        <tr>
            <td>${escrow.id?.substring(0, 8) || 'N/A'}</td>
            <td>${escrow.buyer?.username || 'Unknown'}</td>
            <td>${escrow.seller?.username || 'Unknown'}</td>
            <td style="color:#2563eb; font-weight:bold;">$${escrow.amount?.toFixed(2) || '0.00'}</td>
            <td><span class="badge ${getStatusBadgeClass(escrow.status)}">${(escrow.status||'').toUpperCase()}</span></td>
            <td class="text-muted">${new Date(escrow.created_at).toLocaleDateString()}</td>
            <td>
                ${escrow.status === 'disputed' || escrow.status === 'held'
                    ? `<button class="btn btn-small btn-primary" onclick="resolveDispute('${escrow.id}')">Resolve</button>`
                    : '<span class="text-muted">Processed</span>'}
            </td>
        </tr>
    `).join('');
}

function renderPaymentsTable() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;
    if (allPayments.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center">No payments found</td></tr>'; return; }

    tbody.innerHTML = allPayments.map(payment => `
        <tr>
            <td>${payment.id?.substring(0, 8) || 'N/A'}</td>
            <td>${payment.user?.username || 'Unknown'}</td>
            <td>$${payment.amount?.toFixed(2) || '0.00'}</td>
            <td><span class="badge ${getStatusBadgeClass(payment.status)}">${payment.status || 'unknown'}</span></td>
            <td>${payment.gateway || '-'}</td>
            <td class="text-muted">${new Date(payment.created_at).toLocaleDateString()}</td>
            <td>
                ${payment.status === 'pending'
                    ? `<button class="btn btn-small btn-success" onclick="approvePayment('${payment.id}')">Approve</button>
                       <button class="btn btn-small btn-danger" onclick="rejectPayment('${payment.id}')">Reject</button>`
                    : '-'}
            </td>
        </tr>
    `).join('');
}

function renderModerationProducts() {
    const tbody = document.getElementById('productsModerationBody');
    if (!tbody) return;
    if (!allModerationProducts || allModerationProducts.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center">No products found</td></tr>'; return; }
    tbody.innerHTML = allModerationProducts.map(p => `
        <tr>
            <td>${p.id?.substring(0,8)||'N/A'}</td>
            <td>${p.name||''}</td>
            <td>${p.seller?.username||''}</td>
            <td>${p.category||''}</td>
            <td>$${Number(p.price||0).toFixed(2)}</td>
            <td><span class="badge ${p.status === 'active' ? 'badge-success' : 'badge-warning'}">${p.status||''}</span></td>
            <td><button class="btn btn-small btn-danger" onclick="adminDeleteProduct('${p.id}')">Delete</button></td>
        </tr>
    `).join('');
}

function renderModerationReviews() {
    const tbody = document.getElementById('reviewsModerationBody');
    if (!tbody) return;
    if (!allModerationReviews || allModerationReviews.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center">No reviews found</td></tr>'; return; }
    tbody.innerHTML = allModerationReviews.map(r => `
        <tr>
            <td>${r.id?.substring(0,8)||'N/A'}</td>
            <td>${r.product_name||''}</td>
            <td>${r.username||''}</td>
            <td>${r.rating||0} ⭐</td>
            <td>${(r.body||'').substring(0,120)}</td>
            <td><span class="badge ${r.is_hidden ? 'badge-danger' : 'badge-success'}">${r.is_hidden ? 'Yes' : 'No'}</span></td>
            <td><button class="btn btn-small btn-warning" onclick="adminHideReview('${r.id}')">${r.is_hidden ? 'Unhide' : 'Hide'}</button></td>
        </tr>
    `).join('');
}

function renderAIKnowledge() {
    const tbody = document.getElementById('aiKnowledgeBody');
    if (!tbody) return;
    if (!allAIKnowledge || allAIKnowledge.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="text-center">No topics found</td></tr>'; return; }
    tbody.innerHTML = allAIKnowledge.map(item => `
        <tr>
            <td><strong>${item.topic||''}</strong></td>
            <td>${(item.content||'').substring(0,200)}...</td>
            <td>
                <button class="btn btn-small btn-primary" onclick="editAiTopic('${item.id}')">Edit</button>
                <button class="btn btn-small btn-danger" onclick="deleteAiTopic('${item.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

function renderLiveChatsList() {
    const el = document.getElementById('liveChatsList');
    if (!el) return;
    if (!allLiveChats || allLiveChats.length === 0) { el.innerHTML = '<li class="text-center">No pending chats</li>'; return; }
    el.innerHTML = allLiveChats.map(c => `<li style="list-style:none;margin-bottom:8px; padding:10px; background:#f8fafc; border-radius:8px;"><a href="#" onclick="openChat('${c.id}');return false;" style="text-decoration:none; color:#0f172a; font-weight:600;">${c.user?.username||'Guest'} - ${c.id?.substring(0,8)||''}</a></li>`).join('');
}

function updatePlatformRevenue() {
    const totalPlatformRevenue = (allPayments || []).reduce((sum, p) => sum + (Number(p.platform_fee || p.fee || 0)), 0);
    let revenueEl = document.getElementById('totalPlatformRevenue');
    if (!revenueEl) {
        const grid = document.querySelector('.stats-grid');
        if (grid) {
            const div = document.createElement('div'); div.className = 'stat-card';
            div.innerHTML = `<h3>Platform Revenue</h3><p id="totalPlatformRevenue">$0</p>`;
            grid.appendChild(div); revenueEl = document.getElementById('totalPlatformRevenue');
        }
    }
    if (revenueEl) revenueEl.textContent = '$' + totalPlatformRevenue.toFixed(2);
}

// Hàm render thanh phân trang UI
function renderPagination(containerId, stateObj, loadFunc) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (stateObj.totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<div style="display:flex; justify-content:center; align-items:center; gap:15px; padding:15px;">`;
    html += `<button class="btn btn-outline btn-small" ${stateObj.page === 1 ? 'disabled' : ''} onclick="window.${loadFunc.name}(${stateObj.page - 1})">← Trước</button>`;
    html += `<span style="font-size:14px; font-weight:600; color:#475569;">Trang ${stateObj.page} / ${stateObj.totalPages}</span>`;
    html += `<button class="btn btn-outline btn-small" ${stateObj.page === stateObj.totalPages ? 'disabled' : ''} onclick="window.${loadFunc.name}(${stateObj.page + 1})">Tiếp →</button>`;
    html += `</div>`;
    container.innerHTML = html;
    if(!window[loadFunc.name]) window[loadFunc.name] = loadFunc;
}

// Vẽ biểu đồ Chart.js
function renderCharts(trends) {
    if (typeof Chart === 'undefined') return;
    const ctxRev = document.getElementById('revenueChart');
    if (ctxRev && trends.orders && trends.orders.length > 0) {
        if (revenueChartInstance) revenueChartInstance.destroy();
        const labels = trends.orders.map(o => new Date(o.date).toLocaleDateString('vi-VN'));
        const data = trends.orders.map(o => o.revenue);
        revenueChartInstance = new Chart(ctxRev, {
            type: 'line',
            data: { labels: labels, datasets: [{ label: 'Doanh thu (VND)', data: data, borderColor: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.1)', tension: 0.4, fill: true }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
}


// ── 5. ACTIONS & MODALS ───────────────────────────────────────

// 5.1 Suspend User
window.handleSuspendUser = function(userId, currentIsActive) {
    targetIdForModal = userId;
    targetActionForModal = currentIsActive;
    
    let modal = document.getElementById('suspendUserModal');
    if(modal) {
        document.getElementById('suspendReason').value = '';
        document.getElementById('suspendModalTitle').textContent = currentIsActive ? 'Khóa Tài Khoản' : 'Mở Khóa Tài Khoản';
        modal.style.display = 'flex';
    } else {
        // Fallback nếu HTML chưa có modal
        executeSuspendFallback(userId, currentIsActive);
    }
}

window.executeSuspendUser = async function() {
    const reason = document.getElementById('suspendReason')?.value.trim();
    if (targetActionForModal && !reason) return alert('Vui lòng nhập lý do khóa!');
    try {
        await apiCall(`/admin/users/${targetIdForModal}/suspend`, { method: 'PUT', body: JSON.stringify({ suspend: targetActionForModal, reason: reason || 'Thay đổi bởi Admin' }) });
        document.getElementById('suspendUserModal').style.display = 'none';
        alert('Cập nhật trạng thái thành công.');
        loadUsers(pageState.users.page);
    } catch (error) { alert('Lỗi thực hiện: ' + error.message); }
}

async function executeSuspendFallback(userId, currentIsActive) {
    const actionText = currentIsActive ? 'Khóa' : 'Mở khóa';
    const reason = await showPromptModal(`Lý do ${actionText} tài khoản này:`);
    if (reason === null) return;
    if (currentIsActive && !reason.trim()) return alert('Vui lòng nhập lý do để khóa tài khoản!');
    try {
        await apiCall(`/admin/users/${userId}/suspend`, { method: 'PUT', body: JSON.stringify({ suspend: currentIsActive, reason: reason.trim() || 'Thay đổi bởi Admin' }) });
        loadUsers(pageState.users.page);
    } catch (error) { alert('Lỗi thực hiện: ' + error.message); }
}

// 5.2 Escrow Dispute
window.resolveDispute = async function(escrowId) {
    targetIdForModal = escrowId;
    let modal = document.getElementById('escrowDisputeModal');
    
    if (modal) {
        try {
            const res = await apiCall(`/admin/escrow/${escrowId}`);
            const data = res.data || {};
            document.getElementById('escrowAmountDisplay').textContent = `$${Number(data.amount || 0).toFixed(2)}`;
            document.getElementById('buyerEvidence').innerHTML = formatEvidence(data.buyer_evidence) || 'Chưa cung cấp';
            document.getElementById('sellerEvidence').innerHTML = formatEvidence(data.seller_evidence) || 'Chưa cung cấp';
            modal.style.display = 'flex';
        } catch (err) { alert('Lỗi tải chi tiết tranh chấp: ' + err.message); }
    } else {
        // Fallback
        const action = prompt('Gõ "refund" để Hoàn tiền, hoặc "release" để Giải ngân:');
        if(action === 'refund' || action === 'release') executeEscrowAction(action);
    }
}

window.executeEscrowAction = async function(action) {
    const confirmMsg = action === 'release' ? 'GIẢI NGÂN cho Người bán?' : 'HOÀN TIỀN cho Người mua?';
    const ok = await showConfirm(confirmMsg); if (!ok) return;
    try {
        await apiCall(`/admin/escrow/${targetIdForModal}/resolve`, { method: 'POST', body: JSON.stringify({ action: action }) });
        if(document.getElementById('escrowDisputeModal')) document.getElementById('escrowDisputeModal').style.display = 'none';
        alert('Xử lý thành công!');
        loadDisputedEscrow(pageState.escrow.page);
    } catch (error) { alert('Lỗi xử lý Ký quỹ: ' + error.message); }
}

window.releaseEscrow = async function(escrowId) {
    const ok = await showConfirm('Release funds for this escrow transaction?'); if (!ok) return;
    try {
        await apiCall(`/admin/escrow/${escrowId}/resolve`, { method: 'POST', body: JSON.stringify({ action: 'release' }) });
        loadDisputedEscrow(pageState.escrow.page);
    } catch (err) { alert('Error releasing escrow: ' + err.message); }
}

// 5.3 Payments
window.approvePayment = async function(paymentId) {
    const ok = await showConfirm('Approve this payment?'); if (!ok) return;
    try { await apiCall(`/admin/payments/${paymentId}/status`, { method: 'PUT', body: JSON.stringify({ action: 'approve' }) }); loadPayments(pageState.payments.page); } 
    catch (err) { alert('Error approving payment: ' + err.message); }
}

window.rejectPayment = async function(paymentId) {
    const reason = await showPromptModal('Lý do từ chối thanh toán:');
    if (!reason) return;
    try {
        await apiCall(`/admin/payments/${paymentId}/status`, { method: 'PUT', body: JSON.stringify({ action: 'reject', reason }) });
        loadPayments(pageState.payments.page);
    } catch (error) { alert('Error rejecting payment: ' + error.message); }
}

// 5.4 Moderation & AI
window.adminDeleteProduct = async function(productId) {
    const ok = await showConfirm('Delete this product for policy violation?'); if (!ok) return;
    try { await apiCall(`/admin/products/${productId}`, { method: 'DELETE' }); loadModerationProducts(pageState.products.page); } catch (err) { alert('Error: ' + err.message); }
}

window.adminHideReview = async function(reviewId) {
    const ok = await showConfirm('Change visibility of this review?'); if (!ok) return;
    try { await apiCall(`/admin/reviews/${reviewId}/hide`, { method: 'PATCH', body: JSON.stringify({ is_hidden: true }) }); loadModerationReviews(pageState.reviews.page); } catch (err) { alert('Error: ' + err.message); }
}

window.addAiTopic = async function() {
    const topic = await showPromptModal('Nhập Chủ đề (Topic):'); if (!topic) return;
    const content = await showPromptModal('Nhập Nội dung kiến thức:'); if (!content) return;
    try { await apiCall('/admin/ai-knowledge', { method: 'POST', body: JSON.stringify({ topic, content }) }); loadAIKnowledge(); } catch (err) { alert('Error: ' + err.message); }
}

window.editAiTopic = async function(id) {
    const item = allAIKnowledge.find(x => x.id === id); if (!item) return;
    const topic = await showPromptModal('Chủ đề mới:', item.topic); if (!topic) return;
    const content = await showPromptModal('Nội dung mới:', item.content); if (!content) return;
    try { await apiCall(`/admin/ai-knowledge/${id}`, { method: 'PUT', body: JSON.stringify({ topic, content }) }); loadAIKnowledge(); } catch (err) { alert('Error: ' + err.message); }
}

window.deleteAiTopic = async function(id) {
    const ok = await showConfirm('Xóa dữ liệu AI này?'); if (!ok) return;
    try { await apiCall(`/admin/ai-knowledge/${id}`, { method: 'DELETE' }); loadAIKnowledge(); } catch (err) { alert('Error: ' + err.message); }
}

// 5.5 Settings & Export
window.saveSystemSettings = async function() {
    const fee = document.getElementById('settingPlatformFee').value;
    try {
        await apiCall('/admin/settings', { method: 'PUT', body: JSON.stringify({ settings: { platform_fee_percent: fee } }) });
        alert('Đã lưu cấu hình thành công!');
    } catch (err) { alert('Lỗi lưu cấu hình!'); }
}

window.exportToCSV = function(type) {
    let data = type === 'escrow' ? allEscrow : allPayments;
    if(!data || !data.length) return alert("Không có dữ liệu để xuất");
    
    let csv = type === 'escrow' ? "Mã Giao dịch,Người Mua,Người Bán,Số tiền,Trạng thái,Ngày tạo\n" : "ID,User,Amount,Status,Gateway,Date\n";
    data.forEach(e => {
        if(type === 'escrow') csv += `${e.id},${e.buyer?.username},${e.seller?.username},${e.amount},${e.status},${new Date(e.created_at).toLocaleString('vi-VN')}\n`;
        else csv += `${e.id},${e.user?.username},${e.amount},${e.status},${e.gateway},${new Date(e.created_at).toLocaleString('vi-VN')}\n`;
    });
    
    let blob = new Blob(["\uFEFF"+csv], {type: "text/csv;charset=utf-8;"});
    let link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.download = `${type}_report_${new Date().getTime()}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// 5.6 Live Chat
window.openChat = async function(chatId) {
    activeChatId = chatId;
    try {
        const res = await apiCall(`/admin/chats/${chatId}`);
        const messages = res.data?.messages || [];
        const win = document.getElementById('chatWindow');
        if (win) {
            win.innerHTML = messages.map(m => `<div style="margin-bottom:8px; ${m.from==='admin'?'text-align:right':''}"><span style="display:inline-block; padding:8px 12px; border-radius:12px; background:${m.from==='admin'?'#2563eb':'#f1f5f9'}; color:${m.from==='admin'?'white':'#0f172a'};"><strong>${m.from}:</strong> ${m.text}</span></div>`).join('');
            win.scrollTop = win.scrollHeight;
        }
    } catch (err) { console.error('Error opening chat', err); }
}

window.sendChatMessage = async function(chatId, text) {
    try { await apiCall(`/admin/chats/${chatId}/message`, { method: 'POST', body: JSON.stringify({ text }) }); openChat(chatId); } catch (err) { alert('Error: ' + err.message); }
}


// ── 6. UTILITIES (Filters, Modals Core) ───────────────────────

function getSeverityClass(severity) { const map = { 'critical': 'danger', 'error': 'danger', 'warn': 'warning', 'info': 'info' }; return map[severity] || 'secondary'; }
function getStatusBadgeClass(status) { const classes = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger', held: 'badge-warning', releasing: 'badge-info', released: 'badge-success', returned: 'badge-danger', disputed: 'badge-danger', active: 'badge-success', blocked: 'badge-danger' }; return classes[status] || 'badge-secondary'; }
function formatEvidence(e) { 
    if (!e) return 'Không có'; 
    if (Array.isArray(e)) return e.map(x => (x.type === 'image' ? `<img src="${x.url}" style="max-width:100%; border-radius:8px;">` : x.text)).join('<br>'); 
    return (e.type === 'image' ? `<img src="${e.url}" style="max-width:100%; border-radius:8px;">` : e.text) || JSON.stringify(e); 
}

function showConfirm(message) { 
    return new Promise((resolve) => {
        let modal = document.getElementById('confirmModal');
        if (!modal) { 
            modal = document.createElement('div'); modal.id = 'confirmModal'; modal.className = 'confirm-modal'; 
            modal.innerHTML = `<div class="confirm-box"><div id="confirmMessage" style="font-size:16px; margin-bottom:20px; font-weight:500;"></div><div class="confirm-actions"><button id="confirmNo" class="btn btn-outline">Hủy</button><button id="confirmYes" class="btn btn-primary" style="margin-left:10px;">Xác nhận</button></div></div>`; 
            document.body.appendChild(modal); 
        }
        modal.querySelector('#confirmMessage').textContent = message; modal.style.display = 'flex';
        const yes = modal.querySelector('#confirmYes'), no = modal.querySelector('#confirmNo');
        const clean = () => { modal.style.display = 'none'; yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); };
        const onYes = () => { clean(); resolve(true); }; const onNo = () => { clean(); resolve(false); };
        yes.addEventListener('click', onYes); no.addEventListener('click', onNo);
    }); 
}

function showPromptModal(title, defaultVal = '') {
    return new Promise((resolve) => {
        let modal = document.getElementById('customPromptModal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'customPromptModal'; modal.className = 'confirm-modal';
            modal.innerHTML = `<div class="confirm-box" style="width:400px;"><h3 id="promptTitle" style="margin-bottom:15px; font-size:18px;"></h3><textarea id="promptInput" rows="3" style="width:100%; padding:10px; border-radius:8px; border:1px solid #cbd5e1; font-family:inherit;"></textarea><div class="confirm-actions" style="margin-top:15px; text-align:right;"><button id="promptCancel" class="btn btn-outline">Hủy</button><button id="promptOk" class="btn btn-primary" style="margin-left:10px;">Xác nhận</button></div></div>`;
            document.body.appendChild(modal);
        }
        modal.querySelector('#promptTitle').textContent = title;
        const input = modal.querySelector('#promptInput'); input.value = defaultVal;
        modal.style.display = 'flex'; input.focus();

        const okBtn = modal.querySelector('#promptOk'), cancelBtn = modal.querySelector('#promptCancel');
        const clean = () => { modal.style.display = 'none'; okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel); };
        const onOk = () => { clean(); resolve(input.value.trim()); }; const onCancel = () => { clean(); resolve(null); };
        okBtn.addEventListener('click', onOk); cancelBtn.addEventListener('click', onCancel);
    });
}

function filterEscrow(status) { document.getElementById('escrowStatusFilter').value = status; loadDisputedEscrow(1); }
function filterPayments(status) { document.getElementById('paymentStatusFilter').value = status; loadPayments(1); }
function filterSystemLogs(severity) { loadLogs(1); }
function closeSidebarOnMobile() { if (window.innerWidth <= 768) { document.querySelector('.sidebar').classList.remove('active'); } }


// ── 7. EVENT LISTENERS ────────────────────────────────────────
function setupEventListeners() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.getAttribute('data-section');
            
            document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            const secEl = document.getElementById(`${section}-section`);
            if (secEl) secEl.classList.add('active');

            const pageTitle = document.getElementById('pageTitle');
            if(pageTitle) pageTitle.textContent = item.textContent.trim();

            if(section === 'dashboard') loadStats();
            if(section === 'users') loadUsers();
            if(section === 'escrow') loadDisputedEscrow();
            if(section === 'payments') loadPayments();
            if(section === 'system-logs') loadLogs();
            if(section === 'content-products') loadModerationProducts();
            if(section === 'content-reviews') loadModerationReviews();
            if(section === 'ai-knowledge') loadAIKnowledge();
            if(section === 'live-chat') loadLiveChats();
            if(section === 'settings') loadSettings();
            
            closeSidebarOnMobile();
        });
    });

    const searchInput = document.getElementById('userSearch');
    if (searchInput) {
        let timeout = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => loadUsers(1), 500); // Debounce search
        });
    }

    document.getElementById('escrowStatusFilter')?.addEventListener('change', (e) => loadDisputedEscrow(1));
    document.getElementById('paymentStatusFilter')?.addEventListener('change', (e) => loadPayments(1));
    document.getElementById('systemLogSeverityFilter')?.addEventListener('change', (e) => loadLogs(1));
    document.getElementById('logTypeFilter')?.addEventListener('change', (e) => loadLogs(1));

    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'sendChatBtn') {
            const input = document.getElementById('chatMessageInput');
            const txt = input.value.trim(); if (!txt || !activeChatId) return;
            sendChatMessage(activeChatId, txt); input.value = '';
        }
    });

    document.getElementById('addAiTopicBtn')?.addEventListener('click', window.addAiTopic);
    document.getElementById('refreshProductsModeration')?.addEventListener('click', () => loadModerationProducts(pageState.products.page));

    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal-overlay');
            if(modal) modal.style.display = 'none';
        });
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '../login.html';
    });
}

document.addEventListener('DOMContentLoaded', initializeDashboard);