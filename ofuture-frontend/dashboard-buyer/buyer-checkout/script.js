// ============================================================
// O'Future Buyer - Checkout Engine (MoMo & VietQR Ký quỹ)
// ============================================================

const urlParams = new URLSearchParams(window.location.search);
const pendingOrderId = urlParams.get('orderId');
const pendingAmount = urlParams.get('amount');

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentUser = null;
let CART_KEY = 'cart';
let cartItems = [];
let finalTotalAmount = 0;
let createdOrderIds = [];

// ── 1. Khởi tạo & Kiểm tra ────────────────────────────────
function checkAuth() {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    if (!token || !userStr) { window.location.href = '../../login.html'; return false; }

    currentUser = JSON.parse(userStr);
    if (currentUser.role !== 'buyer') { window.location.href = '../../login.html'; return false; }

    CART_KEY = `cart_${currentUser.id}`;
    document.getElementById('userAvatar').textContent = currentUser.fullName.charAt(0).toUpperCase();
    return true;
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.1);`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ── 2. Render Tóm tắt Đơn hàng ────────────────────────────
function loadCheckoutData() {
    // Nếu có pendingOrderId -> Đang thanh toán lại đơn hàng cũ
    if (pendingOrderId) {
        document.getElementById('orderItems').innerHTML = `
            <div class="summary-item">
                <span class="summary-item-name">Thanh toán lại giao dịch</span>
                <strong>#${pendingOrderId.substring(0, 8)}...</strong>
            </div>
        `;
        finalTotalAmount = parseInt(pendingAmount) || 0;
        document.getElementById('subtotalPrice').textContent = "---";
        document.getElementById('platformFee').textContent = "---";
        document.getElementById('totalPrice').textContent = finalTotalAmount.toLocaleString('vi-VN') + ' đ';
        document.getElementById('qrTotalAmount').textContent = finalTotalAmount.toLocaleString('vi-VN') + ' đ';
        return; // Dừng tại đây, KHÔNG kiểm tra giỏ hàng nữa
    }

    // Logic cũ: Xử lý giỏ hàng nếu đang tạo đơn mới
    let allCart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    cartItems = allCart.filter(item => item.selected === true);
    if (cartItems.length === 0) {
        alert("Giỏ hàng của bạn đang trống! Đang quay lại giỏ hàng.");
        window.location.href = '../buyer-cart/index.html';
        return;
    }

    const itemsContainer = document.getElementById('orderItems');
    let subtotal = 0;

    itemsContainer.innerHTML = cartItems.map(item => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        return `
            <div class="summary-item">
                <span class="summary-item-name">${item.quantity}x ${item.name}</span>
                <strong>${itemTotal.toLocaleString('vi-VN')} đ</strong>
            </div>
        `;
    }).join('');

    const platformFee = subtotal * 0.025;
    const shippingFee = 30000;
    finalTotalAmount = subtotal + platformFee + shippingFee;

    document.getElementById('subtotalPrice').textContent = subtotal.toLocaleString('vi-VN') + ' đ';
    document.getElementById('platformFee').textContent = platformFee.toLocaleString('vi-VN') + ' đ';
    document.getElementById('totalPrice').textContent = finalTotalAmount.toLocaleString('vi-VN') + ' đ';
    document.getElementById('qrTotalAmount').textContent = finalTotalAmount.toLocaleString('vi-VN') + ' đ';
}

// ── 3. Thuật toán Xử lý Đặt hàng & Thanh toán ─────────────
window.handlePlaceOrder = async function() {
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
    const btn = document.getElementById('placeOrderBtn');
    btn.disabled = true;
    btn.textContent = "Đang xử lý...";

    try {
        if (pendingOrderId) {
            // ... (Phần đơn hàng cũ giữ nguyên)
            return; 
        }

        // NẾU LÀ ĐƠN HÀNG MỚI
        const address = {
            street: document.getElementById('addressStreet').value.trim(),
            city: document.getElementById('addressCity').value.trim(),
            zip: document.getElementById('addressZip').value.trim(),
            country: document.getElementById('addressCountry').value.trim()
        };

        if (!address.street || !address.city || !address.zip) {
            btn.disabled = false;
            btn.textContent = "Xác nhận Đặt hàng";
            return showToast("Vui lòng điền đầy đủ thông tin địa chỉ giao hàng!", true);
        }

        // 1. Tạo mảng items theo đúng định dạng Backend cần
        const payloadItems = cartItems.map(item => ({
            productId: item.id || item.productId, // Tùy thuộc vào cấu trúc item của bạn lưu trong storage
            quantity: item.quantity
        }));

        // 2. Gom vào payload
        const payload = {
            items: payloadItems,
            shippingAddress: address
        };

        // 3. Gọi API 1 LẦN DUY NHẤT
        const response = await fetch(`${API_BASE_URL}/orders`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        if (response.ok && data.success) {
            const representativeOrderId = data.data.orderId; // Lấy ID của đơn hàng vừa tạo

            // 4. Gọi tiếp API thanh toán MoMo / VietQR / Ví
            if (paymentMethod === 'momo') {
                await processMoMo(representativeOrderId, finalTotalAmount);
            } else if (paymentMethod === 'qr') {
                await processVietQR(representativeOrderId, finalTotalAmount);
            } else if (paymentMethod === 'wallet') {
                await processWalletPayment(representativeOrderId, finalTotalAmount);
            }
        } else {
            throw new Error(data.message || "Lỗi khi tạo đơn hàng");
        }

    } catch (error) {
        showToast(error.message, true);
        btn.disabled = false;
        btn.textContent = "Xác nhận Đặt hàng";
    }
}

// ── 4. Xử lý MoMo ─────────────────────────────────────────
async function processMoMo(orderId, amount) {
    const response = await fetch(`${API_BASE_URL}/payments/momo/create`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        },
        body: JSON.stringify({ orderId, amount })
    });
    
    const data = await response.json();
    if (response.ok && data.success) {
        // Xóa giỏ hàng
        const remainingCart = JSON.parse(localStorage.getItem(CART_KEY)).filter(i => !i.selected);
        localStorage.setItem(CART_KEY, JSON.stringify(remainingCart));
        
        // Mở Popup thay vì redirect
        const width = 600, height = 700;
        const left = (window.innerWidth / 2) - (width / 2);
        const top = (window.innerHeight / 2) - (height / 2);
        const momoWindow = window.open(data.data.payUrl, 'MoMoPayment', `width=${width},height=${height},top=${top},left=${left}`);
        
        showToast("Vui lòng hoàn tất thanh toán ở cửa sổ MoMo...");

        // Bắt đầu kiểm tra trạng thái đơn hàng liên tục (Mỗi 3 giây)
        const checkInterval = setInterval(async () => {
            if (momoWindow.closed) {
                clearInterval(checkInterval);
                // BỎ alert(), thay bằng showToast
                showToast("Đã đóng cửa sổ thanh toán. Đang kiểm tra lại...", true);
                setTimeout(() => {
                    window.location.href = '../buyer-orders/index.html';
                }, 2000);
            }
            
            const firstId = orderId.split('_')[0];
            const checkRes = await fetch(`${API_BASE_URL}/orders/${firstId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
            });
            const checkData = await checkRes.json();
            
            if (checkData.success && checkData.data.status === 'paid') {
                clearInterval(checkInterval);
                
                // Đóng popup trước
                if (!momoWindow.closed) {
                    momoWindow.close();
                }
                
                // BỎ alert(), dùng showToast để không bị chặn luồng
                showToast("🎉 Thanh toán thành công! Đang chuyển hướng...");
                setTimeout(() => {
                    window.location.href = '../buyer-orders/index.html'; 
                }, 1500); // Đợi 1.5s cho mượt rồi mới chuyển trang
            }
        }, 3000);

    } else {
        throw new Error(data.message || "Không thể tạo giao dịch MoMo");
    }
}

