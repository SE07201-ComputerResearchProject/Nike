// Safe buyer order detail script - all DOM accesses are null-checked
const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
// Extract base URL for image uploads (remove /api suffix)
const BACKEND_BASE_URL = API_BASE_URL.replace('/api', '') || 'http://localhost:5000';
let currentUser = null;
let currentOrderId = null;

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.1);`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Helper function to construct image URL
function getImageUrl(imagePath) {
  if (!imagePath) return `${BACKEND_BASE_URL}/uploads/default-placeholder.png`;
  
  // If it's already a full URL, return as is
  if (imagePath.startsWith('http')) return imagePath;
  
  // If it starts with /, prepend backend URL
  if (imagePath.startsWith('/')) return `${BACKEND_BASE_URL}${imagePath}`;
  
  // Otherwise prepend /uploads/
  return `${BACKEND_BASE_URL}/uploads/${imagePath}`;
}

function checkAuth() {
  const token = localStorage.getItem('accessToken');
  const userStr = localStorage.getItem('user');
  if (!token || !userStr) { window.location.href = '../../login.html'; return false; }

  currentUser = JSON.parse(userStr);
  if (currentUser.role !== 'buyer') { window.location.href = '../../login.html'; return false; }

  const headerAvatar = document.getElementById('headerAvatar');
  if (headerAvatar && currentUser.fullName) headerAvatar.textContent = currentUser.fullName.charAt(0).toUpperCase();
  updateCartBadge();
  return true;
}

function updateCartBadge() {
  try {
    const cartKey = `cart_${currentUser.id}`;
    const cartData = JSON.parse(localStorage.getItem(cartKey)) || [];
    const totalItems = cartData.length;
    const badge = document.getElementById('cartBadge');
    if (badge) {
      badge.textContent = totalItems;
      badge.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }
  } catch (e) {
    console.warn('updateCartBadge error', e);
  }
}

const safeParseJson = (v, fallback = null) => {
  if (!v) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

async function fetchOrderDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  currentOrderId = urlParams.get('id') || urlParams.get('orderId');

  if (!currentOrderId) {
    showToast('Mã đơn hàng không hợp lệ!', true);
    return;
  }

  // safe footer assignment
  const footerId = document.getElementById('transactionIdFooter');
  if (footerId) footerId.textContent = currentOrderId.toUpperCase();

  // UI elements cached and checked
  const orderDateEl = document.getElementById('orderDateHeader');
  const statusBadgeEl = document.getElementById('orderStatusBadge');
  const timelineEl = document.getElementById('orderTimeline');
  const itemsEl = document.getElementById('orderItems');
  const itemsSummaryEl = document.getElementById('orderItemsSummary');
  const shippingStreetEl = document.getElementById('shippingStreet');
  const shippingCityZipEl = document.getElementById('shippingCityZip');
  const shippingCountryEl = document.getElementById('shippingCountry');
  const subtotalEl = document.getElementById('subtotalPrice');
  const platformFeeEl = document.getElementById('platformFee');
  const shippingFeeEl = document.getElementById('shippingFee');
  const totalEl = document.getElementById('totalPrice');
  const escrowEl = document.getElementById('escrowStatus');
  const actionsEl = document.getElementById('orderActions');

  try {
    const response = await fetch(`${API_BASE_URL}/orders/${currentOrderId}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
    });
    const data = await response.json();

    if (!(response.ok && data && data.success)) {
      throw new Error(data?.message || 'Không thể tải dữ liệu đơn hàng.');
    }

    const order = data.data || {};

    console.log('Full order response:', order);
    if (order.items) console.log('Order items from API:', order.items);

    if (orderDateEl && order.createdAt) orderDateEl.textContent = new Date(order.createdAt).toLocaleString('vi-VN');
    if (statusBadgeEl) {
      statusBadgeEl.textContent = (order.status) ? (function(s){
        const map = { 'pending':'Chờ thanh toán','paid':'Đã thanh toán','shipped':'Đang giao hàng','completed':'Hoàn thành','cancelled':'Đã hủy','refunded':'Đã hoàn tiền' };
        return map[s] || s;
      })(order.status) : '...';
      statusBadgeEl.className = `status-badge ${order.status || ''}`;
    }

    // Normalize items (support old API shape)
    let items = order.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      const fallbackUnit = Number(order.unitPrice || order.unit_price || 0) || 0;
      const fallbackQty = Number(order.quantity || 1) || 1;
      const fallbackCategory = order.product?.category || order.category || 'Chưa xác định';
      items = [{
        product_name: order.product?.name || order.product_name || 'Sản phẩm',
        unit_price: fallbackUnit,
        quantity: fallbackQty,
        subtotal: (fallbackUnit * fallbackQty),
        category: fallbackCategory,
        seller_username: order.seller?.username || order.seller_username || 'Shop cung cấp'
      }];
    }

    console.log('Order items:', items);
    console.log('First item:', items[0]);
    if (items.length > 0) {
      console.log('Item categories:', items.map(i => ({ name: i.product_name, category: i.category })));
    }

    // render items and summary (functions guard DOM internally)
    renderOrderItems(items, order.seller || order.seller_username);
    renderOrderItemsSummary(items);

    // timeline and shipping
    renderProgressTimeline(order, timelineEl);
    if (shippingStreetEl) shippingStreetEl.textContent = order.shippingAddress?.street || order.shipping_address?.street || 'Chưa cung cấp';
    if (shippingCityZipEl) shippingCityZipEl.textContent = order.shippingAddress?.city || order.shipping_address?.city || '';
    if (shippingCountryEl) shippingCountryEl.textContent = order.shippingAddress?.country || order.shipping_address?.country || 'Việt Nam';

    // money calculations (NaN-safe)
    const subtotal = items.reduce((sum, item) => {
      const s = Number(item.subtotal) || (Number(item.unit_price || item.unitPrice || 0) * Number(item.quantity || 0));
      return sum + (isNaN(s) ? 0 : s);
    }, 0);
    const platformFee = Math.round(subtotal * 0.025);
    const shippingFee = Number(order.shippingFee || order.shipping_fee || 0) || 0;
    const finalTotal = Number(order.totalAmount || order.total_amount || (subtotal + platformFee + shippingFee)) || (subtotal + platformFee + shippingFee);

    if (subtotalEl) subtotalEl.textContent = subtotal.toLocaleString('vi-VN') + ' đ';
    if (platformFeeEl) platformFeeEl.textContent = platformFee.toLocaleString('vi-VN') + ' đ';
    if (shippingFeeEl) shippingFeeEl.textContent = shippingFee === 0 ? 'Miễn phí' : (shippingFee.toLocaleString('vi-VN') + ' đ');
    if (totalEl) totalEl.textContent = finalTotal.toLocaleString('vi-VN') + ' đ';

    if (escrowEl) escrowEl.textContent = (function(s){ const map = { 'pending':'Đang chờ ký quỹ','held':'Hệ thống tạm giữ','released':'Đã giải ngân cho Seller','returned':'Đã hoàn trả cho Buyer','refunded':'Đã hoàn tiền' }; return map[s] || (s||'N/A'); })(order.escrow?.status || order.escrow_status);

    // render actions
    renderActionButtons(order, actionsEl);

  } catch (error) {
    console.error('fetchOrderDetail error:', error);
    showToast('Lỗi: ' + (error.message || error), true);
    if (timelineEl) timelineEl.innerHTML = `<p style="color:red">Lỗi tải tiến trình: ${error.message || error}</p>`;
    if (itemsEl) itemsEl.innerHTML = `<p style="color:red">Lỗi tải sản phẩm.</p>`;
    if (itemsSummaryEl) itemsSummaryEl.innerHTML = `<p style="color:red">Lỗi tải thông tin tổng hợp.</p>`;
    const subtotalEl = document.getElementById('subtotalPrice'); if (subtotalEl) subtotalEl.textContent = '0 đ';
    const totalEl = document.getElementById('totalPrice'); if (totalEl) totalEl.textContent = '0 đ';
    const escrowElLocal = document.getElementById('escrowStatus'); if (escrowElLocal) escrowElLocal.textContent = 'N/A';
  }
}

