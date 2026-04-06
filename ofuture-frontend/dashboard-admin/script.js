// ============================================================
// O'Future Admin Dashboard - Complete JavaScript
// Tích hợp logic DB & API Base URL
// ============================================================

const API_BASE_URL = 'http://localhost:5000/api';

// Store data
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

// ============================================================
// Authentication & Initialization
// ============================================================

async function initializeDashboard() {
    // Check if user is authenticated and is admin
    const token = localStorage.getItem('accessToken');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    // Kiểm tra quyền Admin ngay tại đầu phễu (từ script.js)
    if (!token || user.role !== 'admin') {
        alert('Bạn không có quyền truy cập! Đang chuyển hướng về trang Login.');
        window.location.href = '../login.html';
        return;
    }

    currentAdmin = user;

    // Update UI with user info
    document.getElementById('username').textContent = currentAdmin.username || 'Admin';

    // Setup event listeners
    setupEventListeners();
    
    // Load initial data
    await loadDashboardData();
}

// ============================================================
// API Calls with Auth (Core Fetching)
// ============================================================

async function apiCall(endpoint, options = {}) {
    // Bật spinner loading của Admin Dashboard
    activeRequests += 1; showAdminSpinner();

    try {
        // Tái sử dụng fetchAPI từ file api.js để quản lý Token, Header và lỗi 401 tập trung
        return await fetchAPI(endpoint, options);
    } catch (error) {
        console.error('Admin API Error:', error);
        throw error;
    } finally {
        // Tắt spinner khi request xong (dù thành công hay thất bại)
        activeRequests = Math.max(0, activeRequests - 1);
        if (activeRequests === 0) hideAdminSpinner();
    }
}

function showAdminSpinner(){ const el = document.getElementById('globalSpinner'); if(el) el.style.display='flex'; }
function hideAdminSpinner(){ const el = document.getElementById('globalSpinner'); if(el) el.style.display='none'; }

// ============================================================
// Data Loading Functions
// ============================================================

async function loadDashboardData() {
    try {
        // Tải song song để tăng tốc độ hiển thị
        await Promise.all([
            loadStats(), // Lấy số liệu tổng quát từ API Backend
            loadUsers(),
            loadLogs(),
            loadDisputedEscrow(),
            loadPayments(),
            loadModerationProducts(),
            loadModerationReviews(),
            loadAIKnowledge(),
            loadLiveChats(),
        ]);
        
        // Cập nhật các thống kê khác nếu có
        updatePlatformRevenue();
    } catch (error) {
        console.error('Lỗi kết nối Backend:', error);
    }
}

// Lấy số liệu tổng quát từ API /admin/stats (Tích hợp logic script.js)
async function loadStats() {
    try {
        const res = await apiCall('/admin/stats');
        const stats = res.data || {};
        
        // Cập nhật Dashboard chính
        if (document.getElementById('totalUsers')) document.getElementById('totalUsers').textContent = stats.totalUsers || 0;
        if (document.getElementById('totalSellers')) document.getElementById('totalSellers').textContent = stats.totalSellers || 0;
        if (document.getElementById('totalTransactions')) document.getElementById('totalTransactions').textContent = stats.totalOrders || 0;
        if (document.getElementById('totalEscrowBalance')) document.getElementById('totalEscrowBalance').textContent = '$' + (stats.totalEscrowHeld || 0).toLocaleString();
        
        // Cập nhật Escrow chi tiết (nếu có trên giao diện của script1)
        if (document.getElementById('escrowHeld')) document.getElementById('escrowHeld').textContent = '$' + (stats.escrowHeld || 0).toLocaleString();
        if (document.getElementById('escrowReleased')) document.getElementById('escrowReleased').textContent = '$' + (stats.escrowReleased || 0).toLocaleString();
        if (document.getElementById('escrowPending')) document.getElementById('escrowPending').textContent = '$' + (stats.escrowPending || 0).toLocaleString();
    } catch (err) {
        console.warn('Không thể tải thống kê stats');
    }
}

