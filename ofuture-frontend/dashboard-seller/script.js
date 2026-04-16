// ============================================================
// O'Future Seller Dashboard - JavaScript (ENTERPRISE EDITION)
// Đã tích hợp Logic Backend, Phân trang, Modal Động & Chart.js
// ============================================================

const API_BASE_URL = 'http://localhost:5000/api';
const BACKEND_BASE_URL = API_BASE_URL.replace('/api', '') || 'http://localhost:5000';
const formatVND = (value) => `${Number(value || 0).toLocaleString('vi-VN')} Đ`;

// Store data
let currentUser = null;
let allProducts = [];
let allOrders = [];
let allEscrow = [];
let allReviews = [];
let allDisputes = [];
let allSamples = [];
let activeRequests = 0;
let editingProductId = null;
let mfaEnabled = false;
let profileEditMode = false;

const CATEGORY_OPTION_PRESETS = {
    Fashion: [
        { key: 'size', label: 'Size (S, M, L...)' },
        { key: 'color', label: 'Color (Đỏ, Đen...)' },
        { key: 'material', label: 'Material (Cotton, Denim...)' }
    ],
    Electronics: [
        { key: 'model', label: 'Model (Pro, Plus...)' },
        { key: 'storage', label: 'Storage (128GB, 256GB...)' },
        { key: 'color', label: 'Color' }
    ],
    Beauty: [
        { key: 'volume', label: 'Volume (30ml, 100ml...)' },
        { key: 'skin_type', label: 'Skin Type (Dry, Oily...)' },
        { key: 'tone', label: 'Tone/Shade' }
    ]
};

// ── THÊM MỚI: Trạng thái Phân trang & Biểu đồ ──
const pageState = {
    products: { page: 1, limit: 10, totalPages: 1 },
    orders:   { page: 1, limit: 10, totalPages: 1 },
    escrow:   { page: 1, limit: 10, totalPages: 1 },
    disputes: { page: 1, limit: 10, totalPages: 1 },
    samples:  { page: 1, limit: 10, totalPages: 1 },
    reviews:  { page: 1, limit: 10, totalPages: 1 }
};
let revenueChartInstance = null;
let statusChartInstance = null;

// ============================================================
// Authentication & Initialization
// ============================================================

async function initializeDashboard() {
    const token = localStorage.getItem('accessToken');
    const user = localStorage.getItem('user');

    if (!token || !user) {
        window.location.href = '../login.html';
        return;
    }

    try {
        currentUser = JSON.parse(user);

        // Check if user is seller
        if (currentUser.role !== 'seller' && currentUser.role !== 'admin') {
            alert('Chỉ tài khoản người bán mới được truy cập khu vực này.');
            window.location.href = '../index.html';
            return;
        }

        // Update UI with user info
        const usernameEl = document.getElementById('username');
        if (usernameEl) usernameEl.textContent = currentUser.full_name || currentUser.username;

        // Load initial data
        await loadDashboardData();

        // Setup event listeners
        setupEventListeners();
    } catch (error) {
        console.error('Error initializing dashboard:', error);
        alert('Không thể tải bảng điều khiển. Vui lòng đăng nhập lại.');
        localStorage.clear();
        window.location.href = '../login.html';
    }
}

// ============================================================
// API Calls with Auth
// ============================================================

async function apiCall(endpoint, options = {}) {
    activeRequests += 1;
    showSpinner();

    try {
        // Gọi qua fetchAPI trung tâm (api.js)
        return await fetchAPI(endpoint, options);
    } catch (error) {
        console.error('Seller API Error:', error);
        throw error;
    } finally {
        activeRequests = Math.max(0, activeRequests - 1);
        if (activeRequests === 0) hideSpinner();
    }
}

function showSpinner() {
    const el = document.getElementById('globalSpinner');
    if (el) el.style.display = 'flex';
}

function hideSpinner() {
    const el = document.getElementById('globalSpinner');
    if (el) el.style.display = 'none';
}

// ============================================================
// Data Loading Functions (CÓ PHÂN TRANG)
// ============================================================

// ============================================================
// Data Loading Functions (CÓ PHÂN TRANG)
// ============================================================

