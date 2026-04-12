// ============================================================
// Dispute Detail Page - Chat & Negotiation Logic
// ============================================================

let currentDispute = null;
let currentUser = null;
let chatPage = 1;
let chatHasMore = true;
let pollInterval = null;
let attachedUrls = [];

const CHAT_PAGE_SIZE = 20;
const POLL_INTERVAL = 3000; // 3 seconds

// ============================================================
// Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Load current user
    const userStr = localStorage.getItem('user');
    currentUser = userStr ? JSON.parse(userStr) : null;

    if (!currentUser) {
      showToast('Vui lòng đăng nhập', 'error');
      setTimeout(() => {
        window.location.href = '../../../login.html';
      }, 1500);
      return;
    }

    // Get dispute ID from URL
    const disputeId = getDisputeIdFromURL();
    if (!disputeId) {
      showToast('Không tìm thấy tranh chấp', 'error');
      setTimeout(() => window.history.back(), 1500);
      return;
    }

    // Load dispute details
    await loadDisputeDetails(disputeId);

    // Load initial chat messages
    await loadChatMessages(disputeId);

    // Set up event listeners
    setupEventListeners(disputeId);

    // Start polling for new messages
    startPolling(disputeId);

    // Mark messages as read
    await markChatAsRead(disputeId);

    // Update header info
    updateHeader();
  } catch (error) {
    console.error('Initialization error:', error);
    showToast('Lỗi tải trang', 'error');
  }
});

// Stop polling when page is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    const disputeId = getDisputeIdFromURL();
    startPolling(disputeId);
  }
});

// ============================================================
// Dispute Loading
// ============================================================

async function loadDisputeDetails(disputeId) {
  try {
    const response = await fetchAPI(`/disputes/${disputeId}`);
    
    if (!response.success) {
      throw new Error(response.message || 'Lỗi tải thông tin tranh chấp');
    }

    currentDispute = response.data;
    renderDisputeInfo();
    renderEvidenceGallery();
    renderOrderSummary();
    renderDisputeTimeline();
  } catch (error) {
    console.error('Error loading dispute:', error);
    showToast(error.message, 'error');
    throw error;
  }
}

function renderDisputeInfo() {
  if (!currentDispute) return;

  // Header info
  document.getElementById('disputeIdHeader').textContent = currentDispute.id.substring(0, 8);
  
  // Status badge
  const statusBadge = document.getElementById('disputeStatusBadge');
  statusBadge.className = `status-badge ${currentDispute.status.toLowerCase()}`;
  statusBadge.textContent = getStatusLabel(currentDispute.status);

  // Date created
  document.getElementById('disputeDateCreated').textContent = formatDate(currentDispute.created_at);

  // Dispute reason
  document.getElementById('disputeReason').textContent = currentDispute.reason;
  document.getElementById('disputeStatus').textContent = getStatusLabel(currentDispute.status);
  document.getElementById('sellerName').textContent = currentDispute.seller_name || 'N/A';
  document.getElementById('orderIdInfo').textContent = currentDispute.order_id.substring(0, 8);
}

function renderEvidenceGallery() {
  if (!currentDispute) return;

  const gallery = document.getElementById('evidenceGallery');
  const evidenceUrls = currentDispute.evidence_urls || [];

  if (!Array.isArray(evidenceUrls) || evidenceUrls.length === 0) {
    gallery.innerHTML = '<p class="muted">Chưa có bằng chứng</p>';
    return;
  }

  gallery.innerHTML = evidenceUrls.map((url, idx) => {
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
    const isVideo = /\.(mp4|webm|mov)$/i.test(url);
    
    if (isImage) {
      return `
        <div class="evidence-item" onclick="viewEvidence('${url}')">
          <img src="${url}" alt="Bằng chứng ${idx + 1}" onerror="this.style.display='none'">
          <div class="evidence-item-overlay">
            <span class="icon">👁️</span>
          </div>
        </div>
      `;
    } else if (isVideo) {
      return `
        <div class="evidence-item" onclick="viewEvidence('${url}')">
          <video style="width: 100%; height: 100%; object-fit: cover;">
            <source src="${url}" type="video/mp4">
          </video>
          <div class="evidence-item-overlay">
            <span class="icon">▶️</span>
          </div>
        </div>
      `;
    } else {
      const filename = url.split('/').pop();
      return `
        <div class="evidence-item document">
          <a href="${url}" target="_blank" title="${filename}">📄</a>
        </div>
      `;
    }
  }).join('');
}

