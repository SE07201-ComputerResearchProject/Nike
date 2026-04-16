// ============================================================
// Seller Disputes List Page
// ============================================================

let currentUser = null;
let allDisputes = [];
let currentStatus = 'all';

// ============================================================
// Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Check authentication
    const userStr = localStorage.getItem('user');
    currentUser = userStr ? JSON.parse(userStr) : null;

    if (!currentUser || currentUser.role !== 'seller') {
      showToast('Vui lòng đăng nhập với tài khoản seller', 'error');
      setTimeout(() => {
        window.location.href = '../../../login.html';
      }, 1500);
      return;
    }

    // Update header
    const firstLetter = currentUser.username ? currentUser.username.charAt(0).toUpperCase() : 'U';
    document.getElementById('headerAvatar').textContent = firstLetter;

    // Load disputes
    await loadDisputes();

    // Setup event listeners
    setupEventListeners();
  } catch (error) {
    console.error('Initialization error:', error);
    showToast('Lỗi tải trang', 'error');
  }
});

// ============================================================
// Load Disputes
// ============================================================

async function loadDisputes() {
  try {
    const response = await fetchAPI('/seller/disputes');
    
    if (!response.success) {
      throw new Error(response.message || 'Lỗi tải danh sách tranh chấp');
    }

    allDisputes = response.data || [];
    renderDisputes();
  } catch (error) {
    console.error('Error loading disputes:', error);
    showToast(error.message, 'error');
  }
}

function renderDisputes() {
  const container = document.getElementById('disputesContainer');

  // Filter by status
  let filtered = allDisputes;
  if (currentStatus !== 'all') {
    filtered = allDisputes.filter(d => d.status === currentStatus);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">Không có tranh chấp nào</div>
        <div class="empty-state-description">
          ${currentStatus === 'all' 
            ? 'Bạn chưa có tranh chấp nào.' 
            : `Không có tranh chấp ở trạng thái "${getStatusLabel(currentStatus)}".`}
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(dispute => renderDisputeCard(dispute)).join('');
}

function renderDisputeCard(dispute) {
  const createdDate = formatDate(dispute.created_at);
  const createdTime = formatTime(dispute.created_at);
  const statusLabel = getStatusLabel(dispute.status);
  
  return `
    <div class="card dispute-card">
      <div>
        <div class="dispute-card-header">
          <div>
            <div class="dispute-id">Tranh chấp: ${dispute.id.substring(0, 8)}</div>
            <div class="dispute-reason">${escapeHtml(dispute.reason)}</div>
          </div>
        </div>
        <div class="dispute-info">
          <div class="dispute-info-item">
            <label>Đơn hàng:</label>
            <span>${dispute.order_id.substring(0, 8)}</span>
          </div>
          <div class="dispute-info-item">
            <label>Người mua:</label>
            <span>${dispute.complainant_username || 'N/A'}</span>
          </div>
          <div class="dispute-info-item">
            <label>Ngày tạo:</label>
            <span>${createdDate} ${createdTime}</span>
          </div>
        </div>
      </div>
      <div class="dispute-card-status">
        <div class="status-badge ${dispute.status.toLowerCase()}">
          ${statusLabel}
        </div>
        <div class="dispute-actions">
          <a href="../../dashboard-buyer/buyer-dispute-detail/index.html?id=${dispute.id}" class="btn btn-primary" style="text-decoration: none; display: inline-block;">
            Xem chi tiết
          </a>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners() {
  // Status tabs
  const statusTabs = document.querySelectorAll('.tab-btn');
  statusTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      statusTabs.forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentStatus = e.target.getAttribute('data-status');
      renderDisputes();
    });
  });

  // Logout button
  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    window.location.href = '../../../login.html';
  });
}

// ============================================================
// Utility Functions
// ============================================================

function getStatusLabel(status) {
  const labels = {
    'open': 'Mở',
    'in_progress': 'Đang xử lý',
    'resolved': 'Đã giải quyết',
    'closed': 'Đã đóng'
  };
  return labels[status] || status;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('vi-VN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