// Lấy danh sách User từ API /admin/users
async function loadUsers() {
    try {
        const response = await apiCall('/admin/users');
        allUsers = response.data || [];
        renderUsersTable();
    } catch (error) {
        console.error('Error loading users:', error);
        const tbody = document.getElementById('usersTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red;">Lỗi tải dữ liệu người dùng</td></tr>';
    }
}

// Lấy Nhật ký hoạt động từ API /admin/logs
async function loadLogs() {
    try {
        const response = await apiCall('/admin/logs');
        allLogs = response.data || [];
        renderLogsTable();    // Render cho bảng System Logs
        renderActivityLogs(); // <-- THÊM DÒNG NÀY: Render cho Activity Logs
    } catch (error) {
        console.error('Error loading logs:', error);
        const tbody = document.getElementById('systemLogsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red;">Lỗi tải nhật ký hệ thống</td></tr>';
        
        const container = document.getElementById('logsContainer');
        if (container) container.innerHTML = '<p class="text-center" style="color:red;">Lỗi tải nhật ký hoạt động</p>';
    }
}

// Các hàm tải dữ liệu khác (Giữ nguyên của script1.js)
async function loadDisputedEscrow() {
    try {
        const response = await apiCall('/admin/escrow?status=disputed');
        allEscrow = response.data || [];
        renderEscrowTable();
    } catch (error) {
        const tbody = document.getElementById('escrowTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center">Error loading escrow disputes</td></tr>';
    }
}

async function loadPayments() {
    try {
        const response = await apiCall('/admin/payments');
        allPayments = response.data || [];
        renderPaymentsTable();
    } catch (error) {
        const tbody = document.getElementById('paymentsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error loading payments</td></tr>';
    }
}

async function loadModerationProducts() {
    try {
        const res = await apiCall('/admin/products');
        allModerationProducts = res.data || [];
        renderModerationProducts();
    } catch (err) {
        const tbody = document.getElementById('productsModerationBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error loading products</td></tr>';
    }
}

async function loadModerationReviews() {
    try {
        const res = await apiCall('/admin/reviews');
        allModerationReviews = res.data || [];
        renderModerationReviews();
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

// ============================================================
// Rendering Functions
// ============================================================

// Tích hợp logic xử lý khớp với API Backend (camelCase)
function renderUsersTable(data = allUsers) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Chưa có người dùng nào</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(u => {
        // ĐÃ SỬA: Map chuẩn với cột isActive từ API Backend trả về
        const activeStatus = u.isActive === true;
        
        return `
        <tr>
            <td>${u.email || '-'}</td>
            <td>${u.username || '-'}</td>
            <td>${u.fullName || '-'}</td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-info'}">${(u.role || 'user').toUpperCase()}</span></td>
            <td>
                <span class="badge ${activeStatus ? 'badge-success' : 'badge-danger'}">
                    ${activeStatus ? 'Hoạt động' : 'Bị khóa'}
                </span>
            </td>
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

// Render System Logs theo đúng mapping của script.js
function renderLogsTable() {
    const tbody = document.getElementById('systemLogsTableBody');
    if (!tbody) {
        console.warn("⚠️ Frontend Architect Alert: Không tìm thấy thẻ <tbody id='systemLogsTableBody'> trong file HTML!");
        return;
    }

    if (allLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Không có nhật ký nào</td></tr>';
        return;
    }

    tbody.innerHTML = allLogs.slice(0, 100).map(log => `
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

// Render Activity Logs (Dạng danh sách feed)
function renderActivityLogs(data = allLogs) {
    const container = document.getElementById('logsContainer');
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = '<p class="text-center">Chưa có hoạt động nào được ghi nhận.</p>';
        return;
    }

    // Thiết kế giao diện từng dòng log cho đẹp mắt
    container.innerHTML = data.slice(0, 50).map(log => `
        <div style="padding: 12px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #fff; margin-bottom: 8px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
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

function getSeverityClass(severity) {
    switch (severity) {
        case 'error':
        case 'critical':
            return 'danger';
        case 'warn':
            return 'warning';
        case 'info':
        default:
            return 'info';
    }
}

function renderEscrowTable() {
    const tbody = document.getElementById('escrowTableBody');
    if (!tbody) return;

    if (allEscrow.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No disputed escrow records found</td></tr>';
        return;
    }

    tbody.innerHTML = allEscrow.map(escrow => `
        <tr>
            <td>${escrow.id?.substring(0, 8) || 'N/A'}</td>
            <td>${escrow.buyer?.username || 'Unknown'}</td>
            <td>${escrow.seller?.username || 'Unknown'}</td>
            <td>$${escrow.amount?.toFixed(2) || '0.00'}</td>
            <td class="text-muted">${new Date(escrow.created_at).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-small btn-primary" onclick="resolveDispute('${escrow.id}')">Resolve</button>
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
            <td>${r.product?.name||''}</td>
            <td>${r.user?.username||''}</td>
            <td>${r.rating||0}</td>
            <td>${(r.body||'').substring(0,120)}</td>
            <td>${r.is_hidden ? 'Yes' : 'No'}</td>
            <td><button class="btn btn-small btn-warning" onclick="adminHideReview('${r.id}')">Hide</button></td>
        </tr>
    `).join('');
}

function renderAIKnowledge() {
    const tbody = document.getElementById('aiKnowledgeBody');
    if (!tbody) return;
    if (!allAIKnowledge || allAIKnowledge.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="text-center">No topics found</td></tr>'; return; }
    tbody.innerHTML = allAIKnowledge.map(item => `
        <tr>
            <td>${item.topic||''}</td>
            <td>${(item.content||'').substring(0,200)}</td>
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
    if (!allLiveChats || allLiveChats.length === 0) { el.innerHTML = '<li class="text-center">No live chats</li>'; return; }
    el.innerHTML = allLiveChats.map(c => `<li style="list-style:none;margin-bottom:8px;"><a href="#" onclick="openChat('${c.id}');return false;">${c.user?.username||'Guest'} - ${c.id?.substring(0,8)||''}</a></li>`).join('');
}

function renderPaymentsTable() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    if (allPayments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No payments found</td></tr>';
        return;
    }

    tbody.innerHTML = allPayments.map(payment => `
        <tr>
            <td>${payment.id?.substring(0, 8) || 'N/A'}</td>
            <td>${payment.user?.username || 'Unknown'}</td>
            <td>$${payment.amount?.toFixed(2) || '0.00'}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(payment.status)}">
                    ${payment.status || 'unknown'}
                </span>
            </td>
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

// Cập nhật tính doanh thu platform (Giữ lại từ script1)
function updatePlatformRevenue() {
    const totalPlatformRevenue = (allPayments || []).reduce((sum, p) => sum + (Number(p.platform_fee || p.fee || 0)), 0);
    let revenueEl = document.getElementById('totalPlatformRevenue');
    if (!revenueEl) {
        const grid = document.querySelector('.stats-grid');
        if (grid) {
            const div = document.createElement('div');
            div.className = 'stat-card';
            div.innerHTML = `<h3>Total Platform Revenue</h3><p id="totalPlatformRevenue">$0</p>`;
            grid.appendChild(div);
            revenueEl = document.getElementById('totalPlatformRevenue');
        }
    }
    if (revenueEl) revenueEl.textContent = '$' + totalPlatformRevenue.toFixed(2);
}

// ============================================================
// Action Functions
// ============================================================

// Khớp với route PUT /admin/users/:id/suspend (Tích hợp logic từ script.js)
async function handleSuspendUser(userId, currentIsActive) {
    // Ép kiểu an toàn để đảm bảo luôn là boolean
    const isCurrentlyActive = currentIsActive === true || currentIsActive === 'true' || currentIsActive === 1;
    const actionText = isCurrentlyActive ? 'Khóa' : 'Mở khóa';
    
    const reason = prompt(`Lý do ${actionText} tài khoản này (Bấm Cancel để hủy):`);
    
    // Nếu Admin bấm Cancel ở prompt -> Hủy ngay thao tác
    if (reason === null) {
        return;
    }

    // Nếu đang khóa mà Admin cố tình để trống text -> Chặn lại
    if (isCurrentlyActive && reason.trim() === '') {
        alert('Vui lòng nhập lý do để khóa tài khoản!');
        return;
    }

    try {
        await apiCall(`/admin/users/${userId}/suspend`, {
            method: 'PUT',
            body: JSON.stringify({ 
                suspend: isCurrentlyActive,
                reason: reason.trim() || 'Thay đổi bởi Admin' 
            })
        });
        alert(`Đã ${actionText} tài khoản thành công.`);
        await loadUsers(); // Refresh lại bảng
    } catch (error) {
        alert('Lỗi thực hiện: ' + error.message);
    }
}

async function resolveDispute(escrowId) {
    try {
        const res = await apiCall(`/admin/escrow/${escrowId}`);
        const data = res.data || {};
        let html = `Order: ${data.order_id || ''}\nAmount: $${Number(data.amount || 0).toFixed(2)}\n\nBuyer Evidence:\n${formatEvidence(data.buyer_evidence)}\n\nSeller Evidence:\n${formatEvidence(data.seller_evidence)}`;
        
        const decision = prompt(html + '\n\nType "refund" to Refund, "release" to Release funds, or cancel to do nothing');
        if (!decision) return;
        
        if (decision.toLowerCase() === 'refund') {
            await apiCall('/admin/escrow/refund', { method: 'POST', body: JSON.stringify({ escrow_id: escrowId }) });
            await loadDisputedEscrow();
            alert('Refund executed');
        } else if (decision.toLowerCase() === 'release') {
            await apiCall('/admin/escrow/release', { method: 'POST', body: JSON.stringify({ escrow_id: escrowId }) });
            await loadDisputedEscrow();
            alert('Funds released');
        }
    } catch (err) { alert('Error resolving dispute: ' + err.message); }
}

async function releaseEscrow(escrowId) {
    const ok = await showConfirm('Release funds for this escrow transaction?'); if (!ok) return;
    try {
        await apiCall('/admin/escrow/release', { method: 'POST', body: JSON.stringify({ escrow_id: escrowId }) });
        await loadDisputedEscrow();
    } catch (err) { alert('Error releasing escrow: ' + err.message); }
}

async function approvePayment(paymentId) {
    const ok = await showConfirm('Approve this payment?'); if (!ok) return;
    try { await apiCall(`/admin/payments/${paymentId}/approve`, { method: 'PATCH' }); await loadPayments(); } catch (err) { alert('Error approving payment: ' + err.message); }
}

async function rejectPayment(paymentId) {
    const reason = prompt('Reason for rejection:');
    if (!reason) return;
    try {
        await apiCall(`/admin/payments/${paymentId}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) });
        alert('Payment rejected successfully!');
        await loadPayments();
    } catch (error) { alert('Error rejecting payment: ' + error.message); }
}

// AI Knowledge & Moderation
async function adminDeleteProduct(productId) {
    const ok = await showConfirm('Delete this product for policy violation?'); if (!ok) return;
    try { await apiCall(`/admin/products/${productId}`, { method: 'DELETE' }); await loadModerationProducts(); } catch (err) { alert('Error deleting product: ' + err.message); }
}

async function adminHideReview(reviewId) {
    const ok = await showConfirm('Hide this review?'); if (!ok) return;
    try { await apiCall(`/admin/reviews/${reviewId}`, { method: 'PATCH', body: JSON.stringify({ is_hidden: 1 }) }); await loadModerationReviews(); } catch (err) { alert('Error hiding review: ' + err.message); }
}

async function addAiTopic() {
    const topic = prompt('Topic title:'); if (!topic) return;
    const content = prompt('Content:'); if (content === null) return;
    try { await apiCall('/admin/ai-knowledge', { method: 'POST', body: JSON.stringify({ topic, content }) }); await loadAIKnowledge(); } catch (err) { alert('Error adding topic: ' + err.message); }
}

async function editAiTopic(id) {
    const item = allAIKnowledge.find(x => x.id === id); if (!item) return;
    const topic = prompt('Topic title:', item.topic); if (topic === null) return;
    const content = prompt('Content:', item.content); if (content === null) return;
    try { await apiCall(`/admin/ai-knowledge/${id}`, { method: 'PUT', body: JSON.stringify({ topic, content }) }); await loadAIKnowledge(); } catch (err) { alert('Error editing topic: ' + err.message); }
}

async function deleteAiTopic(id) {
    const ok = await showConfirm('Delete this AI topic?'); if (!ok) return;
    try { await apiCall(`/admin/ai-knowledge/${id}`, { method: 'DELETE' }); await loadAIKnowledge(); } catch (err) { alert('Error deleting topic: ' + err.message); }
}

async function openChat(chatId) {
    activeChatId = chatId;
    try {
        const res = await apiCall(`/admin/chats/${chatId}`);
        const messages = res.data?.messages || [];
        const win = document.getElementById('chatWindow');
        if (win) win.innerHTML = messages.map(m => `<div><strong>${m.from}:</strong> ${m.text}</div>`).join('');
    } catch (err) { console.error('Error opening chat', err); const win = document.getElementById('chatWindow'); if (win) win.innerHTML = 'Error loading chat'; }
}

async function sendChatMessage(chatId, text) {
    try {
        await apiCall(`/admin/chats/${chatId}/message`, { method: 'POST', body: JSON.stringify({ text }) });
        await openChat(chatId);
    } catch (err) { alert('Error sending message: ' + err.message); }
}

// ============================================================
// Navigation & Events
// ============================================================

function setupEventListeners() {
    // Chuyển Tab Menu
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.getAttribute('data-section');
            showSection(section, item);
            closeSidebarOnMobile();
        });
    });

    // Tìm kiếm User theo Email/Username an toàn (Tránh crash nếu thiếu data)
    const searchInput = document.getElementById('userSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allUsers.filter(u => 
                (u.username || '').toLowerCase().includes(term) || 
                (u.email || '').toLowerCase().includes(term)
            );
            renderUsersTable(filtered);
        });
    }

    // Các Filter khác
    const escrowFilter = document.getElementById('escrowStatusFilter');
    if (escrowFilter) escrowFilter.addEventListener('change', (e) => filterEscrow(e.target.value));

    const paymentFilter = document.getElementById('paymentStatusFilter');
    if (paymentFilter) paymentFilter.addEventListener('change', (e) => filterPayments(e.target.value));

    const logFilter = document.getElementById('systemLogSeverityFilter');
    if (logFilter) logFilter.addEventListener('change', (e) => filterSystemLogs(e.target.value));

    // Kích hoạt Filter cho Activity Logs
    const logTypeFilter = document.getElementById('logTypeFilter');
    if (logTypeFilter) {
        logTypeFilter.addEventListener('change', (e) => {
            const type = e.target.value;
            if (!type) {
                renderActivityLogs(allLogs); // Hiện tất cả
            } else {
                // Lọc không phân biệt hoa thường để khớp chuẩn với Database
                const filtered = allLogs.filter(log => 
                    (log.event_type || '').toLowerCase() === type.toLowerCase()
                );
                renderActivityLogs(filtered);
            }
        });
    }

    // Nút Send Chat
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'sendChatBtn') {
            const input = document.getElementById('chatMessageInput');
            const txt = input.value.trim(); if (!txt || !activeChatId) return;
            sendChatMessage(activeChatId, txt); input.value = '';
        }
    });

    // Các nút AI và Moderation
    const addBtn = document.getElementById('addAiTopicBtn'); 
    if (addBtn) addBtn.addEventListener('click', addAiTopic);
    const refreshProductsBtn = document.getElementById('refreshProductsModeration'); 
    if (refreshProductsBtn) refreshProductsBtn.addEventListener('click', loadModerationProducts);

    // Đăng xuất
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '../login.html';
    });
}

