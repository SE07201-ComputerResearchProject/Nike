// ============================================================
// O'Future Buyer Products
// Tích hợp End-to-End, Tìm kiếm, Sắp xếp & Smart Cart
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentUser = null;
let CART_KEY = 'cart';

let allProducts = []; // Lưu trữ toàn bộ sản phẩm tải từ server
let filteredProducts = []; // Lưu trữ sản phẩm sau khi lọc/tìm kiếm

// ── 1. Auth Guard & Cập nhật UI chung ─────────────────────
function checkAuth() {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    if (!token || !userStr) { window.location.href = '../../login.html'; return false; }

    currentUser = JSON.parse(userStr);
    if (currentUser.role !== 'buyer') { window.location.href = '../../login.html'; return false; }

    CART_KEY = `cart_${currentUser.id}`;
    // FIX: Đọc an toàn tên người dùng tránh lỗi Crash
    const nameToUse = currentUser.fullName || currentUser.full_name || currentUser.username || 'U';
    document.getElementById('userAvatar').textContent = nameToUse.charAt(0).toUpperCase();
    return true;
}

function updateCartBadge() {
    const cartData = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    const totalItems = cartData.reduce((sum, item) => sum + item.quantity, 0);
    const badge = document.getElementById('cartBadge');
    if (badge) {
        badge.textContent = totalItems;
        badge.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500; box-shadow: 0 4px 6px rgba(0,0,0,0.1);`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ── 2. Call API Lấy Danh Sách Sản Phẩm ────────────────────
async function fetchProducts() {
    const grid = document.getElementById('productGrid');
    try {
        const response = await fetch(`${API_BASE_URL}/products`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        const data = await response.json();

        if (response.ok && data.success) {
            allProducts = data.data; // Lưu vào biến toàn cục
            applyFiltersAndRender(); // Gọi hàm lọc & render
        } else {
            grid.innerHTML = '<p class="muted">Không thể tải danh sách sản phẩm.</p>';
        }
    } catch (error) {
        grid.innerHTML = '<p style="color:red">Lỗi mạng khi tải sản phẩm.</p>';
    }
}

// ── 3. Render, Lọc & Tìm kiếm ─────────────────────────────
function applyFiltersAndRender() {
    // Lấy giá trị bộ lọc
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();
    const activeTab = document.querySelector('.category-tab.active').dataset.category;
    const sortValue = document.getElementById('sortSelect').value;

    // Lọc theo Danh mục & Tìm kiếm
    filteredProducts = allProducts.filter(p => {
        const matchCategory = activeTab === 'ALL' || p.category.toUpperCase() === activeTab;
        const matchSearch = p.name.toLowerCase().includes(searchQuery);
        return matchCategory && matchSearch;
    });

    // Sắp xếp
    if (sortValue === 'price_asc') {
        filteredProducts.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    } else if (sortValue === 'price_desc') {
        filteredProducts.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    } else {
        // newest (Mặc định server đã trả về mới nhất, nếu mảng bị đảo lộn thì ta sort theo created_at)
        filteredProducts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    renderProducts(filteredProducts);
}

function renderProducts(products) {
    const grid = document.getElementById('productGrid');
    if (products.length === 0) {
        grid.innerHTML = '<p class="muted" style="grid-column: 1/-1; text-align:center;">Không tìm thấy sản phẩm nào phù hợp.</p>';
        return;
    }

    grid.innerHTML = products.map(p => {
        const price = parseInt(p.price).toLocaleString('vi-VN');
        const isOutOfStock = p.stock_quantity <= 0;
        
        // --- FIX ẢNH BUYER TẠI ĐÂY ---
        let imgUrl = '../../images/image.png'; // Ảnh mặc định
        if (p.imageUrls) {
            try {
                const parsedImgs = typeof p.imageUrls === 'string' ? JSON.parse(p.imageUrls) : p.imageUrls;
                if (Array.isArray(parsedImgs) && parsedImgs.length > 0) {
                    let rawUrl = parsedImgs[0];
                    // Nếu là đường dẫn tương đối từ backend, nối thêm base url của backend
                    if (rawUrl.startsWith('/uploads')) {
                        const backendBaseUrl = API_BASE_URL.replace('/api', ''); // Tách 'http://localhost:5000' từ API_BASE_URL
                        imgUrl = `${backendBaseUrl}${rawUrl}`;
                    } else {
                        imgUrl = rawUrl; // Dành cho trường hợp link http ngoài (imgur, cloudinary...)
                    }
                }
            } catch (e) {}
        }

        return `
            <div class="product-card">
                <img src="${imgUrl}" alt="${p.name}" class="product-image" onclick="goToDetail('${p.id}')">
                <div class="product-info">
                    <h3 class="product-title" onclick="goToDetail('${p.id}')">${p.name}</h3>
                    <div class="product-seller">Cung cấp bởi: <strong>${p.seller_name || p.seller_username || 'Nhà cung cấp'}</strong></div>
                    <div class="product-price">${price} đ</div>
                    
                    <button class="btn btn-primary btn-add-cart" 
                        ${isOutOfStock ? 'disabled' : ''} 
                        onclick="addToCart('${p.id}', '${p.name}', ${p.price}, '${imgUrl}', '${p.seller_id}', ${p.stock_quantity})">
                        ${isOutOfStock ? 'Hết hàng' : '+ Thêm vào giỏ'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ── 4. Hành động: Vào chi tiết & Thêm giỏ hàng ────────────
window.goToDetail = function(productId) {
    // Chuyển hướng sang trang detail, truyền ID qua URL parameter
    window.location.href = `../buyer-product-detail/index.html?id=${productId}`;
}

window.addToCart = function(id, name, price, image, sellerId, stock) {
    if (stock <= 0) return;

    let cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    const existingItem = cart.find(item => item.id === id);

    if (existingItem) {
        if (existingItem.quantity >= stock) {
            showToast('Đã đạt giới hạn tồn kho của nhà cung cấp!', true); return;
        }
        existingItem.quantity += 1;
    } else {
        // Bắt buộc lưu sellerId để sau này Checkout biết tách đơn hàng theo Shop
        cart.push({ id, name, price, image, sellerId, stock, quantity: 1 });
    }

    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
    showToast(`Đã thêm "${name}" vào giỏ!`);
}

// ── 5. Đăng xuất ──────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
    } catch (e) {} 
    localStorage.clear();
    window.location.href = '../../login.html';
});

// ── Khởi chạy và gán Sự kiện ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        updateCartBadge();
        fetchProducts();

        // Lắng nghe sự kiện tìm kiếm & sắp xếp
        document.getElementById('searchInput').addEventListener('input', applyFiltersAndRender);
        document.getElementById('sortSelect').addEventListener('change', applyFiltersAndRender);

        // Lắng nghe sự kiện click các Tab danh mục
        document.querySelectorAll('.category-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                applyFiltersAndRender();
            });
        });
    }
});