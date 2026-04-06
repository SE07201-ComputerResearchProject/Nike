// review.js — FIXED
// Changes:
//   1. Fixed element ID references: "body" (was "content"), "myReviewsList" (was "reviewsList")
//   2. orderId now read from URL params and displayed, not from a stale select
//   3. All fetch() calls replaced with fetchAPI()
//   4. loadMyReviews populates the correct container
//   5. Added login guard

const API_URL  = 'http://localhost:5000/api';

// Read params from URL (set by orders.js writeReview redirect)
const urlParams  = new URLSearchParams(window.location.search);
const orderId    = urlParams.get('orderId');
const productId  = urlParams.get('productId');

let selectedRating = 0;

// Guard: redirect if not logged in
if (!localStorage.getItem('accessToken')) {
  window.location.href = 'login.html';
}

// ── Toast ─────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className   = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── Star rating interaction ───────────────────────────────
document.querySelectorAll('.star').forEach(star => {
  star.addEventListener('click', () => {
    selectedRating = parseInt(star.dataset.rating);
    const hiddenRating = document.getElementById('rating');
    if (hiddenRating) hiddenRating.value = selectedRating;
    updateStars();
  });

  star.addEventListener('mouseenter', () => {
    const rating = parseInt(star.dataset.rating);
    document.querySelectorAll('.star').forEach((s, index) => {
      s.classList.toggle('active', index < rating);
    });
  });
});

const starRating = document.querySelector('.star-rating');
if (starRating) {
  starRating.addEventListener('mouseleave', updateStars);
}

function updateStars() {
  document.querySelectorAll('.star').forEach((s, index) => {
    s.classList.toggle('active', index < selectedRating);
  });
}

// ── Show/hide form based on URL params ───────────────────
document.addEventListener('DOMContentLoaded', () => {
  const noOrderMessage  = document.getElementById('noOrderMessage');
  const reviewForm      = document.getElementById('reviewForm');
  const selectedOrderEl = document.getElementById('selectedOrderInfo');
  const selectedOrderId = document.getElementById('selectedOrderId');

  if (!orderId) {
    // No order in URL: hide form, show message
    if (noOrderMessage)  noOrderMessage.style.display  = 'block';
    if (reviewForm)      reviewForm.style.display      = 'none';
  } else {
    // Show which order we're reviewing
    if (noOrderMessage)  noOrderMessage.style.display  = 'none';
    if (reviewForm)      reviewForm.style.display      = 'block';
    if (selectedOrderEl) selectedOrderEl.style.display = 'block';
    if (selectedOrderId) selectedOrderId.textContent   = '#' + orderId.substring(0, 8).toUpperCase();
  }

  loadMyReviews();
});

// ── Submit review ─────────────────────────────────────────
const reviewForm = document.getElementById('reviewForm');
if (reviewForm) {
  reviewForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!orderId) {
      showToast('Không tìm thấy thông tin đơn hàng', 'error');
      return;
    }

    if (selectedRating === 0) {
      showToast('Vui lòng chọn số sao đánh giá', 'error');
      return;
    }

    const title = (document.getElementById('title')?.value || '').trim();
    // FIX: correct ID is "body" (matching review.html)
    const body  = (document.getElementById('body')?.value  || '').trim();

    if (!body) {
      showToast('Vui lòng nhập nội dung đánh giá', 'error');
      return;
    }

    const submitBtn = reviewForm.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Đang gửi...'; }

    try {
      await fetchAPI('/reviews', {
        method : 'POST',
        body   : JSON.stringify({
          orderId,
          rating : selectedRating,
          title  : title || null,
          body,
        }),
      });

      showToast('Gửi đánh giá thành công!');

      // Reset form
      reviewForm.reset();
      selectedRating = 0;
      updateStars();

      // Reload my reviews list
      loadMyReviews();

      // Redirect back to orders after short delay
      setTimeout(() => { window.location.href = 'orders.html'; }, 2000);

    } catch (error) {
      showToast(error.message || 'Không thể gửi đánh giá', 'error');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Review'; }
    }
  });
}