async function loadDashboardData() {
    try {
        // TẢI TUẦN TỰ: Đợi tải xong cái này mới tải cái kia
        // Giúp Backend không bị ngộp (tránh lỗi 429 Rate Limit)
        await loadProducts(1);
        await loadOrders(1);
        await loadEscrow(1);
        await loadReviews(1);
        await loadDisputes(1);
        await loadSamples(1);
        await loadProfileData();
        
        updateDashboardStats();
        renderRevenueChart(); // Vẽ biểu đồ sau khi load xong
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

async function loadProfileData() {
    try {
        const meRes = await apiCall('/auth/me');
        const me = meRes.data || {};

        const fullNameEl = document.getElementById('profileFullName');
        const phoneEl = document.getElementById('profilePhone');
        if (fullNameEl) fullNameEl.value = me.fullName || '';
        if (phoneEl) phoneEl.value = me.phone || '';
        const storeNameEl = document.getElementById('profileStoreName');
        const categoryEl = document.getElementById('profileCategory');
        if (storeNameEl) storeNameEl.value = currentUser?.store_name || '';
        if (categoryEl) categoryEl.value = currentUser?.category || '';

        // Cập nhật UI MFA
        const mfaStatus = document.getElementById('mfaStatus');
        const mfaArea = document.getElementById('mfaSetupArea');
        if (me.mfaEnabled || me.mfa_enabled) {
            if(mfaStatus) {
                mfaStatus.textContent = "Đã bật an toàn";
                mfaStatus.className = "badge badge-success";
            }
            if(mfaArea) {
                mfaArea.innerHTML = `<button onclick="confirmDisableMFA()" class="btn btn-danger">Tắt bảo mật MFA</button>`;
            }
        }

        // Lấy số dư ví thực tế (Dòng tiền web đã chuyển vào)
        try {
            const walletRes = await apiCall('/wallet/balance');
            if (walletRes.success && walletRes.data) {
                const totalRevenueEl = document.getElementById('totalRevenue');
                if (totalRevenueEl) {
                    totalRevenueEl.textContent = walletRes.data.formattedBalance || `${Number(walletRes.data.balance).toLocaleString('vi-VN')} Đ`;
                    totalRevenueEl.previousElementSibling.textContent = "Số dư Ví (Tiền đã nhận)";
                }
            }
        } catch (walletErr) {
            console.error("Không thể lấy số dư ví:", walletErr);
        }

    } catch (error) {
        console.error("Lỗi load profile:", error);
    }
}

function updateMfaStatusUI(enabled) {
    const statusEl = document.getElementById('mfaStatusText');
    const setupBtn = document.getElementById('setupMfaBtn');
    const disableBtn = document.getElementById('disableMfaBtn');
    if (statusEl) statusEl.textContent = enabled ? 'Đang bật' : 'Đang tắt';
    if (setupBtn) setupBtn.disabled = enabled;
    if (disableBtn) disableBtn.disabled = !enabled;
}

function setProfileFieldsDisabled(disabled) {
    ['profileFullName', 'profilePhone', 'profileStoreName', 'profileCategory', 'profileCity', 'profileAddress']
        .forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = disabled;
        });
    const submitBtn = document.getElementById('submitProfileRequestBtn');
    if (submitBtn) submitBtn.disabled = disabled;
}

async function loadProducts(page = 1) {
    try {
        pageState.products.page = page;
        const response = await apiCall(`/products/seller/my?page=${page}&limit=${pageState.products.limit}`);
        allProducts = Array.isArray(response.data) ? response.data : [];
        if(response.pagination) pageState.products.totalPages = response.pagination.totalPages;
        
        renderProductsTable();
        renderPagination('productsPagination', pageState.products, loadProducts);
    } catch (error) {
        document.getElementById('productsTableBody').innerHTML = `<tr><td colspan="5" class="text-center" style="color:red;">Lỗi tải sản phẩm: ${error.message}</td></tr>`;
    }
}

async function loadOrders(page = 1) {
    try {
        pageState.orders.page = page;
        const response = await apiCall(`/seller/orders?page=${page}&limit=${pageState.orders.limit}`);
        allOrders = response.data || [];
        if(response.pagination) pageState.orders.totalPages = response.pagination.totalPages;
        
        renderOrdersTable();
        renderPagination('ordersPagination', pageState.orders, loadOrders);
        if(page === 1) renderRevenueChart(); // Cập nhật biểu đồ nếu ở trang 1
    } catch (error) {
        document.getElementById('ordersTableBody').innerHTML = `<tr><td colspan="6" class="text-center" style="color:red;">Lỗi tải đơn hàng: ${error.message}</td></tr>`;
    }
}

async function loadEscrow(page = 1) {
    try {
        pageState.escrow.page = page;
        const response = await apiCall(`/seller/escrow?page=${page}&limit=${pageState.escrow.limit}`);
        allEscrow = response.data || [];
        if(response.pagination) pageState.escrow.totalPages = response.pagination.totalPages;
        
        renderEscrowTable();
        renderPagination('escrowPagination', pageState.escrow, loadEscrow);
    } catch (error) {
        document.getElementById('escrowTableBody').innerHTML = `<tr><td colspan="6" class="text-center" style="color:red;">Lỗi tải ký quỹ: ${error.message}</td></tr>`;
    }
}

async function loadReviews(page = 1) {
    try {
        pageState.reviews.page = page;
        const response = await apiCall(`/seller/reviews?page=${page}&limit=${pageState.reviews.limit}`);
        allReviews = response.data || [];
        if(response.pagination) pageState.reviews.totalPages = response.pagination.totalPages;
        
        renderReviews();
        renderPagination('reviewsPagination', pageState.reviews, loadReviews);
    } catch (error) {
        document.getElementById('reviewsContainer').innerHTML = `<p class="text-center" style="color:red;">Lỗi tải đánh giá: ${error.message}</p>`;
    }
}

