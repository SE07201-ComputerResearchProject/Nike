const accessToken = localStorage.getItem('accessToken');
let cart = JSON.parse(localStorage.getItem('checkoutCart')) || [];  // Lấy từ cart khi checkout
let currentPaymentId = null;
let currentOrderIds = [];

// Lấy orderIds từ URL
const urlParams = new URLSearchParams(window.location.search);
const ordersParam = urlParams.get('orders');
if (ordersParam) {
    currentOrderIds = ordersParam.split(',');
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function formatPrice(price) {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND'
    }).format(price);
}

function renderOrderSummary() {
    const orderItems = document.getElementById('orderItems');
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const platformFee = subtotal * 0.025;
    const total = subtotal + platformFee;

    orderItems.innerHTML = cart.map(item => `
        <div class="order-item">
            <div class="item-info">
                <h4>${item.name}</h4>
                <p>Số lượng: ${item.quantity}</p>
                <p>Người bán: ${item.sellerUsername}</p>
            </div>
            <div class="item-price">${formatPrice(item.price * item.quantity)}</div>
        </div>
    `).join('');

    document.getElementById('subtotal').textContent = formatPrice(subtotal);
    document.getElementById('platformFee').textContent = formatPrice(platformFee);
    document.getElementById('total').textContent = formatPrice(total);
    document.getElementById('orderCount').textContent = cart.length;
}

async function placeOrders() {
    if (!accessToken) {
        showToast('Vui lòng đăng nhập để đặt hàng', 'error');
        window.location.href = 'login.html';
        return;
    }

    const fullName = document.getElementById('fullName').value;
    const phone = document.getElementById('phone').value;
    const street = document.getElementById('street').value;
    const city = document.getElementById('city').value;
    const zipCode = document.getElementById('zipCode').value;
    const notes = document.getElementById('notes').value || '';
    const paymentMethod = document.querySelector('input[name="payment"]:checked')?.value;

    if (!fullName || !phone || !street || !city) {
        showToast('Vui lòng điền đầy đủ thông tin giao hàng', 'error');
        return;
    }

    if (!paymentMethod) {
        showToast('Vui lòng chọn phương thức thanh toán', 'error');
        return;
    }

    const shippingAddress = {
        fullName,
        phone,
        street,
        city,
        zipCode,
        country: 'Vietnam'
    };

    document.getElementById('placeOrderBtn').disabled = true;
    document.getElementById('placeOrderBtn').textContent = 'Đang xử lý...';

    try {
        // Cập nhật shippingAddress cho tất cả order đã tạo
        for (const orderId of currentOrderIds) {
            // Sử dụng fetchAPI để tự động xử lý Content-Type, Authorization Token và lỗi 401
            await fetchAPI(`/orders/${orderId}/update-shipping`, {  
                method: 'PATCH',
                body: JSON.stringify({ shippingAddress, notes })
            });
        }

        // Xử lý thanh toán cho từng order
        for (let i = 0; i < cart.length; i++) {
            const itemTotal = cart[i].price * cart[i].quantity;
            await processPayment(currentOrderIds[i], itemTotal, paymentMethod);
        }

        localStorage.removeItem('cart');
        localStorage.removeItem('currentOrderIds');
        localStorage.removeItem('checkoutCart');

        showToast('Đặt hàng thành công!', 'success');
        
        setTimeout(() => {
            window.location.href = 'orders.html';
        }, 2000);

    } catch (error) {
        console.error(error);
        showToast(error.message || 'Đặt hàng thất bại', 'error');
        document.getElementById('placeOrderBtn').disabled = false;
        document.getElementById('placeOrderBtn').textContent = 'Đặt hàng';
    }
}

async function processPayment(orderId, amount, method) {
    if (method === 'cod') return; // COD requires no immediate API call

    if (method === 'momo') {
        // FIX: was '/payments/momo' → correct route is '/payments/momo/create'
        const data = await fetchAPI('/payments/momo/create', {
            method : 'POST',
            body   : JSON.stringify({ orderId, amount }),
        });
        window.open(data.data.payUrl, '_blank');
        return;
    }

    if (method === 'qr') {
        // FIX: was '/payments/qr' → correct route is '/payments/qr/create'
        const data = await fetchAPI('/payments/qr/create', {
            method : 'POST',
            body   : JSON.stringify({ orderId, amount }),
        });
        currentPaymentId = data.data.paymentId;
        showQRModal(data.data.qrCodeImage || data.data.qrCode);
    }
}

// Các hàm QR giữ nguyên
function showQRModal(qrCode) {
    const modal = document.getElementById('qrModal');
    const qrContainer = document.getElementById('qrCodeContainer');
    qrContainer.innerHTML = `<img src="${qrCode}" alt="QR Code">`;
    modal.classList.add('show');
}

function closeQRModal() {
    document.getElementById('qrModal').classList.remove('show');
}

async function confirmQRPayment() {
    if (!currentPaymentId) return;

    try {
        // fetchAPI sẽ lo việc nối URL, gắn Header Authorization và tự bắt lỗi nếu thất bại (401, 500...)
        await fetchAPI(`/payments/qr/${currentPaymentId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ success: true })
        });

        closeQRModal();
        showToast('Xác nhận thanh toán thành công!');
    } catch (error) {
        // Đảm bảo luôn có message lỗi hiển thị kể cả khi backend không trả về error.message
        showToast(error.message || 'Xác nhận thanh toán thất bại', 'error');
    }
}

// ==================== INITIALIZE ====================
if (cart.length === 0 && currentOrderIds.length === 0) {
    showToast('Giỏ hàng trống', 'error');
    setTimeout(() => window.location.href = 'cart.html', 1500);
} else {
    renderOrderSummary();
}