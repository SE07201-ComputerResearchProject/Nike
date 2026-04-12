// ============================================================
// O'Future Buyer Dashboard (Home)
// Tích hợp API thật & Xử lý Giỏ hàng độc lập theo Tài khoản
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentUser = null;
let CART_KEY = 'cart'; // Key mặc định, sẽ bị ghi đè sau khi có user.id

// ── 1. Auth Guard (Bảo vệ trang) ───────────────────────────
function checkAuth() {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');

    if (!token || !userStr) {
        alert('Vui lòng đăng nhập để truy cập trang này.');
        window.location.href = '../../login.html';
        return false;
    }

    currentUser = JSON.parse(userStr);
    
    // Nếu không phải Buyer, đuổi về đúng nhà
    if (currentUser.role !== 'buyer') {
        window.location.href = '../../login.html';
        return false;
    }

    // TẠO KEY GIỎ HÀNG RIÊNG CHO TÀI KHOẢN NÀY (Khắc phục Lỗi 1)
    CART_KEY = `cart_${currentUser.id}`;

    // Update UI Header
    document.getElementById('welcomeText').textContent = `Chào mừng, ${currentUser.fullName}!`;
    document.getElementById('userAvatar').textContent = currentUser.fullName.charAt(0).toUpperCase();
    
    return true;
}

// ── 2. Xử lý Lỗi Badge Giỏ Hàng (Khắc phục Lỗi 2) ──────────
function updateCartBadge() {
    const cartData = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    const totalItems = cartData.length;
    
    const badge = document.getElementById('cartBadge');
    if (badge) {
        badge.textContent = totalItems;
        badge.style.display = totalItems > 0 ? 'inline-block' : 'none'; // Ẩn nếu giỏ trống
    }
}

// ── 3. Lấy dữ liệu Sản phẩm từ DB ─────────────────────────
async function fetchFeaturedProducts() {
    const container = document.getElementById('featuredProducts');
    try {
        // Lấy danh sách sản phẩm (chỉ lấy 3 cái hiển thị ngoài Home)
        const response = await fetch(`${API_BASE_URL}/products?limit=3`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        const data = await response.json();

        if (data.success && data.data.length > 0) {
            container.innerHTML = data.data.map(p => `
                <div class="product-item">
                    <div class="product-info">
                        <h4>${p.name}</h4>
                        <p>${parseInt(p.price).toLocaleString('vi-VN')} đ</p>
                        <small class="muted">Tồn kho: ${p.stock_quantity}</small>
                    </div>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 13px;" 
                        onclick="addToCart('${p.id}', '${p.name}', ${p.price}, ${p.stock_quantity})">
                        + Vào giỏ
                    </button>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p class="muted">Chưa có sản phẩm nào đang bán.</p>';
        }
    } catch (error) {
        container.innerHTML = '<p style="color:red">Lỗi tải sản phẩm.</p>';
    }
}

// ── 4. Thêm vào Giỏ hàng (Thông minh) ─────────────────────
window.addToCart = function(id, name, price, stock) {
    if (stock <= 0) {
        alert('Sản phẩm đã hết hàng!'); return;
    }

    let cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    const existingItem = cart.find(item => item.id === id);

    if (existingItem) {
        if (existingItem.quantity >= stock) {
            alert('Bạn đã thêm tối đa số lượng tồn kho của sản phẩm này!'); return;
        }
        existingItem.quantity += 1;
    } else {
        cart.push({ id, name, price, stock, quantity: 1 });
    }

    // Lưu lại bằng Key Độc quyền của User
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    
    // Gọi hàm update ngay lập tức để icon nảy số
    updateCartBadge();
    
    // Thông báo nhẹ nhàng
    const toast = document.createElement('div');
    toast.textContent = `Đã thêm ${name} vào giỏ!`;
    toast.style.cssText = "position:fixed; bottom:20px; right:20px; background:#10b981; color:white; padding:10px 20px; border-radius:8px; z-index:9999;";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

// ── 5. Đăng xuất ──────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({ allDevices: false })
        });
    } catch (e) {} // Bỏ qua lỗi mạng nếu có
    
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    window.location.href = '../../login.html';
});

// ── Khởi chạy ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        updateCartBadge(); // Gọi hàm này đầu tiên để sửa Lỗi 2
        fetchFeaturedProducts();
    }
});