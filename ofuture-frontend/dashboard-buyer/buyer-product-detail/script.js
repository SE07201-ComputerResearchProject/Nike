// ============================================================
// O'Future Buyer - Product Detail
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
const BACKEND_BASE_URL = API_BASE_URL.replace('/api', '') || 'http://localhost:5000';
let currentUser = null;
let CART_KEY = 'cart';
let currentProduct = null;
let productVariants = [];
let selectedVariant = null;

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
            await fetchProductVariants(productId);
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
    let defaultImg = '../../images/image.png';
    let mainImgSrc = defaultImg;

    if (p.imageUrls) {
        try {
            const parsedImgs = typeof p.imageUrls === 'string' ? JSON.parse(p.imageUrls) : p.imageUrls;
            if (Array.isArray(parsedImgs) && parsedImgs.length > 0) {
                // Hàm nối domain cho ảnh
                const getFullUrl = (url) => url.startsWith('/uploads') ? `${BACKEND_BASE_URL}${url}` : url;
                
                mainImgSrc = getFullUrl(parsedImgs[0]);
                
                // Đổ danh sách ảnh phụ
                const galleryContainer = document.getElementById('imageGallery');
                if (galleryContainer) {
                    galleryContainer.innerHTML = parsedImgs.map(img => {
                        const fullImg = getFullUrl(img);
                        return `<img src="${fullImg}" width="80" height="80" style="cursor:pointer; border: 1px solid #ccc; object-fit: cover; border-radius: 4px;" onclick="document.getElementById('mainImage').src='${fullImg}'">`;
                    }).join('');
                }
            }
        } catch (e) {
            console.error("Lỗi parse hình ảnh:", e);
        }
    }
    document.getElementById('mainImage').src = mainImgSrc;

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
    if (!currentProduct) return;
    
    // Lấy tồn kho dựa trên việc có biến thể hay không
    const availableStock = selectedVariant 
        ? (selectedVariant.stock_quantity ?? currentProduct.stockQuantity) 
        : currentProduct.stockQuantity;

    if (availableStock <= 0) return;
    
    const qty = parseInt(document.getElementById('qtyInput').value);
    let cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    
    // Tạo cartItemId độc nhất: ghép id sản phẩm và id biến thể
    const variantSuffix = selectedVariant ? `_${selectedVariant.id}` : '';
    const cartItemId = `${currentProduct.id}${variantSuffix}`;

    const existingItem = cart.find(item => item.cartItemId === cartItemId);

    if (existingItem) {
        if (existingItem.quantity + qty > availableStock) {
            showToast(`Bạn chỉ có thể mua tối đa ${availableStock} sản phẩm phân loại này!`, true);
            return;
        }
        existingItem.quantity += qty;
    } else {
        let imgUrl = '../../images/image.png';
        try {
            const parsed = typeof currentProduct.imageUrls === 'string' ? JSON.parse(currentProduct.imageUrls) : currentProduct.imageUrls;
            if (parsed && parsed.length > 0) {
                let rawUrl = parsed[0];
                imgUrl = rawUrl.startsWith('/uploads') ? `${BACKEND_BASE_URL}${rawUrl}` : rawUrl;
            }
        } catch(e) {}

        // Tính giá cuối cùng
        const basePrice = parseFloat(currentProduct.price || 0);
        const adjustment = selectedVariant ? parseFloat(selectedVariant.price_adjustment || 0) : 0;

        cart.push({
            cartItemId: cartItemId, // ID dùng để gom nhóm trong giỏ
            id: currentProduct.id,
            variantId: selectedVariant ? selectedVariant.id : null,
            variantName: selectedVariant ? `${selectedVariant.attribute_name}: ${selectedVariant.attribute_value}` : '',
            name: currentProduct.name,
            price: basePrice + adjustment,
            image: imgUrl,
            sellerId: currentProduct.seller?.id,
            stock: availableStock,
            quantity: qty
        });
    }

    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
    
    const variantText = selectedVariant ? ` (${selectedVariant.attribute_value})` : '';
    showToast(`Đã thêm ${qty} sản phẩm${variantText} vào giỏ!`);
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