function renderOrderSummary() {
  if (!currentDispute) return;

  const order = currentDispute.order || {};
  
  // Products
  const productsSummary = document.getElementById('orderProductsSummary');
  if (order.items && order.items.length > 0) {
    productsSummary.innerHTML = order.items.map(item => `
      <div class="product-summary-item">
        <div class="product-summary-item-name">${item.product_name || 'Sản phẩm'}</div>
        <div class="product-summary-item-qty">Số lượng: ${item.quantity || 1}</div>
        <div class="product-summary-item-price">${formatPrice(item.price || 0)} đ</div>
      </div>
    `).join('');
  }

  // Pricing
  const subtotal = order.subtotal || 0;
  const platformFee = subtotal * 0.025; // 2.5%
  const shippingFee = order.shipping_fee || 0;
  const total = subtotal + platformFee + shippingFee;

  document.getElementById('subtotalPrice').textContent = formatPrice(subtotal) + ' đ';
  document.getElementById('platformFee').textContent = formatPrice(platformFee) + ' đ';
  document.getElementById('shippingFee').textContent = formatPrice(shippingFee) + ' đ';
  document.getElementById('totalPrice').textContent = formatPrice(total) + ' đ';
}

function renderDisputeTimeline() {
  if (!currentDispute) return;

  const timeline = document.getElementById('disputeTimeline');
  const events = [];

  // Created event
  if (currentDispute.created_at) {
    events.push({
      time: currentDispute.created_at,
      text: 'Tranh chấp được tạo'
    });
  }

  // Resolved event
  if (currentDispute.resolved_at) {
    events.push({
      time: currentDispute.resolved_at,
      text: `Tranh chấp đã được giải quyết: ${currentDispute.resolution}`
    });
  }

  if (events.length === 0) {
    timeline.innerHTML = '<p class="muted">Chưa có sự kiện</p>';
    return;
  }

  timeline.innerHTML = events.map(event => `
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-time">${formatDate(event.time)}</div>
        <div class="timeline-text">${event.text}</div>
      </div>
    </div>
  `).join('');
}

// ============================================================
// Chat Loading & Display
// ============================================================

async function loadChatMessages(disputeId, page = 1) {
  try {
    const response = await fetchAPI(`/disputes/${disputeId}/chat?page=${page}&limit=${CHAT_PAGE_SIZE}`);
    
    if (!response.success) {
      throw new Error(response.message || 'Lỗi tải tin nhắn');
    }

    const messages = response.data || [];
    
    if (page === 1) {
      // First load - clear and display all messages
      const container = document.getElementById('chatMessagesContainer');
      if (messages.length === 0) {
        container.innerHTML = '<p class="muted" style="text-align: center;">Chưa có tin nhắn nào</p>';
      } else {
        container.innerHTML = messages.map(msg => renderChatMessage(msg)).join('');
        container.scrollTop = container.scrollHeight;
      }
    } else {
      // Load more - prepend messages
      const container = document.getElementById('chatMessagesContainer');
      const newMessages = messages.map(msg => renderChatMessage(msg)).join('');
      container.innerHTML = newMessages + container.innerHTML;
    }

    chatHasMore = messages.length === CHAT_PAGE_SIZE;
    updateLoadMoreButton();
  } catch (error) {
    console.error('Error loading chat:', error);
    showToast(error.message, 'error');
  }
}

function renderChatMessage(message) {
  const isSent = message.sender_id === currentUser.id;
  const bubbleClass = isSent ? 'sent' : 'received';
  
  const time = formatTime(message.created_at);
  const senderName = message.sender_username || 'Người dùng';
  const senderInitial = senderName.charAt(0).toUpperCase();

  let attachmentsHtml = '';
  if (message.attachments && message.attachments.length > 0) {
    const attachmentItems = message.attachments.map(url => {
      const filename = url.split('/').pop();
      return `<a href="${url}" target="_blank" class="attachment-link">📎 ${filename}</a>`;
    }).join('');
    attachmentsHtml = `<div class="message-attachments">${attachmentItems}</div>`;
  }

  return `
    <div class="chat-message ${bubbleClass}">
      <div>
        <div class="chat-message-sender">
          <div class="avatar">${senderInitial}</div>
          <span>${senderName}</span>
        </div>
        <div class="bubble">
          ${escapeHtml(message.message)}
          ${attachmentsHtml}
        </div>
        <div class="chat-message-time">${time}</div>
      </div>
    </div>
  `;
}