function showSection(sectionName, menuItem) {
    document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
    menuItem.classList.add('active');

    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(`${sectionName}-section`);
    if (section) section.classList.add('active');

    const titles = { dashboard: 'Dashboard', users: 'Quản lý người dùng', escrow: 'Escrow Management', payments: 'Payment Management', 'system-logs': 'Nhật ký hệ thống' };
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = titles[sectionName] || menuItem.textContent.trim();
}

// ============================================================
// Filtering & Helper Functions
// ============================================================

function filterEscrow(status) {
    if (!status) { renderEscrowTable(); return; }
    const tbody = document.getElementById('escrowTableBody');
    const filtered = allEscrow.filter(e => e.status === status);
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">No escrow records with status: ${status}</td></tr>`;
        return;
    }
    
    tbody.innerHTML = filtered.map(escrow => `
        <tr>
            <td>${escrow.id?.substring(0, 8) || 'N/A'}</td>
            <td>${escrow.buyer?.username || 'Unknown'}</td>
            <td>${escrow.seller?.username || 'Unknown'}</td>
            <td>$${escrow.amount?.toFixed(2) || '0.00'}</td>
            <td class="text-muted">${new Date(escrow.created_at).toLocaleDateString()}</td>
            <td><button class="btn btn-small btn-primary" onclick="resolveDispute('${escrow.id}')">Resolve</button></td>
        </tr>
    `).join('');
}