async function loadDisputes(page = 1) {
    try {
        pageState.disputes.page = page;
        const res = await apiCall(`/seller/disputes?page=${page}&limit=${pageState.disputes.limit}`);
        allDisputes = res.data || [];
        if(res.pagination) pageState.disputes.totalPages = res.pagination.totalPages;
        
        const tbody = document.getElementById('disputesTableBody');
        if (tbody) {
            renderDisputesTable(tbody);
            renderPagination('disputesPagination', pageState.disputes, loadDisputes);
        }
    } catch (err) {
        const tbody = document.getElementById('disputesTableBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:red;">Lỗi tải khiếu nại: ${err.message}</td></tr>`;
    }
}

async function loadSamples(page = 1) {
    try {
        pageState.samples.page = page;
        const res = await apiCall(`/seller/samples?page=${page}&limit=${pageState.samples.limit}`);
        allSamples = res.data || [];
        if(res.pagination) pageState.samples.totalPages = res.pagination.totalPages;
        else pageState.samples.totalPages = 1; // Fallback
        
        const tbody = document.getElementById('samplesTableBody');
        if (tbody) {
            renderSamplesTable(tbody);
            renderPagination('samplesPagination', pageState.samples, loadSamples);
        }
    } catch (err) {
        const tbody = document.getElementById('samplesTableBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:red;">Lỗi tải yêu cầu mẫu: ${err.message}</td></tr>`;
    }
}

// ============================================================
// Rendering Functions
// ============================================================

function renderProductsTable(products = allProducts) {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    if (!products || products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Chưa có sản phẩm. Bấm "Thêm sản phẩm mới" để bắt đầu.</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(product => {
        // --- FIX ẢNH SELLER TẠI ĐÂY ---
        let imgUrl = '../../images/image.png';
        if (product.imageUrls) {
            try {
                const parsedImgs = typeof product.imageUrls === 'string' ? JSON.parse(product.imageUrls) : product.imageUrls;
                if (Array.isArray(parsedImgs) && parsedImgs.length > 0) {
                    let rawUrl = parsedImgs[0];
                    if (rawUrl.startsWith('/uploads')) {
                        imgUrl = `${BACKEND_BASE_URL}${rawUrl}`;
                    } else {
                        imgUrl = rawUrl;
                    }
                }
            } catch(e){}
        }

        return `
        <tr>
            <td><img src="${imgUrl}" style="width: 45px; height: 45px; object-fit: cover; border-radius: 6px;"></td>
            <td>
                <strong>${escapeHtml(product.name)}</strong><br>
                <small style="color:#64748b;">${escapeHtml(product.category || 'Khác')}</small>
            </td>
            <td>${formatVND(parseInt(product.price || 0))}</td>
            <td>${product.stockQuantity ?? product.stock_quantity ?? 0}</td>
            <td>
                <span class="badge ${product.status === 'active' ? 'badge-success' : 'badge-warning'}">
                    ${product.status || 'active'}
                </span>
            </td>
            <td>
                <button class="btn btn-small btn-secondary" onclick="editProduct('${product.id}')">Sửa</button>
                <button class="btn btn-small btn-danger" onclick="deleteProduct('${product.id}')">Xóa</button>
            </td>
        </tr>
    `}).join('');

    addBadgeStyles();
}

function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (allOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Chưa có đơn hàng nào</td></tr>';
        return;
    }

    tbody.innerHTML = allOrders.map(order => `
        <tr>
            <td>${order.id?.substring(0, 8).toUpperCase() || 'N/A'}</td>
            <td>${escapeHtml(order.buyer_username || order.buyerUsername || order.buyer?.username || 'Không rõ')}</td>
            <td>${escapeHtml(order.product_name || order.productName || order.product?.name || 'Không rõ')}</td>
            <td>${formatVND(parseInt(order.total_amount || order.totalAmount || 0))}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(order.status)}">
                    ${order.status || 'unknown'}
                </span>
            </td>
            <td>
                ${order.status === 'paid' 
                    ? `<button class="btn btn-small btn-success" onclick="shipOrder('${order.id}')">Xác nhận giao hàng</button>`
                    : '-'}
            </td>
        </tr>
    `).join('');

    addBadgeStyles();
}

function renderEscrowTable() {
    const tbody = document.getElementById('escrowTableBody');
    if (!tbody) return;

    if (!allEscrow || allEscrow.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Chưa có bản ghi ký quỹ</td></tr>';
        return;
    }

    tbody.innerHTML = allEscrow.map(escrow => {
        const gross = parseFloat(escrow.amount || 0);
        const fee = parseFloat(escrow.platform_fee || escrow.fee || gross * 0.025);
        const net = parseFloat(escrow.net_amount || gross - fee);

        return `
        <tr>
            <td>${(escrow.order_id || '').substring(0, 8).toUpperCase() || 'N/A'}</td>
            <td>${formatVND(parseInt(gross))}</td>
            <td style="color:#ef4444;">-${formatVND(parseInt(fee))}</td>
            <td style="font-weight:600;color:#10b981;">${formatVND(parseInt(net))}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(escrow.status)}">
                    ${escrow.status || 'unknown'}
                </span>
            </td>
            <td>${escrow.released_at ? new Date(escrow.released_at).toLocaleDateString() : '-'}</td>
        </tr>
    `}).join('');

    addBadgeStyles();
}

function renderDisputesTable(tbody) {
    if (!allDisputes.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Chưa có khiếu nại nào với đơn hàng của bạn.</td></tr>';
        return;
    }
    tbody.innerHTML = allDisputes.map(d => `
        <tr>
            <td>${(d.id || '').substring(0, 8).toUpperCase()}</td>
            <td>${(d.order_id || '').substring(0, 8).toUpperCase()}</td>
            <td>${escapeHtml(d.complainant_username || d.buyer?.username || 'Người mua')}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(d.reason || d.issue || '')}">
                ${escapeHtml(d.reason || d.issue || '')}
            </td>
            <td><span class="badge ${getStatusBadgeClass(d.status)}">${d.status}</span></td>
            <td>
                ${d.status === 'pending' 
                    ? `<button class="btn btn-small btn-warning" onclick="submitEvidence('${d.id}')">Gửi bằng chứng</button>`
                    : '—'}
            </td>
        </tr>
    `).join('');
}

function renderSamplesTable(tbody) {
    if (!allSamples.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Chưa có yêu cầu hàng mẫu.</td></tr>';
        return;
    }
    tbody.innerHTML = allSamples.map(s => `
        <tr>
            <td>${(s.id || '').substring(0, 8).toUpperCase()}</td>
            <td>${escapeHtml(s.buyer_name || s.requestor?.username || 'Người mua')}</td>
            <td>${escapeHtml(s.product_name || s.product?.name || 'Sản phẩm')}</td>
            <td>${formatVND(parseInt(s.deposit_amount || 0))}</td>
            <td><span class="badge ${getStatusBadgeClass(s.status)}">${s.status}</span></td>
            <td>
                ${s.status === 'requested'
                    ? `<button class="btn btn-small btn-primary" onclick="handleSample('${s.id}', 'approved')">Duyệt</button>
                       <button class="btn btn-small btn-danger" onclick="handleSample('${s.id}', 'rejected')">Từ chối</button>`
                    : '—'}
            </td>
        </tr>
    `).join('');
}

function renderReviews() {
    const container = document.getElementById('reviewsContainer');
    if (!container) return;

    if (allReviews.length === 0) {
        container.innerHTML = '<p class="text-center" style="color:#64748b;">Chưa có đánh giá nào.</p>';
        return;
    }

    container.innerHTML = allReviews.map(review => `
        <div class="review-card">
            <div class="review-rating">${'⭐'.repeat(review.rating || 0)}</div>
            <div class="review-product">
                <strong>${escapeHtml(review.product_name || review.product?.name || 'Sản phẩm không xác định')}</strong>
                <small style="color:#64748b;"> — ${escapeHtml(review.buyer_username || 'Người mua')}</small>
            </div>
            <div class="review-comment">"${escapeHtml(review.body || review.title || 'Không có nội dung')}"</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:8px;margin-bottom:8px;">
                ${new Date(review.created_at).toLocaleDateString()}
            </div>
            <div class="review-actions">
                <button class="btn btn-small btn-secondary" onclick="showReplyRow('${review.id}')">Trả lời</button>
            </div>
            <div id="reply-row-${review.id}" class="reply-row" style="display:none; margin-top: 10px;">
                <input id="reply-input-${review.id}" class="reply-input" placeholder="Nhập phản hồi..." style="padding:5px; width:70%; margin-right:5px;" />
                <button class="btn btn-small btn-primary reply-send" onclick="sendReviewReply('${review.id}')">Gửi</button>
            </div>
        </div>
    `).join('');
}

function updateDashboardStats() {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    // Tổng đơn hàng
    const totalOrdersCount = allOrders.length;
    setEl('totalOrders', pageState.orders.totalPages > 1 ? totalOrdersCount + '+' : totalOrdersCount);

    // Tính toán doanh thu và ký quỹ từ Escrow (đã trừ phí sàn)
    const netReleased = allEscrow
        .filter(e => e.status === 'released')
        .reduce((sum, e) => sum + parseFloat(e.net_amount || (parseFloat(e.amount) * 0.975) || 0), 0);
        
    const netHeld = allEscrow
        .filter(e => e.status === 'held' || e.status === 'processing')
        .reduce((sum, e) => sum + parseFloat(e.net_amount || (parseFloat(e.amount) * 0.975) || 0), 0);

    setEl('totalRevenue', formatVND(parseInt(netReleased)));
    setEl('totalHeld', formatVND(parseInt(netHeld)));

    // Tính đánh giá trung bình
    const avgRating = allReviews.length > 0
        ? (allReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / allReviews.length).toFixed(1)
        : '0';
    setEl('avgRating', avgRating + ' ⭐');

    // Gom dữ liệu Trạng thái đơn hàng cho Biểu đồ tròn
    const statusCount = { 'pending': 0, 'paid': 0, 'shipped': 0, 'completed': 0, 'cancelled': 0 };
    allOrders.forEach(o => {
        if (statusCount[o.status] !== undefined) statusCount[o.status]++;
    });
    renderStatusChart(statusCount);

    // Hiển thị danh sách Đơn hàng chờ giao (Paid)
    renderUrgentOrders();
}


// ── THÊM MỚI: Helper Render Phân trang & Biểu đồ ──
function renderPagination(containerId, stateObj, loadFunc) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (stateObj.totalPages <= 1) { container.innerHTML = ''; return; }

    container.innerHTML = `
        <div style="display:flex; justify-content:center; align-items:center; gap:15px; padding:15px; margin-top:10px;">
            <button class="btn btn-small btn-secondary" ${stateObj.page <= 1 ? 'disabled' : ''} onclick="window.${loadFunc.name}(${stateObj.page - 1})">Trước</button>
            <span style="font-size:13px; font-weight:bold; color:#475569;">Trang ${stateObj.page} / ${stateObj.totalPages}</span>
            <button class="btn btn-small btn-secondary" ${stateObj.page >= stateObj.totalPages ? 'disabled' : ''} onclick="window.${loadFunc.name}(${stateObj.page + 1})">Sau</button>
        </div>
    `;
    if(!window[loadFunc.name]) window[loadFunc.name] = loadFunc;
}

function renderUrgentOrders() {
    const container = document.getElementById('urgentOrdersList');
    if (!container) return;

    // Lọc các đơn hàng có trạng thái "paid" (Đã thanh toán, chờ seller ship hàng)
    const urgentOrders = allOrders.filter(o => o.status === 'paid').slice(0, 5);

    if (urgentOrders.length === 0) {
        container.innerHTML = '<p style="color: #64748b; font-size: 14px; text-align: center; margin-top: 20px;">Tuyệt vời! Không có đơn hàng nào tồn đọng.</p>';
        return;
    }

    container.innerHTML = urgentOrders.map(o => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div>
                <strong style="font-size: 13px; color: #0f172a;">Mã: ${(o.id || '').substring(0,8).toUpperCase()}</strong>
                <p style="margin: 4px 0 0; font-size: 12px; color: #64748b; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(o.product_name)}">${escapeHtml(o.product_name || 'Sản phẩm')}</p>
            </div>
            <button class="btn btn-small btn-primary" onclick="shipOrder('${o.id}')" style="font-size: 11px;">Giao ngay</button>
        </div>
    `).join('');
}

// Gọi khi người dùng đổi Select Box (7 ngày / 30 ngày)
window.updateRevenueChartData = function() {
    renderRevenueChart(); 
};

function renderRevenueChart() {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;

    const daysToFilter = parseInt(document.getElementById('revenueFilter')?.value || '7', 10);
    
    // Tạo labels cho trục X
    const labels = Array.from({length: daysToFilter}, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - ((daysToFilter - 1) - i));
        return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    });

    const data = new Array(daysToFilter).fill(0);
    
    // Tính khoảng thời gian hợp lệ
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const pastDate = new Date();
    pastDate.setDate(now.getDate() - daysToFilter);

    // Đổ dữ liệu thật từ allOrders vào Chart
    allOrders.forEach(o => {
        const oDate = new Date(o.created_at || o.createdAt);
        if (oDate >= pastDate && oDate <= now && o.status !== 'cancelled' && o.status !== 'refunded') {
            const dateStr = oDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
            const index = labels.indexOf(dateStr);
            if (index > -1) {
                // Tính Gross Sales
                data[index] += parseFloat(o.total_amount || o.totalAmount || 0);
            }
        }
    });

    if (revenueChartInstance) revenueChartInstance.destroy();
    revenueChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Doanh thu (VNĐ)',
                data: data,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderWidth: 2,
                pointBackgroundColor: '#2563eb',
                fill: true,
                tension: 0.3 // Làm cong đường đồ thị
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (context) => formatVND(context.raw) }
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (value) => formatVND(value).replace(' Đ','') } }
            }
        }
    });
}

function renderStatusChart(statusCount) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('statusChart');
    if (!ctx) return;

    if (statusChartInstance) statusChartInstance.destroy();

    const dataValues = [
        statusCount['pending'] || 0,
        statusCount['paid'] || 0,
        statusCount['shipped'] || 0,
        statusCount['completed'] || 0,
        statusCount['cancelled'] || 0
    ];

    statusChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Chờ thanh toán', 'Chờ giao hàng (Paid)', 'Đang giao (Shipped)', 'Hoàn thành', 'Đã hủy'],
            datasets: [{
                data: dataValues,
                backgroundColor: ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}


// ============================================================
// Action Functions
// ============================================================

async function addProduct(e) {
    e.preventDefault();
    const name = document.getElementById('productName').value.trim();
    const description = document.getElementById('productDesc').value.trim();
    const price = document.getElementById('productPrice').value;
    const stock = document.getElementById('productStock').value;
    const category = document.getElementById('productCategory').value;
    const imageInput = document.getElementById('productImages');

    if (!name || !category || !price || stock < 0) {
        alert('Vui lòng điền đầy đủ các trường bắt buộc (Tên, Danh mục, Giá, Tồn kho).');
        return;
    }

    const fd = new FormData();
    fd.append('name', name);
    fd.append('description', description);
    fd.append('price', price);
    fd.append('stockQuantity', stock); 
    fd.append('category', category);

    if (imageInput.files && imageInput.files.length > 0) {
        Array.from(imageInput.files).slice(0, 5).forEach(file => {
            fd.append('images', file); 
        });
    }

    try {
        const submitBtn = document.querySelector('#productForm button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Đang lưu...'; }

        if (editingProductId) {
            await apiCall(`/products/${editingProductId}`, { method: 'PUT', body: fd });
            editingProductId = null;
            document.getElementById('productFormTitle').textContent = 'Thêm sản phẩm mới';
        } else {
            const createRes = await apiCall('/products', { method: 'POST', body: fd });
            const createdProductId = createRes?.data?.id;
            if (createdProductId) {
                await createCategoryVariants(createdProductId, name, parseInt(stock || '0', 10));
            }
        }

        alert('Lưu sản phẩm thành công!');
        closeProductForm();
        await loadProducts(pageState.products.page);
    } catch (error) {
        alert(`Lưu sản phẩm thất bại: ${error.message}`);
    } finally {
        const submitBtn = document.querySelector('#productForm button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Lưu sản phẩm'; }
    }
}

function parseCsvValues(rawValue) {
    return String(rawValue || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

async function createCategoryVariants(productId, productName, stockQty) {
    const category = document.getElementById('productCategory')?.value;
    const preset = CATEGORY_OPTION_PRESETS[category];
    if (!preset || !preset.length) return;

    const requests = [];
    preset.forEach((field, fieldIdx) => {
        const input = document.getElementById(`category_option_${field.key}`);
        if (!input) return;
        const values = parseCsvValues(input.value);

        values.forEach((val, idx) => {
            const skuBase = String(productName || 'SKU').replace(/\s+/g, '').toUpperCase().slice(0, 6) || 'SKU';
            const sku = `${skuBase}-${field.key.toUpperCase().slice(0, 3)}-${fieldIdx + 1}${idx + 1}`;
            requests.push(
                apiCall(`/variants/product/${productId}`, {
                    method: 'POST',
                    body: JSON.stringify({
                        attribute_name: field.key,
                        attribute_value: val,
                        sku,
                        stock_quantity: Math.max(0, stockQty || 0),
                        price_adjustment: 0
                    })
                })
            );
        });
    });

    if (!requests.length) return;

    const results = await Promise.allSettled(requests);
    const failedCount = results.filter(r => r.status === 'rejected').length;
    if (failedCount > 0) {
        alert(`Đã tạo sản phẩm, nhưng có ${failedCount} biến thể chưa lưu được.`);
    }
}

function renderCategoryOptionFields(category) {
    const container = document.getElementById('categoryOptionsContainer');
    const fields = document.getElementById('categoryOptionsFields');
    if (!container || !fields) return;

    const preset = CATEGORY_OPTION_PRESETS[category];
    if (!preset || !preset.length) {
        container.style.display = 'none';
        fields.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    fields.innerHTML = preset.map(item => `
        <div>
            <label>${item.label}</label>
            <input id="category_option_${item.key}" class="form-control" type="text" placeholder="Nhập giá trị, cách nhau bằng dấu phẩy">
        </div>
    `).join('');
}

async function deleteProduct(productId) {
    const ok = await showConfirm('Bạn có chắc muốn xóa sản phẩm này?');
    if (!ok) return;

    try {
        await apiCall(`/products/${productId}`, { method: 'DELETE' });
        alert('Đã xóa sản phẩm.');
        await loadProducts(pageState.products.page);
    } catch (error) {
        alert('Lỗi xóa sản phẩm: ' + error.message);
    }
}

function editProduct(productId) {
    const product = allProducts.find((p) => p.id === productId);
    if (!product) return alert('Không tìm thấy sản phẩm');

    editingProductId = productId;
    const titleEl = document.getElementById('productFormTitle');
    if(titleEl) titleEl.textContent = 'Chỉnh sửa sản phẩm';
    
    document.getElementById('productName').value = product.name || '';
    document.getElementById('productDesc').value = product.description || '';
    document.getElementById('productPrice').value = product.price || '';
    document.getElementById('productStock').value = product.stockQuantity ?? product.stock_quantity ?? 0;
    if (document.getElementById('productCategory')) document.getElementById('productCategory').value = product.category || 'default';
    renderCategoryOptionFields(product.category || '');
    
    document.getElementById('addProductForm').style.display = 'flex';
}

// ── ĐÃ CẬP NHẬT: Dùng Multi-Prompt để nhập Mã Vận Đơn ──
window.shipOrder = async function(orderId) {
    const result = await showMultiPrompt('Shipping Information', [
        { id: 'carrier', label: 'Đơn vị vận chuyển (VD: GHTK, GHN, VNPost)', type: 'text', required: true },
        { id: 'tracking', label: 'Mã vận đơn', type: 'text', required: true }
    ]);

    if (!result) return;

    try {
        await apiCall(`/orders/${orderId}/ship`, {
            method: 'POST',
            body: JSON.stringify({ trackingNumber: result.tracking, carrier: result.carrier }),
        });
        alert('Đã xác nhận giao hàng!');
        await loadOrders(pageState.orders.page);
    } catch (error) {
        alert(`Cập nhật đơn hàng thất bại: ${error.message}`);
    }
}

// ── THÊM MỚI: Nộp bằng chứng bảo vệ Dispute ──
window.submitEvidence = async function(disputeId) {
    const result = await showMultiPrompt('Gửi bằng chứng khiếu nại', [
        { id: 'url', label: 'Link ảnh/video bằng chứng (Drive, Imgur...)', type: 'url', required: true },
        { id: 'desc', label: 'Mô tả chi tiết', type: 'text', required: true }
    ]);

    if (!result) return;

    try {
        await apiCall(`/disputes/${disputeId}/evidence`, {
            method: 'POST',
            body: JSON.stringify({ evidenceUrl: result.url, description: result.desc })
        });
        alert('Đã gửi bằng chứng thành công. Đang chờ Admin xử lý.');
        await loadDisputes(pageState.disputes.page);
    } catch (error) {
        alert(`Gửi bằng chứng thất bại: ${error.message}`);
    }
}

// ── ĐÃ CẬP NHẬT: Gộp chung Approve & Reject ──
window.handleSample = async function(sampleId, status) {
    const actionName = status === 'approved' ? 'duyệt' : 'từ chối';
    const ok = await showConfirm(`Bạn có chắc muốn ${actionName} yêu cầu hàng mẫu này?`);
    if (!ok) return;

    try {
        await apiCall(`/samples/${sampleId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: status }),
        });
        alert(`Đã cập nhật yêu cầu hàng mẫu: ${status === 'approved' ? 'Duyệt' : 'Từ chối'}.`);
        await loadSamples(pageState.samples.page);
    } catch (error) {
        alert(`Cập nhật yêu cầu mẫu thất bại: ${error.message}`);
    }
}

