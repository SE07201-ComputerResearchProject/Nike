// ============================================================
// O'Future Buyer - Smart Cart Engine
// Tính toán Offline & Điều hướng Checkout
// ============================================================

let currentUser = null;
let CART_KEY = 'cart';
let cartItems = [];

// ── 1. Auth Guard & Khởi tạo ──────────────────────────────
function checkAuth() {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    if (!token || !userStr) { window.location.href = '../../login.html'; return false; }

    currentUser = JSON.parse(userStr);
    if (currentUser.role !== 'buyer') { window.location.href = '../../login.html'; return false; }

    CART_KEY = `cart_${currentUser.id}`;
    const nameToUse = currentUser.fullName || currentUser.full_name || currentUser.username || 'U';
    document.getElementById('userAvatar').textContent = nameToUse.charAt(0).toUpperCase();
    return true;
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.1);`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ── 2. Render Dữ liệu Giỏ hàng ────────────────────────────
function loadCart() {
    cartItems = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    // Mặc định chọn tất cả nếu chưa có trạng thái
    cartItems.forEach(item => { if(item.selected === undefined) item.selected = true; });
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));

    const container = document.getElementById('cartList');
    
    if (cartItems.length === 0) {
        container.innerHTML = `
            <div class="empty-cart">
                <h3 style="font-size: 20px;">Giỏ hàng của bạn đang trống</h3>
                <a href="../buyer-products/index.html" class="btn btn-primary" style="display:inline-block; padding: 10px 24px; margin-top: 10px;">Mua sắm ngay</a>
            </div>`;
        document.getElementById('checkoutBtn').disabled = true;
        updateSummary(); updateCartBadge(); return;
    }

    const allSelected = cartItems.length > 0 && cartItems.every(i => i.selected);
    let html = `
        <div style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px; padding: 10px; background: white; border-radius: 8px;">
            <input type="checkbox" id="selectAll" ${allSelected ? 'checked' : ''} onchange="toggleSelectAll(this.checked)" style="width:18px; height:18px; cursor:pointer;">
            <label for="selectAll" style="font-weight:600; cursor:pointer;">Chọn tất cả (${cartItems.length} sản phẩm)</label>
        </div>
    `;

    html += cartItems.map((item) => {
        const priceStr = parseInt(item.price).toLocaleString('vi-VN');
        return `
            <div class="cart-item" style="display:flex; align-items:center; gap: 15px;">
                <input type="checkbox" class="item-checkbox" ${item.selected ? 'checked' : ''} onchange="toggleSelect('${item.id}', this.checked)" style="width:18px; height:18px; cursor:pointer;">
                <img src="${item.image || '../../images/image.png'}" class="item-img" style="width:80px; height:80px; object-fit:cover; border-radius:8px;">
                <div class="item-info" style="flex:1;">
                    <h3>${item.name}</h3>
                    <div class="seller-name">Shop ID: ${item.sellerId || 'Ẩn danh'}</div>
                    <div class="price">${priceStr} đ</div>
                </div>
                <div class="item-controls">
                    <div class="qty-control">
                        <button onclick="changeQty('${item.id}', -1)">-</button>
                        <input type="number" value="${item.quantity}" min="1" onchange="updateQtyInput('${item.id}', this.value)">
                        <button onclick="changeQty('${item.id}', 1)">+</button>
                    </div>
                    <button class="btn-delete" onclick="removeItem('${item.id}')">Xóa</button>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = html;
    updateSummary(); updateCartBadge();
}

window.toggleSelect = function(id, isChecked) {
    const item = cartItems.find(i => i.id === id);
    if (item) item.selected = isChecked;
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    loadCart();
}

window.toggleSelectAll = function(isChecked) {
    cartItems.forEach(i => i.selected = isChecked);
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    loadCart();
}

// ── 3. Các hàm tương tác Giỏ hàng ─────────────────────────
window.changeQty = function(id, delta) {
    const item = cartItems.find(i => i.id === id);
    if (!item) return;

    let newQty = item.quantity + delta;
    
    if (newQty < 1) newQty = 1;
    if (newQty > item.stock) {
        showToast(`Bạn chỉ có thể mua tối đa ${item.stock} sản phẩm này!`, true);
        newQty = item.stock;
    }

    item.quantity = newQty;
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    loadCart(); // Render lại
}

window.removeItem = function(id) {
    if(!confirm("Bạn có chắc chắn muốn xóa sản phẩm này khỏi giỏ?")) return;
    cartItems = cartItems.filter(i => i.id !== id);
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    loadCart();
    showToast("Đã xóa sản phẩm khỏi giỏ.");
}

window.updateQtyInput = function(id, val) {
    const item = cartItems.find(i => i.id === id);
    if (!item) return;
    
    let newQty = parseInt(val);
    if (isNaN(newQty) || newQty < 1) newQty = 1;
    if (newQty > item.stock) {
        showToast(`Chỉ còn ${item.stock} sản phẩm!`, true);
        newQty = item.stock;
    }
    
    item.quantity = newQty;
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    loadCart();
}

function updateCartBadge() {
    const totalItems = cartData.length;
    const badge = document.getElementById('cartBadge');
    if (badge) {
        badge.textContent = totalItems;
        badge.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }
}

// ── 4. Thuật toán tính toán (Pricing Engine) ──────────────
function updateSummary() {
    // Chỉ tính tiền các món được Check
    const selectedItems = cartItems.filter(i => i.selected);
    const subtotal = selectedItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
    const platformFee = subtotal * 0.025;
    const total = subtotal + platformFee;

    document.getElementById('subtotalPrice').textContent = subtotal.toLocaleString('vi-VN') + ' đ';
    document.getElementById('platformFee').textContent = platformFee.toLocaleString('vi-VN') + ' đ';
    document.getElementById('totalPrice').textContent = total.toLocaleString('vi-VN') + ' đ';
    
    const btn = document.getElementById('checkoutBtn');
    btn.disabled = selectedItems.length === 0;
    btn.textContent = `Tiến hành Thanh toán (${selectedItems.length})`;
}

// ── 5. Điều hướng Thanh toán (Checkout) ───────────────────
window.proceedToCheckout = function() {
    const selectedItems = cartItems.filter(i => i.selected);
    if (selectedItems.length === 0) return showToast("Vui lòng chọn ít nhất 1 sản phẩm để thanh toán!", true);
    window.location.href = '../buyer-checkout/index.html';
}

// ── Khởi chạy ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        loadCart();
    }
});