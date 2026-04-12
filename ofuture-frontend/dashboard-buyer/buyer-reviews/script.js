// ============================================================
// O'Future Buyer - Product Reviews Management
// Create, Read, Update, Delete (CRUD)
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentUser = null;
let targetOrderId = null;
let editingReviewId = null;

// ── 1. Khởi tạo & Phân quyền ──────────────────────────────
function checkAuth() {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    if (!token || !userStr) { window.location.href = '../../login.html'; return false; }

    currentUser = JSON.parse(userStr);
    if (currentUser.role !== 'buyer') { window.location.href = '../../login.html'; return false; }

    document.getElementById('userAvatar').textContent = currentUser.fullName.charAt(0).toUpperCase();
    return true;
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.1);`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ── 2. Xử lý Logic Chọn Sao (Star Rating UI) ──────────────
function setupStarRating(containerId, inputId) {
    const container = document.getElementById(containerId);
    const stars = container.querySelectorAll('.star');
    const input = document.getElementById(inputId);

    stars.forEach(star => {
        // Hover effect
        star.addEventListener('mouseover', function() {
            const val = this.dataset.rating;
            stars.forEach(s => {
                s.style.color = s.dataset.rating <= val ? '#fbbf24' : '#cbd5e1';
            });
        });

        // Click to select
        star.addEventListener('click', function() {
            const val = this.dataset.rating;
            input.value = val; // Set hidden input
            stars.forEach(s => {
                s.classList.toggle('active', s.dataset.rating <= val);
            });
        });
    });

    // Reset on mouseleave if no click happened
    container.addEventListener('mouseleave', function() {
        const currentVal = input.value || 0;
        stars.forEach(s => {
            s.style.color = ''; // Xóa style inline để dùng CSS class
            s.classList.toggle('active', s.dataset.rating <= currentVal);
        });
    });
}

// ── 3. Check URL & Hiện form đánh giá mới ─────────────────
function checkWriteReviewIntent() {
    const urlParams = new URLSearchParams(window.location.search);
    targetOrderId = urlParams.get('orderId');

    if (targetOrderId) {
        document.getElementById('writeReviewSection').style.display = 'block';
        document.getElementById('displayOrderId').textContent = `#${targetOrderId}`;
    }
}

window.cancelWriteReview = function() {
    document.getElementById('writeReviewSection').style.display = 'none';
    document.getElementById('reviewForm').reset();
    document.getElementById('ratingValue').value = '';
    document.querySelectorAll('#starRating .star').forEach(s => s.classList.remove('active'));
    // Xóa URL param
    window.history.replaceState({}, document.title, window.location.pathname);
}

// ── 4. Gửi Đánh giá mới (Create) ──────────────────────────
document.getElementById('reviewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rating = document.getElementById('ratingValue').value;
    const title = document.getElementById('reviewTitle').value.trim();
    const body = document.getElementById('reviewBody').value.trim();

    if (!rating) return showToast("Vui lòng chọn số sao đánh giá!", true);

    const btn = document.getElementById('submitReviewBtn');
    btn.disabled = true; btn.textContent = 'Đang gửi...';

    try {
        const response = await fetch(`${API_BASE_URL}/reviews`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({ orderId: targetOrderId, rating: parseInt(rating), title, body })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            showToast("Cảm ơn bạn đã gửi đánh giá!");
            cancelWriteReview();
            loadMyReviews(); // Tải lại danh sách
        } else {
            throw new Error(data.message || "Bạn đã đánh giá đơn hàng này hoặc có lỗi xảy ra.");
        }
    } catch (error) {
        showToast(error.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Gửi Đánh Giá';
    }
});