function filterPayments(status) {
    if (!status) { renderPaymentsTable(); return; }
    const tbody = document.getElementById('paymentsTableBody');
    const filtered = allPayments.filter(p => p.status === status);
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">No payments with status: ${status}</td></tr>`;
        return;
    }
    
    // (Render similar logic for filtered payments)
    tbody.innerHTML = filtered.map(payment => `
        <tr>
            <td>${payment.id?.substring(0, 8) || 'N/A'}</td>
            <td>${payment.user?.username || 'Unknown'}</td>
            <td>$${payment.amount?.toFixed(2) || '0.00'}</td>
            <td><span class="badge ${getStatusBadgeClass(payment.status)}">${payment.status || 'unknown'}</span></td>
            <td>${payment.gateway || '-'}</td>
            <td class="text-muted">${new Date(payment.created_at).toLocaleDateString()}</td>
            <td>${payment.status === 'pending' ? `<button class="btn btn-small btn-success" onclick="approvePayment('${payment.id}')">Approve</button><button class="btn btn-small btn-danger" onclick="rejectPayment('${payment.id}')">Reject</button>` : '-'}</td>
        </tr>
    `).join('');
}

function filterSystemLogs(severity) {
    if (!severity) { renderLogsTable(); return; }
    const tbody = document.getElementById('systemLogsTableBody');
    const filtered = allLogs.filter(log => log.severity === severity);
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">Không có logs có độ nghiêm trọng: ${severity}</td></tr>`;
        return;
    }
    
    tbody.innerHTML = filtered.slice(0, 100).map(log => `
        <tr>
            <td class="text-muted">${new Date(log.created_at).toLocaleString()}</td>
            <td><span class="badge badge-${getSeverityClass(log.severity)}">${log.severity || 'info'}</span></td>
            <td>${log.event_type || '-'}</td>
            <td class="text-truncate" style="max-width: 300px;" title="${log.message || ''}">${log.message?.substring(0, 50) || '-'}</td>
            <td>${log.user_id || '-'}</td>
            <td>${log.ip_address || '-'}</td>
            <td>${log.endpoint || '-'}</td>
        </tr>
    `).join('');
}

