const API_URL = 'http://localhost:5000/api';
let cart = JSON.parse(localStorage.getItem('cart')) || [];

function getAccessToken() {
    return localStorage.getItem('accessToken') ||
           localStorage.getItem('token') ||
           localStorage.getItem('jwt') ||
           localStorage.getItem('access_token');
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

function renderCart() {
    const cartList = document.getElementById('cartList');
    
    if (cart.length === 0) {
        cartList.innerHTML = `
            <div class="empty-cart">
                <h2>Giỏ hàng trống</h2>
                <p>Hãy thêm sản phẩm vào giỏ hàng để tiếp tục mua sắm</p>
                <a href="product.html">Xem sản phẩm</a>
            </div>
        `;
        const checkoutBtn = document.getElementById('checkoutBtn');
        if (checkoutBtn) checkoutBtn.disabled = true;
        updateSummary();
        return;
    }

    cartList.innerHTML = cart.map((item, index) => `
        <div class="cart-item">
            <img src="${item.image || 'https://via.placeholder.com/120'}" alt="${item.name}" class="item-image">
            <div class="item-details">
                <h3>${item.name}</h3>
                <p>Người bán: ${item.sellerUsername}</p>
                <p>Còn lại: ${item.stock} sản phẩm</p>
                <div class="item-price">${formatPrice(item.price)}</div>
            </div>
            <div class="item-actions">
                <div class="quantity-control">
                    <button onclick="updateQuantity(${index}, -1)">−</button>
                    <span>${item.quantity}</span>
                    <button onclick="updateQuantity(${index}, 1)">+</button>
                </div>
                <button class="btn-remove" onclick="removeItem(${index})">Xóa</button>
            </div>
        </div>
    `).join('');

    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) checkoutBtn.disabled = false;
    updateSummary();
}

function updateQuantity(index, change) {
    const item = cart[index];
    const newQuantity = item.quantity + change;
    if (newQuantity < 1) return removeItem(index);
    if (newQuantity > item.stock) {
        showToast('Số lượng vượt quá tồn kho', 'error');
        return;
    }
    cart[index].quantity = newQuantity;
    localStorage.setItem('cart', JSON.stringify(cart));
    renderCart();
}

function removeItem(index) {
    cart.splice(index, 1);
    localStorage.setItem('cart', JSON.stringify(cart));
    renderCart();
    showToast('Đã xóa sản phẩm khỏi giỏ hàng');
}

function updateSummary() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const platformFee = subtotal * 0.025;
    const total = subtotal + platformFee;

    document.getElementById('subtotal').textContent = formatPrice(subtotal);
    document.getElementById('platformFee').textContent = formatPrice(platformFee);
    document.getElementById('total').textContent = formatPrice(total);
}

async function proceedToCheckout() {
    if (cart.length === 0) { showToast('Giỏ hàng trống', 'error'); return; }

    const accessToken = getAccessToken();
    if (!accessToken) {
        showToast('Bạn chưa đăng nhập. Vui lòng đăng nhập lại.', 'error');
        setTimeout(() => window.location.href = 'login.html', 1500);
        return;
    }

    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) checkoutBtn.disabled = true;

    try {
        showToast('Đang tạo đơn hàng...', 'success');
        const orderIds = [];

        for (const item of cart) {
            // FIX: use fetchAPI wrapper — it injects Authorization header automatically
            const result = await fetchAPI('/orders', {
                method : 'POST',
                body   : JSON.stringify({
                    productId       : item.id,
                    quantity        : item.quantity,
                    shippingAddress : { street: 'TBD', city: 'TBD', country: 'Vietnam', zip: '000000' },
                    notes           : '',
                }),
            });
            orderIds.push(result.data.orderId);
        }

        localStorage.setItem('currentOrderIds',  JSON.stringify(orderIds));
        localStorage.setItem('checkoutCart',      JSON.stringify(cart));
        showToast(`Đã tạo ${orderIds.length} đơn hàng!`, 'success');
        window.location.href = `checkout.html?orders=${orderIds.join(',')}`;
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Tạo đơn hàng thất bại', 'error');
    } finally {
        if (checkoutBtn) checkoutBtn.disabled = false;
    }
}

function addToCart(product) {
    const existingIndex = cart.findIndex(item => item.id === product.id);

    if (existingIndex >= 0) {
        const newQuantity = cart[existingIndex].quantity + 1;
        if (newQuantity > product.stock) {
            showToast('Số lượng vượt quá tồn kho', 'error');
            return;
        }
        cart[existingIndex].quantity = newQuantity;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.imageUrls?.[0],
            sellerUsername: product.sellerUsername,
            stock: product.stockQuantity,
            quantity: 1
        });
    }

    localStorage.setItem('cart', JSON.stringify(cart));
    showToast('Đã thêm vào giỏ hàng');
}

// Initialize
renderCart();