// ============================================================
// O'Future Buyer - Order Management
// Real-time Fetch, Status Filtering & Escrow Actions
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentUser = null;
let allOrders = [];
let currentStatus = 'all';
let currentOrderIdForDispute = null;

// ── 1. Khởi tạo & Phân quyền ──────────────────────────────
function checkAuth() {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    if (!token || !userStr) { window.location.href = '../../login.html'; return false; }

    currentUser = JSON.parse(userStr);
    if (currentUser.role !== 'buyer') { window.location.href = '../../login.html'; return false; }

    const nameToUse = currentUser.fullName || currentUser.full_name || currentUser.username || 'U';
    document.getElementById('userAvatar').textContent = nameToUse.charAt(0).toUpperCase();
    return true;
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.1);`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ── 2. Lấy dữ liệu API (Phân biệt Sỉ & Mẫu) ───────────────
async function fetchOrders() {
    const type = document.getElementById('orderTypeSelect').value;
    const endpoint = type === 'orders' ? '/orders/my' : '/samples/my';
    
    document.getElementById('ordersContainer').innerHTML = '<p class="muted">Đang tải dữ liệu...</p>';

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        const data = await response.json();

        if (response.ok && data.success) {
            allOrders = data.data; // Lưu mảng gốc
            renderOrders();
        } else {
            throw new Error(data.message || "Không thể tải dữ liệu");
        }
    } catch (error) {
        document.getElementById('ordersContainer').innerHTML = `<p style="color:red">Lỗi tải dữ liệu: ${error.message}</p>`;
    }
}

// ── 3. Lọc & Render Đơn hàng ──────────────────────────────
function renderOrders() {
    const container = document.getElementById('ordersContainer');
    
    // Lọc theo Tab trạng thái
    let filtered = allOrders;
    if (currentStatus !== 'all') {
        filtered = allOrders.filter(o => o.status === currentStatus);
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 40px; background:white; border-radius:16px;">
                <p class="muted" style="font-size: 16px;">Không tìm thấy giao dịch nào.</p>
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(order => {
        const amount = order.totalAmount || order.total_amount || order.depositAmount || order.deposit_amount || 0;
        const dateStr = new Date(order.created_at || order.requested_at).toLocaleString('vi-VN');
        const badgeInfo = getStatusBadge(order.status);
        
        return `
            <div class="card order-card">
                <div class="order-header">
                    <div>
                        <div class="order-id">Mã giao dịch: #${order.id || order.sample_id}</div>
                        <div class="order-date">Ngày tạo: ${dateStr}</div>
                    </div>
                    <div class="badge ${badgeInfo.class}">${badgeInfo.text}</div>
                </div>
                <div class="order-body">
                    <div class="order-info">
                        <p>ID Sản phẩm: ${order.product_id}</p>
                        ${order.quantity ? `<p>Số lượng: ${order.quantity}</p>` : ''}
                    </div>
                    <div style="text-align: right;">
                        <p style="font-size: 13px; color: #64748b; margin-bottom: 4px;">Tổng tiền</p>
                        <div class="order-total">${parseInt(amount).toLocaleString('vi-VN')} đ</div>
                    </div>
                </div>
                <div class="order-actions">
                    ${generateActionButtons(order)}
                </div>
            </div>
        `;
    }).join('');
}

function getStatusBadge(status) {
    const map = {
        'pending': { text: 'Chờ thanh toán / Chờ duyệt', class: 'badge-pending' },
        'paid': { text: 'Đã thanh toán', class: 'badge-paid' },
        'shipped': { text: 'Đang giao hàng', class: 'badge-shipped' },
        'completed': { text: 'Hoàn thành', class: 'badge-completed' },
        'cancelled': { text: 'Đã hủy', class: 'badge-cancelled' },
        'refunded': { text: 'Đã hoàn tiền', class: 'badge-cancelled' }
    };
    return map[status] || { text: status, class: 'badge-pending' };
}

// Render Nút bấm thông minh theo trạng thái
function generateActionButtons(order) {
    let btns = '';
    
    if (order.status === 'pending') {
    const amount = order.totalAmount || order.total_amount || order.depositAmount || order.deposit_amount || 0;
    btns += `<button class="btn btn-primary" onclick="window.location.href='../buyer-checkout/index.html?orderId=${order.id || order.sample_id}&amount=${amount}'">💳 Thanh toán ngay</button>`;
    }
    else if (order.status === 'shipped') {
        btns += `<button class="btn btn-primary" onclick="confirmDelivery('${order.id}')">✅ Đã nhận được hàng (Giải ngân)</button>`;
        btns += `<button class="btn btn-outline" style="color: #ef4444; border-color: #ef4444;" onclick="openDisputeModal('${order.id}')">⚠️ Hàng lỗi / Khiếu nại</button>`;
    } 
    else if (order.status === 'completed') {
        btns += `<button class="btn btn-outline" onclick="window.location.href='../buyer-reviews/index.html?orderId=${order.id}'">⭐ Đánh giá sản phẩm</button>`;
    }
    
    return btns;
}

// ── 4. API Actions (Giải ngân & Khiếu nại) ────────────────
window.confirmDelivery = async function(orderId) {
    if (!confirm("Xác nhận bạn đã nhận đủ hàng và hàng đúng mô tả? Hệ thống sẽ giải ngân Ký quỹ cho người bán ngay lập tức.")) return;

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
            fetchOrders(); // Refresh list
        } else {
            throw new Error(data.message || "Lỗi xử lý giải ngân.");
        }
    } catch (error) {
        showToast(error.message, true);
    }
}

// Modal Logic
window.openDisputeModal = function(orderId) {
    currentOrderIdForDispute = orderId;
    document.getElementById('disputeModal').style.display = 'flex';
}
window.closeDisputeModal = function() {
    document.getElementById('disputeModal').style.display = 'none';
    document.getElementById('disputeReason').value = '';
}

window.submitDispute = async function() {
    const reason = document.getElementById('disputeReason').value.trim();
    if (reason.length < 10) return showToast("Vui lòng mô tả chi tiết lý do (ít nhất 10 ký tự).", true);

    const btn = document.getElementById('submitDisputeBtn');
    btn.disabled = true; btn.textContent = 'Đang gửi...';

    try {
        const response = await fetch(`${API_BASE_URL}/escrow/dispute`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({ orderId: currentOrderIdForDispute, reason })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showToast("Đã gửi khiếu nại thành công! Admin sẽ đóng băng tiền và xem xét.");
            closeDisputeModal();
            fetchOrders();
        } else {
            throw new Error(data.message || "Không thể gửi khiếu nại.");
        }
    } catch (error) {
        showToast(error.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Gửi khiếu nại';
    }
}

// ── Khởi chạy & Event Listeners ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        fetchOrders();

        // Xử lý Tabs
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                currentStatus = e.target.dataset.status;
                renderOrders();
            });
        });

        // Xử lý đổi Loại đơn (Sỉ/Mẫu)
        document.getElementById('orderTypeSelect').addEventListener('change', () => {
            // Reset tab về All khi đổi loại
            currentStatus = 'all';
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            document.querySelector('.tab-btn[data-status="all"]').classList.add('active');
            fetchOrders();
        });
    }
});