// ============================================================
// O'Future Buyer - Order Detail Management
// URL Handling, Real-time Fetch, Progress & Actions
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentUser = null;
let currentOrderId = null;

// ── 1. Khởi tạo & Phân quyền & Giỏ hàng ──────────────────────────────
function checkAuth() {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    if (!token || !userStr) { window.location.href = '../../login.html'; return false; }

    currentUser = JSON.parse(userStr);
    if (currentUser.role !== 'buyer') { window.location.href = '../../login.html'; return false; }

    document.getElementById('headerAvatar').textContent = currentUser.fullName.charAt(0).toUpperCase();
    updateCartBadge();
    return true;
}

function updateCartBadge() {
    const cartKey = `cart_${currentUser.id}`;
    const cartData = JSON.parse(localStorage.getItem(cartKey)) || [];
    const totalItems = cartData.length;
    const badge = document.getElementById('cartBadge');
    if (badge) {
        badge.textContent = totalItems;
        badge.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.1);`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ── 2. Lấy dữ liệu API & Render Chi tiết ───────────────
async function fetchOrderDetail() {
    const urlParams = new URLSearchParams(window.location.search);
    currentOrderId = urlParams.get('id');
    
    if (!currentOrderId) {
        showToast("Mã đơn hàng không hợp lệ!", true);
        setTimeout(() => window.location.href = '../buyer-orders/index.html', 1500);
        return;
    }

    document.getElementById('orderIdHeader').textContent = `#${currentOrderId}`;
    const timelineContainer = document.getElementById('orderTimeline');
    const itemsContainer = document.getElementById('orderItems');
    const itemsSummaryContainer = document.getElementById('orderItemsSummary');
    const actionsContainer = document.getElementById('orderActions');

    try {
        const response = await fetch(`${API_BASE_URL}/orders/${currentOrderId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        const data = await response.json();

        if (response.ok && data.success) {
            const order = data.data;
            
            // Header Info & Status
            document.getElementById('orderDateHeader').textContent = new Date(order.created_at).toLocaleString('vi-VN');
            const statusBadge = document.getElementById('orderStatusBadge');
            statusBadge.textContent = getStatusText(order.status);
            statusBadge.className = `status-badge ${order.status}`;
            
            // Progress Timeline
            renderProgressTimeline(order, timelineContainer);
            
            // Order Items
            renderOrderItems(order, itemsContainer);
            renderOrderItemsSummary(order, itemsSummaryContainer);

            // Shipping Address
            document.getElementById('shippingStreet').textContent = order.shipping_address?.street || 'N/A';
            document.getElementById('shippingCityZip').textContent = `${order.shipping_address?.city || 'N/A'}, ${order.shipping_address?.zip || ''}`;
            document.getElementById('shippingCountry').textContent = order.shipping_address?.country || 'Việt Nam';

            // Order Summary
            const subtotal = order.total_amount;
            const platformFee = subtotal * 0.025;
            const shippingFee = order.shipping_fee || 30000;
            const total = subtotal + platformFee + shippingFee;

            document.getElementById('subtotalPrice').textContent = subtotal.toLocaleString('vi-VN') + ' đ';
            document.getElementById('platformFee').textContent = platformFee.toLocaleString('vi-VN') + ' đ';
            document.getElementById('shippingFee').textContent = shippingFee.toLocaleString('vi-VN') + ' đ';
            document.getElementById('totalPrice').textContent = total.toLocaleString('vi-VN') + ' đ';
            
            // Escrow Status
            const escrowBadge = document.getElementById('escrowStatus');
            escrowBadge.textContent = getEscrowText(order.escrow_status);
            escrowBadge.className = `status-badge ${order.escrow_status}`;

            // Contextual Actions
            renderActionButtons(order, actionsContainer);

        } else {
            throw new Error(data.message || "Không thể tải dữ liệu đơn hàng.");
        }
    } catch (error) {
        timelineContainer.innerHTML = `<p style="color:red">Lỗi tải dữ liệu.</p>`;
        itemsContainer.innerHTML = `<p style="color:red">Lỗi tải dữ liệu.</p>`;
        showToast(error.message, true);
    }
}

function getStatusText(status) {
    const map = { 'pending': 'Chờ thanh toán', 'paid': 'Đã thanh toán', 'shipped': 'Đang giao hàng', 'completed': 'Hoàn thành', 'cancelled': 'Đã hủy', 'refunded': 'Đã hoàn tiền' };
    return map[status] || status;
}

function getEscrowText(status) {
    const map = { 'held': 'Hệ thống tạm giữ', 'released': 'Đã giải ngân cho Seller', 'returned': 'Đã hoàn trả cho Buyer' };
    return map[status] || 'N/A';
}


function renderProgressTimeline(order, container) {
    // Giả lập tiến trình (Backend nên trả về mảng history nếu có)
    const stages = [
        { status: 'pending', title: 'Đã tạo đơn', date: order.created_at },
        { status: 'paid', title: 'Đã thanh toán', date: order.paid_at },
        { status: 'shipped', title: 'Đang giao hàng', date: order.shipped_at },
        { status: 'completed', title: 'Hoàn thành', date: order.completed_at }
    ];

    const currentStageIndex = stages.findIndex(s => s.status === order.status);
    
    // Nếu đơn hàng bị hủy, chèn trạng thái hủy vào timeline
    if (order.status === 'cancelled' || order.status === 'refunded') {
        stages.push({ status: order.status, title: order.status === 'cancelled' ? 'Đã hủy' : 'Đã hoàn tiền', date: order.updated_at });
    }

    container.innerHTML = stages.map((stage, index) => {
        const isActive = index <= currentStageIndex || stage.status === order.status;
        const stageDate = stage.date ? new Date(stage.date).toLocaleString('vi-VN') : (stage.status === 'pending' ? new Date(order.created_at).toLocaleString('vi-VN') : '');

        return `
            <div class="timeline-item">
                <div class="timeline-dot ${isActive ? 'active' : ''}"></div>
                ${index < stages.length - 1 ? `<div class="timeline-line ${isActive && (index < currentStageIndex || order.status === stages[index+1].status) ? 'active' : ''}"></div>` : ''}
                <div class="timeline-content ${isActive ? 'active' : ''}">
                    <span class="timeline-title">${stage.title}</span>
                    ${stageDate ? `<span class="timeline-date">${stageDate}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function renderOrderItems(order, container) {
    // API chi tiết thường chỉ trả về 1 productId do validate tách đơn
    // Nếu Backend trả về mảng products chi tiết thì render lặp, hiện tại render 1
    container.innerHTML = `
        <div class="summary-item" style="padding: 10px; border-bottom: 1px solid #f1f5f9;">
            <div style="display: flex; gap: 10px; align-items: center;">
                <img src="${order.product_image || '../../images/image.png'}" alt="${order.product_id}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0;">
                <div>
                    <span class="summary-item-name" style="max-width: none; font-size: 15px;">ID SP: ${order.product_id}</span>
                    <p class="muted" style="margin: 2px 0; font-size: 13px;">Cung cấp bởi: Seller ID ${order.seller_id || 'Ẩn danh'}</p>
                </div>
            </div>
            <div style="text-align: right;">
                <strong style="font-size: 16px;">${order.price.toLocaleString('vi-VN')} đ</strong>
                <p class="muted" style="margin: 2px 0; font-size: 13px;">Số lượng: ${order.quantity}</p>
            </div>
        </div>
    `;
}

function renderOrderItemsSummary(order, container) {
     container.innerHTML = `
        <div class="summary-item">
            <span class="summary-item-name">${order.quantity}x ID SP: ${order.product_id}</span>
            <strong>${order.total_amount.toLocaleString('vi-VN')} đ</strong>
        </div>
    `;
}

// Render Nút bấm thông minh theo trạng thái
function renderActionButtons(order, container) {
    let btns = '';
    
    if (order.status === 'shipped') {
        btns += `<button class="btn btn-primary" style="width: 100%;" onclick="confirmDelivery('${order.id}')">✅ Đã nhận được hàng (Giải ngân)</button>`;
        btns += `<button class="btn btn-outline" style="color: #ef4444; border-color: #ef4444; width: 100%;" onclick="window.location.href='../buyer-orders/index.html?idForDispute=${order.id}'">⚠️ Hàng lỗi / Khiếu nại</button>`;
    } 
    else if (order.status === 'completed') {
        btns += `<button class="btn btn-outline" style="width: 100%;" onclick="window.location.href='../buyer-reviews/index.html?orderId=${order.id}'">⭐ Đánh giá sản phẩm</button>`;
    }
    else if (order.status === 'pending') {
        // Có thể thêm nút "Hủy đơn hàng" nếu thời gian chưa quá lâu
        // btns += `<button class="btn btn-outline" style="color:#ef4444" onclick="cancelOrder('${order.id}')">Xóa đơn hàng</button>`;
    }
    
    container.innerHTML = btns;
}

// ── 3. API Actions (Giải ngân) ────────────────
window.confirmDelivery = async function(orderId) {
    if (!confirm("Xác nhận bạn đã nhận đủ hàng và hàng đúng mô tả? Hệ thống sẽ giải ngân Ký quỹ cho người bán ngay lập tức.")) return;

    const actionBtn = document.querySelector('#orderActions button');
    if (actionBtn) { actionBtn.disabled = true; actionBtn.textContent = 'Đang giải ngân...'; }

    try {
        const response = await fetch(`${API_BASE_URL}/escrow/release`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({ orderId })
        });
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast("Đã giải ngân tiền thành công cho người bán!");
            fetchOrderDetail(); // Refresh page data
        } else {
            throw new Error(data.message || "Lỗi xử lý giải ngân.");
        }
    } catch (error) {
        showToast(error.message, true);
        if (actionBtn) { actionBtn.disabled = false; actionBtn.textContent = '✅ Đã nhận được hàng (Giải ngân)'; }
    }
}


// ── 4. Khởi chạy & Logout ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        fetchOrderDetail();
    }
    
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
            window.location.href = '../../login.html';
        });
    }
});