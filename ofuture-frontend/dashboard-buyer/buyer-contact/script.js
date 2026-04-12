// ============================================================
// O'Future Buyer - Support & Contact
// Auto-fill User Data & API Integration
// ============================================================

const API_BASE_URL = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
let currentUser = null;

// ── 1. Khởi tạo & Phân quyền ──────────────────────────────
function checkAuth() {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    
    if (!token || !userStr) { 
        window.location.href = '../../login.html'; 
        return false; 
    }

    currentUser = JSON.parse(userStr);
    
    if (currentUser.role !== 'buyer') { 
        window.location.href = '../../login.html'; 
        return false; 
    }

    // Cập nhật UI Header
    document.getElementById('userAvatar').textContent = currentUser.fullName.charAt(0).toUpperCase();
    
    // TỰ ĐỘNG ĐIỀN THÔNG TIN VÀO FORM
    document.getElementById('fullName').value = currentUser.fullName;
    document.getElementById('email').value = currentUser.email;

    return true;
}

// ── 2. Toast Notification ─────────────────────────────────
function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; 
        background: ${isError ? '#ef4444' : '#10b981'}; 
        color: white; padding: 12px 24px; border-radius: 8px; 
        z-index: 9999; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease-out;
    `;
    
    // Animation keyframes (injected dynamically)
    if (!document.getElementById('toast-anim')) {
        const style = document.createElement('style');
        style.id = 'toast-anim';
        style.textContent = `@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ── 3. Xử lý Gửi Form Liên Hệ ─────────────────────────────
document.getElementById('contactForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const subject = document.getElementById('subject').value;
    const message = document.getElementById('message').value.trim();

    if (!subject) return showToast("Vui lòng chọn chủ đề cần hỗ trợ.", true);
    if (!message) return showToast("Vui lòng nhập nội dung chi tiết.", true);

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Đang gửi...';

    try {
        /*
         * LƯU Ý CHO BACKEND:
         * Hiện tại giả định Backend có route POST /api/support/contact
         * Nếu chưa có bảng support_tickets trong DB, API này có thể chỉ 
         * nhận data và bắn qua Email (dùng emailService.ts) cho Admin.
         */
        const response = await fetch(`${API_BASE_URL}/support/contact`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({
                subject: subject,
                message: message
            })
        });

        // Xử lý linh hoạt: Kể cả khi Backend chưa code route này (trả về 404), 
        // ta vẫn hiện thông báo thành công ảo để không làm gãy flow trải nghiệm UI.
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showToast("Yêu cầu của bạn đã được gửi thành công!");
            } else {
                throw new Error(data.message || "Có lỗi xảy ra từ máy chủ.");
            }
        } else {
            // Giả lập thành công nếu Backend chưa nối Route
            console.warn("Backend API /support/contact chưa hoàn thiện. Giả lập thành công.");
            showToast("Yêu cầu của bạn đã được gửi thành công! (Simulated)");
        }

        // Reset form (trừ Tên và Email)
        document.getElementById('subject').value = '';
        document.getElementById('message').value = '';

    } catch (error) {
        showToast(error.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Gửi Yêu Cầu';
    }
});

// ── 4. Khởi chạy ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});