// ── 7. Xử lý Thanh toán bằng Ví Nội bộ ──────────────────
async function processWalletPayment(orderId, amount) {
    try {
        const response = await fetch(`${API_BASE_URL}/payments/wallet/pay`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({ orderId, amount })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Xóa giỏ hàng
            const remainingCart = JSON.parse(localStorage.getItem(CART_KEY)).filter(i => !i.selected);
            localStorage.setItem(CART_KEY, JSON.stringify(remainingCart));
            
            showToast("🎉 Thanh toán bằng ví thành công!");
            setTimeout(() => {
                window.location.href = '../buyer-orders/index.html';
            }, 1500);
        } else {
            throw new Error(data.message || "Số dư ví không đủ hoặc có lỗi xảy ra.");
        }
    } catch (error) {
        showToast(error.message, true);
        // Mở lại nút đặt hàng nếu lỗi (VD: thiếu tiền)
        const btn = document.getElementById('placeOrderBtn');
        btn.disabled = false;
        btn.textContent = "Xác nhận Đặt hàng";
    }
}

// ── 5. Xử lý VietQR (Ký quỹ Bán tự động) ──────────────────
async function processVietQR(orderId, amount) {
    // Tạm thời bỏ qua việc gọi API QR nếu bị lỗi, dùng link cứng từ cấu hình
    const staticQrLink = window.CONFIG?.DRIVE_QR_LINK || "https://drive.google.com/file/d/1ewMm6TtxpdOItVEyFhzM6RIZhS-KT1xD/view?usp=sharing"; 
    
    // Xóa giỏ hàng
    localStorage.removeItem(CART_KEY);
    
    // Hiện QR lên Modal
    document.getElementById('qrCodeContainer').innerHTML = `
        <img src="${staticQrLink}" alt="Mã QR Ký quỹ" style="max-width: 100%; border-radius: 8px;">
        <p style="margin-top: 15px; color: #ef4444; font-weight: bold;">Nội dung chuyển khoản: ${orderId.substring(0,8)}</p>
    `;
    document.getElementById('qrModal').style.display = 'flex';
}

// ── 6. Hành động trên Modal VietQR ────────────────────────
window.confirmTransfer = function() {
    // KHÔNG gọi API success ở đây. Chỉ báo cho User chờ Admin xác nhận.
    document.getElementById('qrModal').style.display = 'none';
    alert("Cảm ơn bạn! Đơn hàng đang ở trạng thái 'Chờ thanh toán'. Hệ thống sẽ cập nhật ngay khi Admin xác nhận được số tiền chuyển khoản.");
    window.location.href = '../buyer-orders/index.html';
}

window.cancelTransfer = function() {
    document.getElementById('qrModal').style.display = 'none';
    alert("Giao dịch đã được hủy. Đơn hàng của bạn sẽ ở trạng thái chờ thanh toán.");
    window.location.href = '../buyer-orders/index.html';
}

// ── Khởi chạy ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        loadCheckoutData();
    }
});