// Reviews reply
function showReplyRow(reviewId) {
    const row = document.getElementById(`reply-row-${reviewId}`);
    if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
}

async function sendReviewReply(reviewId) {
    const input = document.getElementById(`reply-input-${reviewId}`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return alert('Vui lòng nhập nội dung phản hồi');
    try {
        await apiCall(`/reviews/${reviewId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ reply: text }),
        });
        input.value = '';
        showReplyRow(reviewId);
        await loadReviews(pageState.reviews.page);
        alert('Đã gửi phản hồi!');
    } catch (err) {
        alert('Lỗi gửi phản hồi: ' + err.message);
    }
}

// ============================================================
// Helper Functions & Modal Engines
// ============================================================

function getStatusBadgeClass(status) {
    const map = {
        pending   : 'badge-warning',
        processing: 'badge-info',
        paid      : 'badge-info',
        shipped   : 'badge-info',
        completed : 'badge-success',
        cancelled : 'badge-danger',
        held      : 'badge-warning',
        releasing : 'badge-info',
        released  : 'badge-success',
        disputed  : 'badge-danger',
        resolved_refunded : 'badge-danger',
        resolved_released : 'badge-success',
        rejected  : 'badge-secondary',
        requested : 'badge-warning',
        approved  : 'badge-success',
        active    : 'badge-success',
        inactive  : 'badge-warning',
    };
    return map[status] || 'badge-secondary';
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function addBadgeStyles() {
    if (!document.getElementById('badge-styles')) {
        const style = document.createElement('style');
        style.id = 'badge-styles';
        style.textContent = `
            .badge {
                display: inline-block;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .3px;
            }
            .badge-success { background-color: #d1fae5; color: #065f46; }
            .badge-warning { background-color: #fed7aa; color: #92400e; }
            .badge-danger { background-color: #fee2e2; color: #991b1b; }
            .badge-info { background-color: #dbeafe; color: #1e40af; }
            .badge-secondary { background-color: #e5e7eb; color: #374151; }
        `;
        document.head.appendChild(style);
    }
}

function closeProductForm() {
    document.getElementById('addProductForm').style.display = 'none';
    document.getElementById('productForm').reset();
    renderCategoryOptionFields('');
    editingProductId = null;
    const titleEl = document.getElementById('productFormTitle');
    if(titleEl) titleEl.textContent = 'Thêm sản phẩm mới';
}

function showConfirm(message) {
    return new Promise((resolve) => {
        let modal = document.getElementById('confirmModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'confirmModal';
            modal.className = 'confirm-modal';
            modal.innerHTML = `<div class="confirm-box" style="background:#fff; padding:20px; border-radius:8px; text-align:center;">
                <div id="confirmMessage" style="margin-bottom:20px; font-weight:bold;"></div>
                <div class="confirm-actions">
                    <button id="confirmNo" class="btn btn-secondary" style="margin-right:10px;">Không</button>
                    <button id="confirmYes" class="btn btn-primary">Đồng ý</button>
                </div>
            </div>`;
            modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999;";
            document.body.appendChild(modal);
        }

        modal.querySelector('#confirmMessage').textContent = message;
        modal.style.display = 'flex';

        const clean = () => {
            modal.style.display = 'none';
            modal.querySelector('#confirmYes').removeEventListener('click', onYes);
            modal.querySelector('#confirmNo').removeEventListener('click', onNo);
        };

        const onYes = () => { clean(); resolve(true); };
        const onNo = () => { clean(); resolve(false); };

        modal.querySelector('#confirmYes').addEventListener('click', onYes);
        modal.querySelector('#confirmNo').addEventListener('click', onNo);
    });
}

// ── THÊM MỚI: Multi-Prompt Modal ──
function showMultiPrompt(title, fields) {
    return new Promise((resolve) => {
        let modal = document.getElementById('dynamicMultiPrompt');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'dynamicMultiPrompt'; modal.className = 'confirm-modal';
            document.body.appendChild(modal);
        }

        let inputsHtml = fields.map(f => `
            <div style="margin-bottom:15px; text-align:left;">
                <label style="display:block; margin-bottom:5px; font-weight:600; font-size:13px; color:#475569;">${f.label}</label>
                <input type="${f.type}" id="prompt_input_${f.id}" class="form-control" placeholder="Nhập ${f.label.toLowerCase()}" style="width:100%; padding:8px; border-radius:6px; border:1px solid #cbd5e1;" ${f.required?'required':''}>
            </div>
        `).join('');

        modal.innerHTML = `
            <div style="background:#fff; width:400px; padding:25px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-bottom:20px; font-size:18px; color:#0f172a;">${title}</h3>
                ${inputsHtml}
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:25px;">
                    <button id="multiPromptCancel" class="btn btn-secondary">Hủy</button>
                    <button id="multiPromptOk" class="btn btn-primary">Xác nhận</button>
                </div>
            </div>
        `;
        modal.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.6); z-index:9999; display:flex; align-items:center; justify-content:center;";

        const okBtn = document.getElementById('multiPromptOk');
        const cancelBtn = document.getElementById('multiPromptCancel');

        const clean = () => { modal.style.display = 'none'; };
        
        okBtn.onclick = () => {
            let result = {};
            for(let f of fields) {
                const val = document.getElementById(`prompt_input_${f.id}`).value.trim();
                if(f.required && !val) return alert(`Trường bắt buộc: ${f.label}`);
                result[f.id] = val;
            }
            clean(); resolve(result);
        };
        cancelBtn.onclick = () => { clean(); resolve(null); };
    });
}

// ============================================================
// Navigation & Events
// ============================================================

function setupEventListeners() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach((item) => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.getAttribute('data-section');
            showSection(section, item);
        });
    });

    const addBtn = document.getElementById('addProductBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            document.getElementById('addProductForm').style.display = 'flex';
        });
    }

    const prodForm = document.getElementById('productForm');
    if (prodForm) prodForm.addEventListener('submit', addProduct);
    const categoryEl = document.getElementById('productCategory');
    if (categoryEl) {
        categoryEl.addEventListener('change', (e) => renderCategoryOptionFields(e.target.value));
    }

    const search = document.getElementById('productSearch');
    if (search) {
        let timeout = null;
        search.addEventListener('input', (e) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                const q = e.target.value.trim().toLowerCase();
                if (!q) return loadProducts(1);
                const filtered = allProducts.filter(p => (p.name||'').toLowerCase().includes(q));
                renderProductsTable(filtered);
            }, 300);
        });
    }

    const formOverlay = document.getElementById('addProductForm');
    if (formOverlay) {
        formOverlay.addEventListener('click', (e) => {
            if (e.target.id === 'addProductForm') {
                closeProductForm();
            }
        });
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try { 
                await apiCall('/auth/logout', { method: 'POST', body: JSON.stringify({ allDevices: false }) }); 
            } catch (e) {}
            localStorage.clear();
            window.location.href = '../login.html';
        });
    }

    const enableProfileEditBtn = document.getElementById('enableProfileEditBtn');
    if (enableProfileEditBtn) {
        enableProfileEditBtn.addEventListener('click', () => {
            profileEditMode = true;
            setProfileFieldsDisabled(false);
            enableProfileEditBtn.textContent = 'Đang soạn yêu cầu...';
            enableProfileEditBtn.disabled = true;
        });
    }

    const profileForm = document.getElementById('sellerProfileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!profileEditMode) return;
            try {
                await apiCall('/auth/profile-change-request', {
                    method: 'POST',
                    body: JSON.stringify({
                        fullName: document.getElementById('profileFullName')?.value?.trim(),
                        phone: document.getElementById('profilePhone')?.value?.trim(),
                        store_name: document.getElementById('profileStoreName')?.value?.trim(),
                        category: document.getElementById('profileCategory')?.value?.trim(),
                        city: document.getElementById('profileCity')?.value?.trim(),
                        address: document.getElementById('profileAddress')?.value?.trim(),
                    })
                });
                alert('Đã gửi yêu cầu thay đổi hồ sơ. Chờ Admin duyệt.');
                profileEditMode = false;
                setProfileFieldsDisabled(true);
                if (enableProfileEditBtn) {
                    enableProfileEditBtn.textContent = 'Tạo yêu cầu thay đổi';
                    enableProfileEditBtn.disabled = false;
                }
                await loadProfileData();
            } catch (err) {
                alert(`Gửi yêu cầu thất bại: ${err.message}`);
            }
        });
    }

    const adBtn = document.getElementById('buyAdPackageBtn');
    if (adBtn) {
        adBtn.addEventListener('click', () => {
            alert('Demo: Gói quảng cáo sẽ được mở ở phiên bản tiếp theo (Standard/Pro/Premium).');
        });
    }

    setProfileFieldsDisabled(true);
}

function showSection(sectionName, menuItem) {
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    menuItem.classList.add('active');

    document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
    const section = document.getElementById(`${sectionName}-section`);
    if (section) section.classList.add('active');

    const titles = {
        dashboard: 'Tổng quan',
        products: 'Sản phẩm',
        orders: 'Đơn hàng',
        escrow: 'Theo dõi ký quỹ',
        disputes: 'Khiếu nại',
        samples: 'Yêu cầu hàng mẫu',
        reviews: 'Đánh giá',
        profile: 'Hồ sơ & Bảo mật',
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = titles[sectionName] || 'Dashboard';
}

// ============================================================
// Logic MFA (Đã đồng bộ từ Buyer)
// ============================================================
window.setupMFA = async function() {
    try {
        const result = await apiCall('/mfa/setup', { method: 'POST' });
        if (result.success || result.data) {
            const data = result.data || result;
            const modalBody = document.getElementById('mfaModalBody');
            modalBody.innerHTML = `
                <div style="text-align:center">
                    <p>Quét mã QR dưới đây bằng app Authenticator:</p>
                    <img src="${data.qrCode}" style="margin:20px 0; border:1px solid #e2e8f0; border-radius: 8px;">
                    <div class="form-group">
                        <input type="text" id="mfaCode" class="form-control" placeholder="Nhập mã 6 số" maxlength="6" style="text-align:center; font-size:20px; letter-spacing: 4px;">
                    </div>
                    <button onclick="verifyMFA()" class="btn btn-primary" style="width:100%; margin-top: 15px;">Xác nhận kích hoạt</button>
                </div>
            `;
            document.getElementById('mfaModal').style.display = 'flex';
        }
    } catch (err) { alert("Lỗi thiết lập MFA: " + err.message); }
}

window.verifyMFA = async function() {
    const code = document.getElementById('mfaCode').value;
    try {
        await apiCall('/mfa/confirm', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
        alert("Đã kích hoạt MFA thành công!");
        location.reload();
    } catch (err) { alert("Mã xác nhận không đúng: " + err.message); }
}

window.confirmDisableMFA = function() {
    document.getElementById('disableMfaForm').reset();
    const btn = document.getElementById('finalDisableMfaBtn');
    btn.disabled = false;
    btn.textContent = 'Xác nhận Tắt';
    document.getElementById('disableMfaModal').style.display = 'flex';
}

window.closeMFAModal = function() { document.getElementById('mfaModal').style.display = 'none'; }
window.closeDisableMfaModal = function() { document.getElementById('disableMfaModal').style.display = 'none'; }

window.handleFinalDisableMFA = async function(event) {
    event.preventDefault();
    const password = document.getElementById('disableMfaPassword').value;
    const code = document.getElementById('disableMfaCode').value;

    if (!password || !code) return alert("Vui lòng nhập đầy đủ thông tin!");

    const btn = document.getElementById('finalDisableMfaBtn');
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';

    try {
        await apiCall('/mfa/disable', {
            method: 'POST',
            body: JSON.stringify({ password, code })
        });
        alert("Đã tắt bảo mật 2 yếu tố (MFA) thành công!");
        closeDisableMfaModal();
        location.reload();
    } catch (err) {
        alert("Sai mật khẩu hoặc mã Authenticator!");
        btn.disabled = false;
        btn.textContent = 'Xác nhận Tắt';
    }
}

// ============================================================
// Logic Xuất CSV
// ============================================================
window.exportDataToCSV = function() {
    if (!allOrders || allOrders.length === 0) {
        return alert("Chưa có dữ liệu đơn hàng để xuất!");
    }

    // Tạo Header
    let csvContent = "Mã Đơn,Người Mua,Sản phẩm,Tổng tiền,Trạng thái,Ngày tạo\n";

    // Đổ dữ liệu
    allOrders.forEach(o => {
        const orderId = o.id || '';
        const buyer = escapeHtml(o.buyer_username || o.buyerUsername || o.buyer?.username || '');
        const product = escapeHtml(o.product_name || o.productName || o.product?.name || '');
        const amount = o.total_amount || o.totalAmount || 0;
        const status = o.status || '';
        const date = o.created_at ? new Date(o.created_at).toLocaleString('vi-VN') : '';

        // Xử lý chuỗi có dấu phẩy để không bị vỡ cột CSV
        const safeBuyer = `"${buyer.replace(/"/g, '""')}"`;
        const safeProduct = `"${product.replace(/"/g, '""')}"`;

        csvContent += `${orderId},${safeBuyer},${safeProduct},${amount},${status},"${date}"\n`;
    });

    // Tạo blob và tải xuống
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Bao_Cao_Don_Hang_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ============================================================
// Initialize on page load
// ============================================================

document.addEventListener('DOMContentLoaded', initializeDashboard);