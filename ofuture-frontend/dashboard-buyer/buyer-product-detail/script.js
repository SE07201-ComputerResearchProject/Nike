// ============================================================
// O'Future Buyer - Product Detail
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentUser = null;
let CART_KEY = 'cart';
let currentProduct = null;

// ── 1. Khởi tạo & Phân quyền ──────────────────────────────
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

function updateCartBadge() {
    const cartData = JSON.parse(localStorage.getItem(CART_KEY)) || [];
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
    toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500;`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ── 2. Lấy dữ liệu Sản phẩm ───────────────────────────────
async function fetchProductDetail() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        alert("Không tìm thấy mã sản phẩm!");
        window.location.href = "../buyer-products/index.html";
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/products/${productId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        const data = await response.json();

        if (response.ok && data.success) {
            currentProduct = data.data;
            renderProduct(currentProduct);
        } else {
            throw new Error("Không thể tải thông tin sản phẩm.");
        }
    } catch (error) {
        document.getElementById('loadingIndicator').innerHTML = `<p style="color:red">${error.message}</p>`;
    }
}

function renderProduct(p) {
    document.getElementById('loadingIndicator').style.display = 'none';
    document.getElementById('productContainer').style.display = 'grid';

    // Xử lý ảnh giống với trang danh sách sản phẩm
    let imgUrl = '../../images/image.png';
    if (p.imageUrls) {
        try {
            const parsedImgs = typeof p.imageUrls === 'string' ? JSON.parse(p.imageUrls) : p.imageUrls;
            if (Array.isArray(parsedImgs) && parsedImgs.length > 0) {
                // 1. Cập nhật ảnh chính
                document.getElementById('mainImage').src = parsedImgs[0];
                
                // 2. Tạo Gallery ảnh phụ (bạn cần thêm <div id="imageGallery"></div> vào file HTML)
                const galleryContainer = document.getElementById('imageGallery');
                if (galleryContainer) {
                    galleryContainer.innerHTML = parsedImgs.map(img => 
                        `<img src="${img}" width="60" style="cursor:pointer; margin: 5px; border: 1px solid #ccc;" onclick="document.getElementById('mainImage').src='${img}'">`
                    ).join('');
                }
            }
        } catch (e) {}
    }
    document.getElementById('mainImage').src = imgUrl;

    // Đổ dữ liệu text (Đã sửa theo camelCase và cấu trúc seller)
    document.getElementById('productName').textContent = p.name;
    document.getElementById('productPrice').textContent = parseInt(p.price).toLocaleString('vi-VN') + ' đ';
    document.getElementById('productStock').textContent = p.stockQuantity;
    document.getElementById('productCategory').textContent = p.category;
    document.getElementById('productDesc').textContent = p.description || "Không có mô tả.";
    document.querySelector('#sellerName span').textContent = p.seller?.name || p.seller?.username || "Nhà cung cấp ẩn danh";

    // Xử lý hết hàng
    if (p.stockQuantity <= 0) {
        const btn = document.getElementById('addCartBtn');
        btn.disabled = true;
        btn.textContent = "Đã hết hàng";
        btn.style.background = "#cbd5e1";
        document.getElementById('qtyInput').disabled = true;
    }
}

// ── 3. Giỏ hàng & Số lượng ────────────────────────────────
function changeQty(amount) {
    const input = document.getElementById('qtyInput');
    let val = parseInt(input.value) + amount;
    if (val < 1) val = 1;
    if (currentProduct && val > currentProduct.stock_quantity) {
        val = currentProduct.stock_quantity;
        showToast("Đã đạt giới hạn tồn kho!", true);
    }
    input.value = val;
}

window.handleAddToCart = function() {
    if (!currentProduct || currentProduct.stockQuantity <= 0) return;
    
    const qty = parseInt(document.getElementById('qtyInput').value);
    let cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    const existingItem = cart.find(item => item.id === currentProduct.id);

    if (existingItem) {
        if (existingItem.quantity + qty > currentProduct.stockQuantity) {
            showToast(`Bạn chỉ có thể mua tối đa ${currentProduct.stockQuantity} sản phẩm này!`, true);
            return;
        }
        existingItem.quantity += qty;
    } else {
        let imgUrl = '../../images/image.png';
        try {
            const parsed = typeof currentProduct.imageUrls === 'string' ? JSON.parse(currentProduct.imageUrls) : currentProduct.imageUrls;
            if (parsed && parsed.length > 0) {
                let rawUrl = parsed[0];
                if (rawUrl.startsWith('/uploads')) {
                    const backendBaseUrl = API_BASE_URL.replace('/api', '');
                    imgUrl = `${backendBaseUrl}${rawUrl}`;
                } else {
                    imgUrl = rawUrl;
                }
            }
        } catch(e) {}

        cart.push({
            id: currentProduct.id,
            name: currentProduct.name,
            price: currentProduct.price,
            image: imgUrl,
            sellerId: currentProduct.seller?.id,
            stock: currentProduct.stockQuantity,
            quantity: qty
        });
    }

    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
    showToast(`Đã thêm ${qty} sản phẩm vào giỏ!`);
}

// ── 4. Yêu cầu hàng mẫu (Sample Request) ──────────────────
const modal = document.getElementById('sampleModal');

window.openSampleModal = function() {
    if (!currentProduct) return;
    modal.style.display = 'flex';
}

window.closeSampleModal = function() {
    modal.style.display = 'none';
    document.getElementById('sampleDeposit').value = '';
    document.getElementById('sampleNotes').value = '';
}

window.submitSampleRequest = async function() {
    const deposit = document.getElementById('sampleDeposit').value;
    const notes = document.getElementById('sampleNotes').value;

    if (!deposit || deposit < 0) {
        showToast("Vui lòng nhập số tiền cọc hợp lệ.", true);
        return;
    }

    const btn = document.getElementById('submitSampleBtn');
    btn.disabled = true;
    btn.textContent = "Đang gửi...";

    try {
        const payload = {
            productId: currentProduct.id,
            sellerId: currentProduct.seller?.id, // Đã sửa
            depositAmount: deposit,
            notes: notes
        };

        const response = await fetch(`${API_BASE_URL}/samples`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (response.ok && data.success) {
            showToast("Đã gửi yêu cầu nhận hàng mẫu thành công!");
            closeSampleModal();
        } else {
            throw new Error(data.message || "Gửi yêu cầu thất bại.");
        }
    } catch (error) {
        showToast(error.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = "Gửi yêu cầu";
    }
}

// ── Khởi chạy ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        updateCartBadge();
        fetchProductDetail();
    }
});