function renderProgressTimeline(order, container) {
  if (!container) return;
  const stages = [
    { status: 'pending', title: 'Đã tạo đơn', date: order.createdAt || order.created_at },
    { status: 'paid', title: 'Đã thanh toán', date: null },
    { status: 'shipped', title: 'Đang giao hàng', date: null },
    { status: 'completed', title: 'Hoàn thành', date: order.completedAt || order.completed_at }
  ];
  const currentStageIndex = stages.findIndex(s => s.status === order.status);
  if (order.status === 'cancelled' || order.status === 'refunded') {
    stages.push({ status: order.status, title: order.status === 'cancelled' ? 'Đã hủy' : 'Đã hoàn tiền', date: order.cancelledAt || order.cancelled_at || order.updatedAt || order.updated_at });
  }

  container.innerHTML = stages.map((stage, index) => {
    const isActive = index <= currentStageIndex || stage.status === order.status;
    const stageDate = stage.date ? new Date(stage.date).toLocaleString('vi-VN') : '';
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

function renderOrderItems(items, seller) {
  const container = document.getElementById('orderItems');
  if (!container) return;
  container.style.padding = '0';

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<p class="muted" style="padding: 16px;">Không có sản phẩm nào.</p>';
    return;
  }

  // Get seller name from first item or fallback
  // Data comes from: backend orderItemModel.getWithProducts() -> seller_username
  let sellerName = 'Shop cung cấp';
  if (items.length > 0 && items[0].seller_username) {
    sellerName = items[0].seller_username;
  } else if (seller && seller.username) {
    sellerName = seller.username;
  } else if (typeof seller === 'string') {
    sellerName = seller;
  }
  
  let html = `<div style="padding: 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; background: #f8fafc;">🏬 ${sellerName}</div>`;

  html += items.map(item => {
    const qty = Number(item.quantity) || 1;
    const unit = Number(item.unit_price || item.unitPrice || 0) || 0;
    const name = item.product_name || item.productName || item.product?.name || 'Sản phẩm';
    
    // Get category from database - handle both string and null cases
    let category = 'Chưa xác định';
    if (item.category) {
      category = String(item.category).trim();
      // If category is still empty after trim, use fallback
      if (!category) category = 'Chưa xác định';
    }
    
    // Image selection logic: handle JSON array from backend, convert to URL
    // Backend returns image_urls as JSON array: ["filename1.png", "filename2.png"] or null
    let imageUrl = getImageUrl(null);
    
    const rawImageUrls = item.image_urls || item.image_url || item.productImage || item.product_image;
    
    // If it's a JSON string, parse it
    if (typeof rawImageUrls === 'string' && rawImageUrls.trim()) {
      try {
        // Try parsing as JSON array first
        if (rawImageUrls.trim().startsWith('[')) {
          const parsed = JSON.parse(rawImageUrls);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const firstImage = parsed[0];
            imageUrl = getImageUrl(firstImage);
          }
        } else {
          // Direct filename without array wrapper
          imageUrl = getImageUrl(rawImageUrls);
        }
      } catch (e) {
        // If parse fails, treat as direct path
        imageUrl = getImageUrl(rawImageUrls);
      }
    } else if (typeof rawImageUrls === 'object' && Array.isArray(rawImageUrls) && rawImageUrls.length > 0) {
      // Already parsed array
      imageUrl = getImageUrl(rawImageUrls[0]);
    }
    
    return `
      <div style="padding: 16px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between;">
        <div style="display: flex; gap: 16px;">
          <img src="${imageUrl}" onerror="this.src='${BACKEND_BASE_URL}/uploads/default-placeholder.png'" alt="SP" style="width: 80px; height: 80px; border-radius: 8px; border: 1px solid #e2e8f0; object-fit: cover;">
          <div>
            <span style="font-size: 15px; font-weight: 500; display: block; margin-bottom: 4px;">${name}</span>
            <p class="muted" style="margin: 0; font-size: 13px;">Phân loại: <strong>${category}</strong></p>
            <p class="muted" style="margin: 4px 0 0; font-size: 13px;">x${qty}</p>
          </div>
        </div>
        <div style="text-align: right; font-weight: 600; color: #e11d48;">${unit.toLocaleString('vi-VN')} đ</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function renderOrderItemsSummary(items) {
  const container = document.getElementById('orderItemsSummary');
  if (!container) return;
  container.innerHTML = items.map(item => {
    const qty = Number(item.quantity) || 1;
    const unit = Number(item.unit_price || item.unitPrice || 0) || 0;
    const name = item.product_name || item.product?.name || 'Sản phẩm';
    return `
      <div class="summary-row" style="margin-bottom: 8px; font-size: 14px;">
        <span style="color: #64748b;">${qty}x ${name}</span>
        <strong style="color: #0f172a;">${(unit * qty).toLocaleString('vi-VN')} đ</strong>
      </div>
    `;
  }).join('');
}

function renderActionButtons(order, container) {
  if (!container) return;
  let btns = '';
  const id = order.id || order.orderId || null;
  if (order.status === 'shipped') {
    btns += `<button class="btn btn-primary" style="width: 100%;" onclick="confirmDelivery('${id}')">✅ Đã nhận được hàng (Giải ngân)</button>`;
    btns += `<button class="btn btn-outline" style="color: #ef4444; border-color: #ef4444; width: 100%; margin-top: 10px;" onclick="window.location.href='../buyer-orders/index.html?idForDispute=${id}'">⚠️ Hàng lỗi / Khiếu nại</button>`;
  } else if (order.status === 'completed') {
    btns += `<button class="btn btn-outline" style="width: 100%;" onclick="window.location.href='../buyer-reviews/index.html?orderId=${id}'">⭐ Đánh giá sản phẩm</button>`;
  }
  container.innerHTML = btns;
}

window.confirmDelivery = async function(orderId) {
  if (!orderId) return;
  if (!confirm('Xác nhận bạn đã nhận đủ hàng và hàng đúng mô tả? Hệ thống sẽ giải ngân Ký quỹ cho người bán ngay lập tức.')) return;
  const actionBtn = document.querySelector('#orderActions button');
  if (actionBtn) { actionBtn.disabled = true; actionBtn.textContent = 'Đang giải ngân...'; }

  try {
    const response = await fetch(`${API_BASE_URL}/orders/${orderId}/confirm-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
    });
    const data = await response.json();
    if (response.ok && data.success) {
      showToast('Đã giải ngân tiền thành công cho người bán!');
      fetchOrderDetail();
    } else {
      throw new Error(data.message || 'Lỗi xử lý giải ngân.');
    }
  } catch (err) {
    showToast(err.message || err, true);
    if (actionBtn) { actionBtn.disabled = false; actionBtn.textContent = '✅ Đã nhận được hàng (Giải ngân)'; }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (checkAuth()) fetchOrderDetail();
  const logoutBtn = document.getElementById('logoutBtn'); if (logoutBtn) logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('accessToken'); localStorage.removeItem('refreshToken'); localStorage.removeItem('user'); window.location.href = '../../login.html';
  });
});