// ── 5. Xử lý Biến thể (Variants) ──────────────────────────

async function fetchProductVariants(productId) {
    try {
        // Giả định API endpoint là /variants/product/:id (dựa theo code của Seller)
        const response = await fetch(`${API_BASE_URL}/variants/product/${productId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        const data = await response.json();
        
        if (response.ok && data.success) {
            productVariants = data.data || [];
            renderVariantsUI();
        }
    } catch (error) {
        console.error("Không thể tải biến thể sản phẩm:", error);
    }
}

function renderVariantsUI() {
    const container = document.getElementById('variantsContainer');
    if (!container || productVariants.length === 0) {
        if(container) container.innerHTML = '';
        return;
    }

    // Nhóm các biến thể theo thuộc tính (VD: Tất cả size, Tất cả color)
    const attributesGroup = {};
    productVariants.forEach(variant => {
        if (!attributesGroup[variant.attribute_name]) {
            attributesGroup[variant.attribute_name] = [];
        }
        attributesGroup[variant.attribute_name].push(variant);
    });

    let html = '';
    for (const [attrName, variantsArr] of Object.entries(attributesGroup)) {
        html += `
            <div class="variant-group" style="margin-bottom: 12px;">
                <label style="font-weight: 600; display: block; margin-bottom: 8px; color: #475569; text-transform: capitalize;">
                    Chọn ${attrName}:
                </label>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        `;
        
        variantsArr.forEach(v => {
            // Đặt biến thể đầu tiên làm mặc định nếu chưa có
            if (!selectedVariant) selectedVariant = v;
            
            const isSelected = selectedVariant && selectedVariant.id === v.id;
            
            html += `
                <button class="btn-variant" 
                    onclick="selectVariant('${v.id}')"
                    style="padding: 6px 14px; 
                           border: 1px solid ${isSelected ? '#2563eb' : '#cbd5e1'}; 
                           background: ${isSelected ? '#eff6ff' : '#fff'}; 
                           color: ${isSelected ? '#2563eb' : '#334155'}; 
                           border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;
                           transition: all 0.2s;">
                    ${v.attribute_value}
                </button>
            `;
        });
        html += `</div></div>`;
    }
    
    container.innerHTML = html;
    updatePriceAndStockByVariant();
}

window.selectVariant = function(variantId) {
    selectedVariant = productVariants.find(v => String(v.id) === String(variantId));
    renderVariantsUI(); // Render lại để cập nhật CSS nút được chọn
}

function updatePriceAndStockByVariant() {
    if (!selectedVariant || !currentProduct) return;

    // Tính toán lại giá (Giá gốc + Giá điều chỉnh của biến thể)
    const basePrice = parseFloat(currentProduct.price || 0);
    const adjustment = parseFloat(selectedVariant.price_adjustment || 0);
    const finalPrice = basePrice + adjustment;

    // Cập nhật giao diện
    document.getElementById('productPrice').textContent = finalPrice.toLocaleString('vi-VN') + ' đ';
    
    // Ưu tiên hiển thị tồn kho của biến thể, nếu không có thì lấy tồn kho gốc
    const stock = selectedVariant.stock_quantity ?? currentProduct.stockQuantity ?? 0;
    document.getElementById('productStock').textContent = stock;

    // Cập nhật trạng thái nút Thêm vào giỏ
    const btn = document.getElementById('addCartBtn');
    const qtyInput = document.getElementById('qtyInput');
    
    if (stock <= 0) {
        btn.disabled = true;
        btn.textContent = "Hết hàng phân loại này";
        btn.style.background = "#cbd5e1";
        qtyInput.disabled = true;
    } else {
        btn.disabled = false;
        btn.textContent = "Thêm vào giỏ hàng";
        btn.style.background = ""; // Reset về css gốc
        qtyInput.disabled = false;
    }
}

// ── Khởi chạy ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        updateCartBadge();
        fetchProductDetail();
    }
});