function getStatusBadgeClass(status) {
    const classes = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger', held: 'badge-warning', releasing: 'badge-info', released: 'badge-success', active: 'badge-success', blocked: 'badge-danger' };
    return classes[status] || 'badge-secondary';
}

function formatEvidence(e) { 
    if (!e) return 'No evidence'; 
    if (Array.isArray(e)) return e.map(x => (x.type === 'image' ? x.url : x.text)).join('\n'); 
    return (e.type === 'image' ? e.url : e.text) || JSON.stringify(e); 
}

function showConfirm(message) { 
    return new Promise((resolve) => {
        let modal = document.getElementById('confirmModal');
        if (!modal) { 
            modal = document.createElement('div'); 
            modal.id = 'confirmModal'; 
            modal.className = 'confirm-modal'; 
            modal.innerHTML = `<div class="confirm-box"><div id="confirmMessage"></div><div class="confirm-actions"><button id="confirmNo" class="btn btn-secondary">No</button><button id="confirmYes" class="btn btn-primary">Yes</button></div></div>`; 
            document.body.appendChild(modal); 
        }
        modal.querySelector('#confirmMessage').textContent = message; modal.style.display = 'flex';
        const yes = modal.querySelector('#confirmYes'); const no = modal.querySelector('#confirmNo');
        const clean = () => { modal.style.display = 'none'; yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); };
        const onYes = () => { clean(); resolve(true); };
        const onNo = () => { clean(); resolve(false); };
        yes.addEventListener('click', onYes); no.addEventListener('click', onNo);
    }); 
}

function closeSidebarOnMobile() { if (window.innerWidth <= 768) { document.querySelector('.sidebar').classList.remove('active'); } }

// ============================================================
// Initialize on page load
// ============================================================

document.addEventListener('DOMContentLoaded', initializeDashboard);