// ── Load my reviews ───────────────────────────────────────
// FIX: uses fetchAPI, updates correct element id="myReviewsList"
async function loadMyReviews() {
  const list = document.getElementById('myReviewsList');
  if (!list) return;

  list.innerHTML = '<p class="loading" style="color:#64748b;text-align:center;">Loading...</p>';

  try {
    const res     = await fetchAPI('/reviews/my');
    const reviews = res.data || [];
    renderMyReviews(reviews);
  } catch (error) {
    list.innerHTML = `
      <div style="text-align:center;padding:20px;color:#64748b;">
        <p>Không thể tải đánh giá: ${error.message}</p>
      </div>`;
  }
}

function renderMyReviews(reviews) {
  // FIX: correct element id="myReviewsList"
  const list = document.getElementById('myReviewsList');
  if (!list) return;

  if (reviews.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:20px;color:#64748b;">
        <p>Bạn chưa có đánh giá nào</p>
        <a href="orders.html" style="color:#2563eb;font-weight:600;">Xem đơn hàng để đánh giá</a>
      </div>`;
    return;
  }

  list.innerHTML = reviews.map(review => `
    <div class="review-card" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-weight:700;margin-bottom:4px;">${review.product?.name || review.productName || 'Sản phẩm'}</div>
          <div style="color:#f59e0b;font-size:18px;">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" style="padding:6px 12px;font-size:13px;" onclick="editReview('${review.id}')">Sửa</button>
          <button class="btn btn-danger"    style="padding:6px 12px;font-size:13px;" onclick="deleteReview('${review.id}')">Xóa</button>
        </div>
      </div>
      ${review.title ? `<div style="font-weight:600;margin-bottom:4px;">${review.title}</div>` : ''}
      <div style="color:#475569;font-size:14px;margin-bottom:8px;">${review.body || ''}</div>
      <div style="font-size:12px;color:#94a3b8;">${new Date(review.createdAt).toLocaleDateString('vi-VN')}</div>
      ${review.isHidden ? `
        <div style="margin-top:8px;padding:8px;background:#fef3c7;border-radius:6px;font-size:13px;color:#92400e;">
          ⚠️ Đánh giá này đã bị ẩn bởi quản trị viên
        </div>` : ''}
    </div>
  `).join('');
}

// FIX: editReview uses fetchAPI
async function editReview(reviewId) {
  const title  = prompt('Tiêu đề mới (bỏ trống để giữ nguyên):');
  if (title === null) return; // cancelled
  const body   = prompt('Nội dung mới (bỏ trống để giữ nguyên):');
  if (body === null) return;
  const ratingStr = prompt('Đánh giá mới 1-5 (bỏ trống để giữ nguyên):');
  if (ratingStr === null) return;

  const payload = {};
  if (title.trim())      payload.title  = title.trim();
  if (body.trim())       payload.body   = body.trim();
  if (ratingStr.trim()) {
    const r = parseInt(ratingStr);
    if (r >= 1 && r <= 5) payload.rating = r;
  }

  if (Object.keys(payload).length === 0) {
    showToast('Không có thay đổi nào', 'error');
    return;
  }

  try {
    await fetchAPI(`/reviews/${reviewId}`, {
      method : 'PUT',
      body   : JSON.stringify(payload),
    });
    showToast('Cập nhật đánh giá thành công!');
    loadMyReviews();
  } catch (error) {
    showToast(error.message || 'Không thể cập nhật đánh giá', 'error');
  }
}

// FIX: deleteReview uses fetchAPI
async function deleteReview(reviewId) {
  if (!confirm('Bạn có chắc muốn xóa đánh giá này?')) return;
  try {
    await fetchAPI(`/reviews/${reviewId}`, { method: 'DELETE' });
    showToast('Xóa đánh giá thành công!');
    loadMyReviews();
  } catch (error) {
    showToast(error.message || 'Không thể xóa đánh giá', 'error');
  }
}

// Logout
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try { await fetchAPI('/auth/logout', { method: 'POST', body: JSON.stringify({ allDevices: false }) }); } catch (e) {}
    localStorage.clear();
    window.location.href = 'login.html';
  });
}