function updateLoadMoreButton() {
  const btn = document.getElementById('loadMoreBtn');
  if (chatHasMore && chatPage < 5) { // Limit to prevent too many requests
    btn.style.display = 'block';
  } else {
    btn.style.display = 'none';
  }
}

// ============================================================
// Chat Interaction
// ============================================================

async function sendMessage(disputeId, messageText, attachmentUrls = []) {
  try {
    if (!messageText.trim()) {
      showToast('Vui lòng nhập tin nhắn', 'error');
      return;
    }

    const payload = {
      message: messageText.trim(),
      attachments: attachmentUrls
    };

    const response = await fetchAPI(`/disputes/${disputeId}/chat`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!response.success) {
      throw new Error(response.message || 'Lỗi gửi tin nhắn');
    }

    // Clear form
    document.getElementById('messageInput').value = '';
    attachedUrls = [];
    document.getElementById('attachmentPreview').innerHTML = '';

    showToast('Tin nhắn đã gửi', 'success');

    // Reload chat
    chatPage = 1;
    await loadChatMessages(disputeId);
    await markChatAsRead(disputeId);
  } catch (error) {
    console.error('Error sending message:', error);
    showToast(error.message, 'error');
  }
}

async function markChatAsRead(disputeId) {
  try {
    await fetchAPI(`/disputes/${disputeId}/chat/read`, {
      method: 'PUT'
    });
  } catch (error) {
    // Silent fail - not critical
    console.warn('Failed to mark chat as read:', error);
  }
}

function startPolling(disputeId) {
  if (pollInterval) {
    clearInterval(pollInterval);
  }

  pollInterval = setInterval(async () => {
    await loadChatMessages(disputeId);
    await markChatAsRead(disputeId);
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ============================================================
// Event Listeners Setup
// ============================================================

function setupEventListeners(disputeId) {
  // Send message form
  document.getElementById('sendMessageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageText = document.getElementById('messageInput').value;
    await sendMessage(disputeId, messageText, attachedUrls);
  });

  // Attach button
  document.getElementById('attachButton').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  // File input
  document.getElementById('fileInput').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    
    if (files.length === 0) return;

    // Show preview of URLs (in real app, would upload to CDN first)
    const preview = document.getElementById('attachmentPreview');
    preview.innerHTML = files.map((file, idx) => `
      <div class="attachment-preview-item">
        📎 ${file.name}
        <span class="remove-btn" onclick="removeAttachment(${idx})">✕</span>
      </div>
    `).join('');

    showToast('Vui lòng dán URL sau khi tải tệp lên CDN', 'info');
  });

  // Load more button
  document.getElementById('loadMoreBtn').addEventListener('click', async () => {
    chatPage++;
    await loadChatMessages(disputeId, chatPage);
  });

  // Logout button
  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    window.location.href = '../../../login.html';
  });
}

function removeAttachment(index) {
  attachedUrls.splice(index, 1);
  const preview = document.getElementById('attachmentPreview');
  if (attachedUrls.length === 0) {
    preview.innerHTML = '';
  } else {
    preview.innerHTML = attachedUrls.map((url, idx) => `
      <div class="attachment-preview-item">
        📎 ${url.split('/').pop()}
        <span class="remove-btn" onclick="removeAttachment(${idx})">✕</span>
      </div>
    `).join('');
  }
}

// ============================================================
// Evidence Modal
// ============================================================

function viewEvidence(url) {
  const modal = document.getElementById('evidenceModal');
  const image = document.getElementById('evidenceImage');
  image.src = url;
  modal.classList.add('active');
}

function closeEvidenceModal() {
  const modal = document.getElementById('evidenceModal');
  modal.classList.remove('active');
}

// ============================================================
// Utility Functions
// ============================================================

function getDisputeIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

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
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatPrice(price) {
  if (typeof price !== 'number') {
    price = parseFloat(price) || 0;
  }
  return Math.round(price).toLocaleString('vi-VN');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateHeader() {
  const user = currentUser;
  if (user) {
    const firstLetter = user.username ? user.username.charAt(0).toUpperCase() : 'U';
    document.getElementById('headerAvatar').textContent = firstLetter;
  }
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

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  const modal = document.getElementById('evidenceModal');
  if (e.target === modal) {
    closeEvidenceModal();
  }
});
