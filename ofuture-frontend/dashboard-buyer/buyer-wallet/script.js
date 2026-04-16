// dashboard-buyer/buyer-wallet/script.js

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentPage = 1;
const pageSize = 10;
let selectedPaymentMethod = null;

// ── 1. HÀM HỖ TRỢ: LẤY TOKEN VÀ KIỂM TRA ĐĂNG NHẬP ──
function getToken() {
  // Quét cả 2 key để tránh lỗi bất nhất tên biến giữa các trang
  return localStorage.getItem('accessToken') || localStorage.getItem('token');
}

function checkAuth() {
  const token = getToken();
  const userStr = localStorage.getItem('user');
  
  if (!token || !userStr) { 
    window.location.href = '../../login.html'; 
    return false; 
  }
  
  // Hiển thị Avatar góc phải
  const currentUser = JSON.parse(userStr);
  const nameToUse = currentUser.fullName || currentUser.full_name || currentUser.username || 'U';
  const avatarEl = document.getElementById('headerAvatar');
  if (avatarEl) avatarEl.textContent = nameToUse.charAt(0).toUpperCase();
  
  return true;
}

// ── 2. KHỞI TẠO TRANG ──
document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return; // Dừng chạy API nếu chưa đăng nhập

  await loadWalletBalance();
  await loadTransactions();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('typeFilter').addEventListener('change', () => {
    currentPage = 1;
    loadTransactions();
  });
  document.getElementById('withdrawForm').addEventListener('submit', handleWithdraw);
}

// Load wallet balance
async function loadWalletBalance() {
  try {
    const response = await fetch(`${API_BASE_URL}/wallet/balance`, {
      headers: {
        'Authorization': `Bearer ${getToken()}`
      }
    });

    if (!response.ok) throw new Error('Failed to load wallet balance');

    const data = await response.json();
    if (data.success) {
      document.getElementById('walletBalance').textContent = data.data.formattedBalance;
    }
  } catch (error) {
    console.error('Error loading wallet balance:', error);
    showToast('Lỗi khi tải số dư ví', 'error');
  }
}

// Load transactions
async function loadTransactions() {
  try {
    const typeFilter = document.getElementById('typeFilter').value;
    const params = new URLSearchParams({
      page: currentPage,
      limit: pageSize
    });

    const response = await fetch(`${API_BASE_URL}/wallet/transactions?${params}`, {
      headers: {
        'Authorization': `Bearer ${getToken()}`
      }
    });

    if (!response.ok) throw new Error('Failed to load transactions');

    const data = await response.json();
    if (data.success) {
      renderTransactions(data.data.transactions, typeFilter);
      updatePagination(data.data.pagination);
    }
  } catch (error) {
    console.error('Error loading transactions:', error);
    showToast('Lỗi khi tải lịch sử giao dịch', 'error');
  }
}

// Render transactions
function renderTransactions(transactions, typeFilter) {
  const container = document.getElementById('transactionsContainer');

  if (!transactions || transactions.length === 0) {
    container.innerHTML = `
      <div class="no-transactions">
        <p>📭 Chưa có giao dịch nào</p>
      </div>
    `;
    return;
  }

  // Filter transactions if needed
  let filtered = transactions;
  if (typeFilter) {
    filtered = transactions.filter(t => t.type === typeFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="no-transactions">
        <p>📭 Không có giao dịch loại này</p>
      </div>
    `;
    return;
  }

  const html = filtered.map(txn => {
    const icon = getTransactionIcon(txn.type);
    const sign = ['deposit', 'transfer_in'].includes(txn.type) ? '+' : '-';
    const typeClass = txn.type;
    const description = getTransactionDescription(txn);

    return `
      <div class="transaction-item" onclick="showTransactionDetail('${txn.id}')">
        <div class="transaction-left">
          <div class="transaction-icon ${typeClass}">${icon}</div>
          <div class="transaction-info">
            <h4>${getTransactionType(txn.type)}</h4>
            <p>${description}</p>
          </div>
        </div>
        <div class="transaction-right">
          <p class="transaction-amount ${typeClass}">${sign}${txn.amount}</p>
          <p class="transaction-date">${formatDate(txn.createdAt)}</p>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// Get transaction icon
function getTransactionIcon(type) {
  const icons = {
    'deposit': '💰',
    'withdrawal': '💸',
    'transfer_in': '📥',
    'transfer_out': '📤',
    'platform_fee': '🏛️',
    'adjustment': '⚙️'
  };
  return icons[type] || '💱';
}

// Get transaction type label
function getTransactionType(type) {
  const labels = {
    'deposit': 'Nạp tiền',
    'withdrawal': 'Rút tiền',
    'transfer_in': 'Tiền nhận',
    'transfer_out': 'Tiền chi',
    'platform_fee': 'Phí nền tảng',
    'adjustment': 'Điều chỉnh'
  };
  return labels[type] || type;
}

// Get transaction description
function getTransactionDescription(txn) {
  if (txn.description) return txn.description;
  if (txn.referenceType) return `Liên quan đến ${txn.referenceType}`;
  return getTransactionType(txn.type);
}

// Update pagination
function updatePagination(pagination) {
  const container = document.getElementById('paginationContainer');
  const pageInfo = document.getElementById('pageInfo');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  if (pagination.totalPages <= 1) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  pageInfo.textContent = `Trang ${pagination.page}/${pagination.totalPages} (${pagination.total} giao dịch)`;

  prevBtn.disabled = pagination.page === 1;
  nextBtn.disabled = pagination.page === pagination.totalPages;
}

// Pagination handlers
function previousPage() {
  if (currentPage > 1) {
    currentPage--;
    loadTransactions();
    window.scrollTo(0, 0);
  }
}

function nextPage() {
  currentPage++;
  loadTransactions();
  window.scrollTo(0, 0);
}

// Show transaction detail
async function showTransactionDetail(transactionId) {
  try {
    const response = await fetch(`${API_BASE_URL}/wallet/transactions/${transactionId}`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      }
    });

    if (!response.ok) throw new Error('Failed to load transaction detail');

    const data = await response.json();
    if (data.success) {
      const txn = data.data;
      showToast(`
        ${getTransactionType(txn.type)}: ${txn.formattedAmount}
        ${txn.description ? '\n' + txn.description : ''}
        Status: ${txn.status}
      `, 'info');
    }
  } catch (error) {
    console.error('Error loading transaction detail:', error);
  }
}

// Modal functions
function openDepositModal() {
  document.getElementById('depositModal').classList.add('active');
  selectedPaymentMethod = null;
  document.getElementById('depositForm').style.display = 'none';
}

function closeDepositModal() {
  document.getElementById('depositModal').classList.remove('active');
  selectedPaymentMethod = null;
  document.getElementById('depositForm').style.display = 'none';
}

function openWithdrawModal() {
  document.getElementById('withdrawModal').classList.add('active');
}

function closeWithdrawModal() {
  document.getElementById('withdrawModal').classList.remove('active');
}

function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  // Update UI to show selected method
  document.querySelectorAll('.payment-method').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.closest('.payment-method').classList.add('active');
  // Show deposit form
  document.getElementById('depositForm').style.display = 'block';
}

