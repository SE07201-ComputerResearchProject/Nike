// ============================================================
// O'Future Seller Dashboard - JavaScript (ENTERPRISE EDITION)
// Đã tích hợp Logic Backend, Phân trang, Modal Động & Chart.js
// ============================================================

const API_BASE_URL = 'http://localhost:5000/api';

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
            alert('Only sellers can access this dashboard');
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
        alert('Error loading dashboard. Please login again.');
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
        
        updateDashboardStats();
        renderRevenueChart(); // Vẽ biểu đồ sau khi load xong
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
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
        document.getElementById('productsTableBody').innerHTML = `<tr><td colspan="5" class="text-center" style="color:red;">Error loading products: ${error.message}</td></tr>`;
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
        document.getElementById('ordersTableBody').innerHTML = `<tr><td colspan="6" class="text-center" style="color:red;">Error loading orders: ${error.message}</td></tr>`;
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
        document.getElementById('escrowTableBody').innerHTML = `<tr><td colspan="6" class="text-center" style="color:red;">Error loading escrow: ${error.message}</td></tr>`;
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
        document.getElementById('reviewsContainer').innerHTML = `<p class="text-center" style="color:red;">Error loading reviews: ${error.message}</p>`;
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
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:red;">Error loading disputes: ${err.message}</td></tr>`;
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
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:red;">Error loading samples: ${err.message}</td></tr>`;
    }
}

// ============================================================
// Rendering Functions
// ============================================================