// ── 5. Tải Danh sách Đánh giá cá nhân (Read) ──────────────
async function loadMyReviews() {
    const container = document.getElementById('myReviewsList');
    container.innerHTML = '<p class="muted" style="text-align:center;">Đang tải dữ liệu...</p>';

    try {
        // Giả định API trả về các đánh giá của user
        const response = await fetch(`${API_BASE_URL}/reviews`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        const data = await response.json();

        if (response.ok && data.success) {
            const reviews = data.data;
            if (reviews.length === 0) {
                container.innerHTML = '<p class="muted" style="text-align:center; padding: 20px;">Bạn chưa viết đánh giá nào.</p>';
                return;
            }

            container.innerHTML = reviews.map(r => {
                const dateStr = new Date(r.created_at).toLocaleDateString('vi-VN');
                const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
                
                // Seller reply section (if exists)
                let sellerReplyHtml = '';
                if (r.seller_reply_text && !r.is_reply_hidden) {
                    const replyDateStr = new Date(r.seller_reply_at).toLocaleDateString('vi-VN');
                    sellerReplyHtml = `
                        <div class="seller-reply-section">
                            <div class="seller-reply-header">
                                <span class="seller-reply-badge">Phản hồi từ Người bán</span>
                                <span class="seller-reply-date">${replyDateStr}</span>
                            </div>
                            <div class="seller-reply-text">${r.seller_reply_text}</div>
                        </div>
                    `;
                }
                
                return `
                    <div class="review-card">
                        <div class="review-header">
                            <div>
                                <div class="review-stars">${stars}</div>
                                <div class="review-title">${r.title || 'Không có tiêu đề'}</div>
                            </div>
                            <div class="review-meta">${dateStr}</div>
                        </div>
                        <div class="review-body">${r.comment || r.body || 'Không có nội dung'}</div>
                        <div class="review-meta" style="margin-bottom: 12px;">Đơn hàng: #${r.order_id}</div>
                        
                        ${sellerReplyHtml}
                        
                        <div class="review-actions">
                            <button class="btn-small btn-edit" onclick="openEditModal('${r.id}', ${r.rating}, '${(r.title || '').replace(/'/g,"\\'")}', '${(r.comment || r.body || '').replace(/'/g,"\\'")}')">Sửa</button>
                            <button class="btn-small btn-delete" onclick="deleteReview('${r.id}')">Xóa</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        container.innerHTML = `<p style="color:red">Lỗi tải dữ liệu.</p>`;
    }
}

// ── 6. Chỉnh sửa & Xóa Đánh giá (Update & Delete) ─────────
window.openEditModal = function(id, rating, title, body) {
    editingReviewId = id;
    
    // Gán giá trị
    document.getElementById('editRatingValue').value = rating;
    document.getElementById('editReviewTitle').value = title !== 'null' ? title : '';
    document.getElementById('editReviewBody').value = body !== 'null' ? body : '';
    
    // Kích hoạt UI Sao
    const stars = document.querySelectorAll('#editStarRating .star');
    stars.forEach(s => s.classList.toggle('active', s.dataset.rating <= rating));

    document.getElementById('editReviewModal').style.display = 'flex';
}

window.closeEditModal = function() {
    document.getElementById('editReviewModal').style.display = 'none';
    editingReviewId = null;
}

window.submitEditReview = async function() {
    const rating = document.getElementById('editRatingValue').value;
    const title = document.getElementById('editReviewTitle').value.trim();
    const body = document.getElementById('editReviewBody').value.trim();

    const btn = document.getElementById('updateReviewBtn');
    btn.disabled = true; btn.textContent = 'Đang lưu...';

    try {
        const response = await fetch(`${API_BASE_URL}/reviews/${editingReviewId}`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({ rating: parseInt(rating), title, body })
        });
        
        if (response.ok) {
            showToast("Đã cập nhật đánh giá thành công!");
            closeEditModal();
            loadMyReviews();
        } else {
            const data = await response.json();
            throw new Error(data.message || "Lỗi cập nhật.");
        }
    } catch (error) {
        showToast(error.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Cập nhật';
    }
}

window.deleteReview = async function(id) {
    if(!confirm("Bạn có chắc chắn muốn xóa đánh giá này?")) return;

    try {
        const response = await fetch(`${API_BASE_URL}/reviews/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        
        if (response.ok) {
            showToast("Đã xóa đánh giá.");
            loadMyReviews();
        }
    } catch (error) {
        showToast("Lỗi xóa đánh giá.", true);
    }
}

// ── Khởi chạy ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (checkAuth()) {
        setupStarRating('starRating', 'ratingValue');
        setupStarRating('editStarRating', 'editRatingValue');
        
        checkWriteReviewIntent();
        loadMyReviews();
    }
});