// Process deposit
async function processDeposit() {
  if (!selectedPaymentMethod) {
    showToast('Vui lòng chọn phương thức thanh toán', 'error');
    return;
  }

  const amount = document.getElementById('depositAmount').value;
  if (!amount || amount < 10000) {
    showToast('Số tiền tối thiểu là 10,000 đ', 'error');
    return;
  }

  try {
    const currentUser = JSON.parse(localStorage.getItem('user'));
    const response = await fetch(`${API_BASE_URL}/payments/${selectedPaymentMethod}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        amount: parseInt(amount),
        orderId: currentUser.id // BẮT BUỘC THÊM DÒNG NÀY (Xem giải thích ở Bước 3)
      })
    });

    const data = await response.json();
    if (data.success) {
      showToast('Đã tạo yêu cầu thanh toán. Vui lòng hoàn tất thanh toán.', 'success');
      // Redirect to payment URL or show payment UI
      if (data.data.payUrl) {
        window.location.href = data.data.payUrl;
      }
      closeDepositModal();
    } else {
      showToast(data.message || 'Lỗi khi tạo yêu cầu thanh toán', 'error');
    }
  } catch (error) {
    console.error('Error processing deposit:', error);
    showToast('Lỗi khi xử lý nạp tiền', 'error');
  }
}

// Handle withdraw
async function handleWithdraw(e) {
  e.preventDefault();

  const amount = document.getElementById('withdrawAmount').value;
  const bankAccount = document.getElementById('bankAccount').value;

  if (!amount || amount < 50000) {
    showToast('Số tiền tối thiểu là 50,000 đ', 'error');
    return;
  }

  if (!bankAccount) {
    showToast('Vui lòng chọn tài khoản ngân hàng', 'error');
    return;
  }

  try {
    // Call withdrawal API (to be implemented on backend)
    showToast('Chức năng rút tiền sẽ được cập nhật sớm', 'warning');
    closeWithdrawModal();
  } catch (error) {
    console.error('Error processing withdrawal:', error);
    showToast('Lỗi khi xử lý rút tiền', 'error');
  }
}

// Utility functions
function formatDate(dateString) {
  const date = new Date(dateString);
  const timeStr = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString('vi-VN');
  
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return `Hôm nay, ${timeStr}`;
  } else if (date.toDateString() === yesterday.toDateString()) {
    return `Hôm qua, ${timeStr}`;
  }
  // Sẽ hiển thị dạng: 14:30 - 15/04/2026
  return `${timeStr} - ${dateStr}`; 
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    background: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : type === 'warning' ? '#ffc107' : '#17a2b8'};
    color: ${type === 'warning' ? '#333' : 'white'};
    padding: 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    animation: slideIn 0.3s ease;
  `;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 5000);
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
  window.location.href = '../../login.html';
}

// Close modal when clicking outside
window.addEventListener('click', (e) => {
  const depositModal = document.getElementById('depositModal');
  const withdrawModal = document.getElementById('withdrawModal');

  if (e.target === depositModal) {
    closeDepositModal();
  }
  if (e.target === withdrawModal) {
    closeWithdrawModal();
  }
});