function renderProductsTable(products = allProducts) {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    if (!products || products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No products found. Click "Add New Product" to start.</td></tr>';
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
                        // Kênh người bán mặc định dùng backend 5000
                        const backendBaseUrl = API_BASE_URL.replace('/api', ''); 
                        imgUrl = `${backendBaseUrl}${rawUrl}`;
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
                <small style="color:#64748b;">${escapeHtml(product.category || 'General')}</small>
            </td>
            <td>${parseInt(product.price || 0).toLocaleString('vi-VN')} đ</td>
            <td>${product.stockQuantity ?? product.stock_quantity ?? 0}</td>
            <td>
                <span class="badge ${product.status === 'active' ? 'badge-success' : 'badge-warning'}">
                    ${product.status || 'active'}
                </span>
            </td>
            <td>
                <button class="btn btn-small btn-secondary" onclick="editProduct('${product.id}')">Edit</button>
                <button class="btn btn-small btn-danger" onclick="deleteProduct('${product.id}')">Delete</button>
            </td>
        </tr>
    `}).join('');

    addBadgeStyles();
}

function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (allOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No orders found</td></tr>';
        return;
    }

    tbody.innerHTML = allOrders.map(order => `
        <tr>
            <td>${order.id?.substring(0, 8).toUpperCase() || 'N/A'}</td>
            <td>${escapeHtml(order.buyer_username || order.buyerUsername || order.buyer?.username || 'Unknown')}</td>
            <td>${escapeHtml(order.product_name || order.productName || order.product?.name || 'Unknown')}</td>
            <td>${parseInt(order.total_amount || order.totalAmount || 0).toLocaleString('vi-VN')} đ</td>
            <td>
                <span class="badge ${getStatusBadgeClass(order.status)}">
                    ${order.status || 'unknown'}
                </span>
            </td>
            <td>
                ${order.status === 'paid' 
                    ? `<button class="btn btn-small btn-success" onclick="shipOrder('${order.id}')">Confirm Shipping</button>` 
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
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No escrow records found</td></tr>';
        return;
    }

    tbody.innerHTML = allEscrow.map(escrow => {
        const gross = parseFloat(escrow.amount || 0);
        const fee = parseFloat(escrow.platform_fee || escrow.fee || gross * 0.10);
        const net = parseFloat(escrow.net_amount || gross - fee);

        return `
        <tr>
            <td>${(escrow.order_id || '').substring(0, 8).toUpperCase() || 'N/A'}</td>
            <td>${parseInt(gross).toLocaleString('vi-VN')} đ</td>
            <td style="color:#ef4444;">-${parseInt(fee).toLocaleString('vi-VN')} đ</td>
            <td style="font-weight:600;color:#10b981;">${parseInt(net).toLocaleString('vi-VN')} đ</td>
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
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No disputes filed against your orders.</td></tr>';
        return;
    }
    tbody.innerHTML = allDisputes.map(d => `
        <tr>
            <td>${(d.id || '').substring(0, 8).toUpperCase()}</td>
            <td>${(d.order_id || '').substring(0, 8).toUpperCase()}</td>
            <td>${escapeHtml(d.complainant_username || d.buyer?.username || 'Buyer')}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(d.reason || d.issue || '')}">
                ${escapeHtml(d.reason || d.issue || '')}
            </td>
            <td><span class="badge ${getStatusBadgeClass(d.status)}">${d.status}</span></td>
            <td>
                ${d.status === 'pending' 
                    ? `<button class="btn btn-small btn-warning" onclick="submitEvidence('${d.id}')">Submit Evidence</button>` 
                    : '—'}
            </td>
        </tr>
    `).join('');
}

function renderSamplesTable(tbody) {
    if (!allSamples.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No sample requests yet.</td></tr>';
        return;
    }
    tbody.innerHTML = allSamples.map(s => `
        <tr>
            <td>${(s.id || '').substring(0, 8).toUpperCase()}</td>
            <td>${escapeHtml(s.buyer_name || s.requestor?.username || 'Buyer')}</td>
            <td>${escapeHtml(s.product_name || s.product?.name || 'Product')}</td>
            <td>${parseInt(s.deposit_amount || 0).toLocaleString('vi-VN')} đ</td>
            <td><span class="badge ${getStatusBadgeClass(s.status)}">${s.status}</span></td>
            <td>
                ${s.status === 'requested'
                    ? `<button class="btn btn-small btn-primary" onclick="handleSample('${s.id}', 'approved')">Approve</button>
                       <button class="btn btn-small btn-danger" onclick="handleSample('${s.id}', 'rejected')">Reject</button>`
                    : '—'}
            </td>
        </tr>
    `).join('');
}

function renderReviews() {
    const container = document.getElementById('reviewsContainer');
    if (!container) return;

    if (allReviews.length === 0) {
        container.innerHTML = '<p class="text-center" style="color:#64748b;">No reviews yet.</p>';
        return;
    }

    container.innerHTML = allReviews.map(review => `
        <div class="review-card">
            <div class="review-rating">${'⭐'.repeat(review.rating || 0)}</div>
            <div class="review-product">
                <strong>${escapeHtml(review.product_name || review.product?.name || 'Unknown Product')}</strong>
                <small style="color:#64748b;"> — ${escapeHtml(review.buyer_username || 'Buyer')}</small>
            </div>
            <div class="review-comment">"${escapeHtml(review.body || review.title || 'No comment')}"</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:8px;margin-bottom:8px;">
                ${new Date(review.created_at).toLocaleDateString()}
            </div>
            <div class="review-actions">
                <button class="btn btn-small btn-secondary" onclick="showReplyRow('${review.id}')">Reply</button>
            </div>
            <div id="reply-row-${review.id}" class="reply-row" style="display:none; margin-top: 10px;">
                <input id="reply-input-${review.id}" class="reply-input" placeholder="Write a reply..." style="padding:5px; width:70%; margin-right:5px;" />
                <button class="btn btn-small btn-primary reply-send" onclick="sendReviewReply('${review.id}')">Send</button>
            </div>
        </div>
    `).join('');
}

function updateDashboardStats() {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setEl('totalProducts', pageState.products.totalPages > 1 ? allProducts.length + '+' : allProducts.length);
    setEl('totalOrders', pageState.orders.totalPages > 1 ? allOrders.length + '+' : allOrders.length);

    const netHeld = allEscrow
        .filter(e => e.status === 'held' || e.status === 'processing')
        .reduce((sum, e) => sum + parseFloat(e.net_amount || (parseFloat(e.amount) * 0.9) || 0), 0);
        
    const netReleased = allEscrow
        .filter(e => e.status === 'released')
        .reduce((sum, e) => sum + parseFloat(e.net_amount || (parseFloat(e.amount) * 0.9) || 0), 0);

    setEl('totalEscrow', `${parseInt(netHeld).toLocaleString('vi-VN')} đ`);
    setEl('totalHeld', `${parseInt(netHeld).toLocaleString('vi-VN')} đ`);
    setEl('totalReleased', `${parseInt(netReleased).toLocaleString('vi-VN')} đ`);

    const avgRating = allReviews.length > 0
        ? (allReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / allReviews.length).toFixed(1)
        : '0';
    setEl('avgRating', avgRating + (allReviews.length ? ' ⭐' : ''));
}


// ── THÊM MỚI: Helper Render Phân trang & Biểu đồ ──
function renderPagination(containerId, stateObj, loadFunc) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (stateObj.totalPages <= 1) { container.innerHTML = ''; return; }

    container.innerHTML = `
        <div style="display:flex; justify-content:center; align-items:center; gap:15px; padding:15px; margin-top:10px;">
            <button class="btn btn-small btn-secondary" ${stateObj.page <= 1 ? 'disabled' : ''} onclick="window.${loadFunc.name}(${stateObj.page - 1})">Prev</button>
            <span style="font-size:13px; font-weight:bold; color:#475569;">Page ${stateObj.page} / ${stateObj.totalPages}</span>
            <button class="btn btn-small btn-secondary" ${stateObj.page >= stateObj.totalPages ? 'disabled' : ''} onclick="window.${loadFunc.name}(${stateObj.page + 1})">Next</button>
        </div>
    `;
    if(!window[loadFunc.name]) window[loadFunc.name] = loadFunc;
}

function renderRevenueChart() {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;

    // Tính toán giả lập từ danh sách đơn hàng trang hiện tại
    const last7Days = Array.from({length: 7}, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        return d.toLocaleDateString('vi-VN');
    });

    const data = [0, 0, 0, 0, 0, 0, 0];
    allOrders.forEach(o => {
        const oDate = new Date(o.created_at || o.createdAt).toLocaleDateString('vi-VN');
        const index = last7Days.indexOf(oDate);
        if (index > -1 && o.status !== 'cancelled' && o.status !== 'refunded') {
            data[index] += parseFloat(o.total_amount || o.totalAmount || 0);
        }
    });

    if (revenueChartInstance) revenueChartInstance.destroy();
    revenueChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: last7Days,
            datasets: [{
                label: 'Doanh thu (VNĐ)',
                data: data,
                backgroundColor: '#2563eb',
                borderRadius: 4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
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
        alert('Please fill in all required fields (Name, Category, Price, Stock).');
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
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

        if (editingProductId) {
            await apiCall(`/products/${editingProductId}`, { method: 'PUT', body: fd });
            editingProductId = null;
            document.getElementById('productFormTitle').textContent = 'Add New Product';
        } else {
            await apiCall('/products', { method: 'POST', body: fd });
        }

        alert('Product saved successfully!');
        closeProductForm();
        await loadProducts(pageState.products.page);
    } catch (error) {
        alert(`Failed to save product: ${error.message}`);
    } finally {
        const submitBtn = document.querySelector('#productForm button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Product'; }
    }
}

async function deleteProduct(productId) {
    const ok = await showConfirm('Are you sure you want to delete this product?');
    if (!ok) return;

    try {
        await apiCall(`/products/${productId}`, { method: 'DELETE' });
        alert('Product deleted.');
        await loadProducts(pageState.products.page);
    } catch (error) {
        alert('Error deleting product: ' + error.message);
    }
}

function editProduct(productId) {
    const product = allProducts.find((p) => p.id === productId);
    if (!product) return alert('Product not found');

    editingProductId = productId;
    const titleEl = document.getElementById('productFormTitle');
    if(titleEl) titleEl.textContent = 'Edit Product';
    
    document.getElementById('productName').value = product.name || '';
    document.getElementById('productDesc').value = product.description || '';
    document.getElementById('productPrice').value = product.price || '';
    document.getElementById('productStock').value = product.stockQuantity ?? product.stock_quantity ?? 0;
    if (document.getElementById('productCategory')) document.getElementById('productCategory').value = product.category || 'default';
    
    document.getElementById('addProductForm').style.display = 'flex';
}

// ── ĐÃ CẬP NHẬT: Dùng Multi-Prompt để nhập Mã Vận Đơn ──
window.shipOrder = async function(orderId) {
    const result = await showMultiPrompt('Shipping Information', [
        { id: 'carrier', label: 'Carrier (e.g. UPS, FedEx, VNPost)', type: 'text', required: true },
        { id: 'tracking', label: 'Tracking Number', type: 'text', required: true }
    ]);

    if (!result) return;

    try {
        await apiCall(`/orders/${orderId}/ship`, {
            method: 'POST',
            body: JSON.stringify({ trackingNumber: result.tracking, carrier: result.carrier }),
        });
        alert('Order marked as shipped!');
        await loadOrders(pageState.orders.page);
    } catch (error) {
        alert(`Failed to update order: ${error.message}`);
    }
}

// ── THÊM MỚI: Nộp bằng chứng bảo vệ Dispute ──
window.submitEvidence = async function(disputeId) {
    const result = await showMultiPrompt('Submit Evidence for Dispute', [
        { id: 'url', label: 'Image/Video URL (Google Drive, Imgur...)', type: 'url', required: true },
        { id: 'desc', label: 'Detailed Explanation', type: 'text', required: true }
    ]);

    if (!result) return;

    try {
        await apiCall(`/disputes/${disputeId}/evidence`, {
            method: 'POST',
            body: JSON.stringify({ evidenceUrl: result.url, description: result.desc })
        });
        alert('Evidence submitted successfully. Pending Admin review.');
        await loadDisputes(pageState.disputes.page);
    } catch (error) {
        alert(`Failed to submit evidence: ${error.message}`);
    }
}

// ── ĐÃ CẬP NHẬT: Gộp chung Approve & Reject ──
window.handleSample = async function(sampleId, status) {
    const actionName = status === 'approved' ? 'Approve' : 'Reject';
    const ok = await showConfirm(`Are you sure you want to ${actionName} this sample request?`);
    if (!ok) return;

    try {
        await apiCall(`/samples/${sampleId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: status }),
        });
        alert(`Sample request ${status}!`);
        await loadSamples(pageState.samples.page);
    } catch (error) {
        alert(`Failed to update sample: ${error.message}`);
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
    if (!text) return alert('Please enter a reply');
    try {
        await apiCall(`/reviews/${reviewId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ reply: text }),
        });
        input.value = '';
        showReplyRow(reviewId);
        await loadReviews(pageState.reviews.page);
        alert('Reply sent!');
    } catch (err) {
        alert('Error sending reply: ' + err.message);
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
    editingProductId = null;
    const titleEl = document.getElementById('productFormTitle');
    if(titleEl) titleEl.textContent = 'Add New Product';
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
                    <button id="confirmNo" class="btn btn-secondary" style="margin-right:10px;">No</button>
                    <button id="confirmYes" class="btn btn-primary">Yes</button>
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
                <input type="${f.type}" id="prompt_input_${f.id}" class="form-control" placeholder="Enter ${f.label.toLowerCase()}" style="width:100%; padding:8px; border-radius:6px; border:1px solid #cbd5e1;" ${f.required?'required':''}>
            </div>
        `).join('');

        modal.innerHTML = `
            <div style="background:#fff; width:400px; padding:25px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-bottom:20px; font-size:18px; color:#0f172a;">${title}</h3>
                ${inputsHtml}
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:25px;">
                    <button id="multiPromptCancel" class="btn btn-secondary">Cancel</button>
                    <button id="multiPromptOk" class="btn btn-primary">Confirm</button>
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
                if(f.required && !val) return alert(`Required field: ${f.label}`);
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
}

function showSection(sectionName, menuItem) {
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    menuItem.classList.add('active');

    document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
    const section = document.getElementById(`${sectionName}-section`);
    if (section) section.classList.add('active');

    const titles = {
        dashboard: 'Dashboard',
        products: 'Products',
        orders: 'Orders',
        escrow: 'Escrow Tracking',
        disputes: 'Disputes',
        samples: 'Sample Requests',
        reviews: 'Reviews',
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = titles[sectionName] || 'Dashboard';
}

// ============================================================
// Initialize on page load
// ============================================================

document.addEventListener('DOMContentLoaded', initializeDashboard);