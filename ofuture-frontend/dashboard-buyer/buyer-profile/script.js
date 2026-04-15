// ============================================================
// O'Future Buyer - Profile Management (Sử dụng fetchAPI chuẩn)
// ============================================================

let currentUser = null;

// Hàm hiển thị thông báo (Toast)
function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#ef4444' : '#10b981'}; color:white; padding:12px 24px; border-radius:8px; z-index:9999; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: opacity 0.3s ease;`;
    document.body.appendChild(toast);
    
    // Tự động mờ dần và xóa sau 3.5 giây
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ── 1. Khởi tạo & Đồng bộ Giỏ hàng ─────────────────────────
function updateCartBadge() {
    const cartKey = `cart_${currentUser.id}`;
    const cartData = JSON.parse(localStorage.getItem(cartKey)) || [];
    const totalItems = cartData.reduce((sum, item) => sum + item.quantity, 0);
    const badge = document.getElementById('cartBadge');
    if (badge) {
        badge.textContent = totalItems;
        badge.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }
}

// ── 2. Load Thông tin cá nhân ─────────────────────────────
async function loadProfile() {
    try {
        const result = await fetchAPI('/auth/me'); // Sử dụng api.js
        if (result.success) {
            currentUser = result.data;
            document.getElementById('username').value = currentUser.username;
            document.getElementById('email').value = currentUser.email;
            document.getElementById('fullName').value = currentUser.fullName;
            document.getElementById('phone').value = currentUser.phone || '';
            document.getElementById('headerAvatar').textContent = currentUser.fullName.charAt(0).toUpperCase();
            
            if (currentUser.avatarUrl) {
                let imgUrl = currentUser.avatarUrl;
                if (imgUrl.startsWith('/uploads')) {
                    const backendBaseUrl = (window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api').replace('/api', '');
                    imgUrl = backendBaseUrl + imgUrl;
                }
                document.getElementById('avatarPreview').src = imgUrl;
            }

            // Cập nhật trạng thái MFA
            const mfaStatus = document.getElementById('mfaStatus');
            const mfaArea = document.getElementById('mfaSetupArea');
            if (currentUser.mfaEnabled) {
                mfaStatus.textContent = "Đã bật an toàn";
                mfaStatus.className = "status-badge enabled";
                mfaArea.innerHTML = `<button onclick="confirmDisableMFA()" class="btn btn-outline" style="color:#ef4444">Tắt bảo mật MFA</button>`;
            }
            
            updateCartBadge();
        }
    } catch (err) { console.error(err); }
}

// ── 1. Cập nhật Thông tin cá nhân ─────────────────────────
document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault(); // Ngăn reload trang
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    
    const payload = {
        fullName: document.getElementById('fullName').value,
        phone: document.getElementById('phone').value
    };

    try {
        btn.disabled = true;
        btn.textContent = "Đang lưu...";
        
        const result = await fetchAPI('/auth/profile', { // Endpoint cập nhật profile của bạn
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        if (result.success) {
            showToast("Cập nhật thông tin thành công!");
            // Cập nhật lại UI header nếu cần
            document.getElementById('headerAvatar').textContent = payload.fullName.charAt(0).toUpperCase();
        }
    } catch (err) {
        showToast("Lỗi cập nhật: " + err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// ── 2. Đổi mật khẩu & Validation ──────────────────────────
const passRules = {
    length: /^.{8,}$/,
    uppercase: /[A-Z]/,
    lowercase: /[a-z]/,
    number: /\d/,
    special: /[!@#$%^&*]/
};

const newPasswordInput = document.getElementById('newPassword');
newPasswordInput.addEventListener('input', () => {
    const val = newPasswordInput.value;
    // Cập nhật các class 'met' cho list UI (giống trang register)
    document.getElementById('req-length').className = passRules.length.test(val) ? 'met' : '';
    document.getElementById('req-upper').className = passRules.uppercase.test(val) ? 'met' : '';
    document.getElementById('req-lower').className = passRules.lowercase.test(val) ? 'met' : '';
    document.getElementById('req-number').className = passRules.number.test(val) ? 'met' : '';
    document.getElementById('req-special').className = passRules.special.test(val) ? 'met' : '';
});

// Toggle Hiển thị mật khẩu (Thay thế mousedown/mouseup cũ)
window.togglePassword = function(inputId, iconElement) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        iconElement.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        iconElement.classList.replace('fa-eye-slash', 'fa-eye');
    }
};

// Thêm hàm kiểm tra trùng khớp
function checkPasswordMatch() {
    const newPass = document.getElementById('newPassword').value;
    const confirmPass = document.getElementById('confirmNewPassword').value;
    const statusEl = document.getElementById('confirmStatus');

    // Nếu ô nhập lại trống thì không hiện chữ
    if (confirmPass.length === 0) {
        statusEl.textContent = '';
        statusEl.className = 'password-match-status';
        return;
    }

    if (newPass === confirmPass) {
        statusEl.textContent = 'Mật khẩu trùng khớp.';
        statusEl.className = 'password-match-status match';
    } else {
        statusEl.textContent = 'Mật khẩu không trùng khớp.';
        statusEl.className = 'password-match-status mismatch';
    }
}

// Bắt sự kiện khi người dùng gõ phím
document.getElementById('newPassword').addEventListener('input', () => {
    checkPasswordMatch(); // Khi sửa MK mới cũng phải check lại xem có trùng ô dưới không
});
document.getElementById('confirmNewPassword').addEventListener('input', checkPasswordMatch);

// Khi API thành công, nhớ xóa luôn dòng chữ trạng thái này nhé:
// Tìm trong đoạn document.getElementById('passwordForm').addEventListener('submit', ...)
// Và thêm vào khối if (result.success):
// document.getElementById('confirmStatus').textContent = '';

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;

    if (newPassword !== confirmPassword) {
        return showToast("Mật khẩu mới không khớp!", true);
    }

    try {
        const result = await fetchAPI('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });
        if (result.success) {
            showToast("Đổi mật khẩu thành công!");
            e.target.reset();
            // Reset các icon check điều kiện
            document.querySelectorAll('.password-requirements li').forEach(li => li.className = '');
        }
    } catch (err) {
        showToast(err.message, true);
    }
});

// ── 3. Upload Avatar (FormData) ───────────────────────────
document.getElementById('avatarInput').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(`${window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api'}/auth/avatar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }, // Bắt buộc không setup Content-Type để trình duyệt tự chèn boundary
            body: formData
        });
        const result = await response.json();

        if (result.success) {
            document.getElementById('avatarPreview').src = result.data.avatarUrl;
            alert("Cập nhật ảnh đại diện thành công!");
        } else {
            alert("Lỗi: " + result.message);
        }
    } catch (err) { alert("Lỗi upload ảnh."); }
});

// ── 4. Quản lý MFA (Bật/Tắt) ──────────────────────────────
window.setupMFA = async function() {
    try {
        const result = await fetchAPI('/mfa/setup', { method: 'POST' });
        if (result.success) {
            const modalBody = document.getElementById('mfaModalBody');
            modalBody.innerHTML = `
                <div style="text-align:center">
                    <p>Quét mã QR dưới đây bằng app Authenticator:</p>
                    <img src="${result.data.qrCode}" style="margin:20px 0; border:1px solid #eee">
                    <div class="form-group">
                        <input type="text" id="mfaCode" class="form-control" placeholder="Nhập mã 6 số" maxlength="6" style="text-align:center; font-size:20px">
                    </div>
                    <button onclick="verifyMFA()" class="btn btn-primary" style="width:100%">Xác nhận kích hoạt</button>
                </div>
            `;
            document.getElementById('mfaModal').style.display = 'flex';
        }
    } catch (err) { alert("Lỗi thiết lập MFA."); }
}

window.verifyMFA = async function() {
    const code = document.getElementById('mfaCode').value;
    try {
        const result = await fetchAPI('/mfa/confirm', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
        if (result.success) {
            alert("Đã kích hoạt MFA thành công!");
            location.reload();
        }
    } catch (err) { alert("Mã xác nhận không đúng."); }
}

// 1. Khai báo các phần tử DOM cần dùng
const disableMfaModal = document.getElementById('disableMfaModal');
const disableMfaForm = document.getElementById('disableMfaForm');
const finalDisableMfaBtn = document.getElementById('finalDisableMfaBtn');

window.confirmDisableMFA = function() {
    // 1. Reset text trong form
    document.getElementById('disableMfaForm').reset();
    
    // 2. [QUAN TRỌNG] Khôi phục lại trạng thái của nút bấm mỗi khi mở hộp thoại
    const btn = document.getElementById('finalDisableMfaBtn');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-lock-open"></i> Xác nhận Tắt';
    
    // 3. Mở Modal
    document.getElementById('disableMfaModal').style.display = 'flex';
}

window.closeDisableMfaModal = function() {
    document.getElementById('disableMfaModal').style.display = 'none';
}

window.handleFinalDisableMFA = async function(event) {
    event.preventDefault();

    const password = document.getElementById('disableMfaPassword').value;
    const code = document.getElementById('disableMfaCode').value;

    if (!password) return showToast("Vui lòng nhập mật khẩu!", true);
    if (!code || code.length !== 6) return showToast("Mã Authenticator phải đúng 6 số.", true);

    const finalDisableMfaBtn = document.getElementById('finalDisableMfaBtn');
    finalDisableMfaBtn.disabled = true;
    finalDisableMfaBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xử lý...';

    try {
        const result = await fetchAPI('/mfa/disable', {
            method: 'POST',
            body: JSON.stringify({ password, code })
        });

        // Nếu API trả về thành công (HTTP 200)
        if (result.success) {
            showToast("Đã tắt bảo mật 2 yếu tố (MFA) thành công!");
            closeDisableMfaModal();
            setTimeout(() => location.reload(), 1500); 
        } else {
            // Lỗi do backend trả về nhưng HTTP code là 200 (hiếm xảy ra)
            showToast("Lỗi: " + (result.message || "Sai mật khẩu hoặc mã code."), true);
            finalDisableMfaBtn.disabled = false;
            finalDisableMfaBtn.innerHTML = '<i class="fas fa-lock-open"></i> Xác nhận Tắt';
        }
    } catch (err) {
        // [QUAN TRỌNG] Bắt lỗi HTTP 400 từ api.js ném ra
        console.error("Disable MFA Error:", err);
        showToast("Sai mật khẩu hoặc mã Authenticator. Vui lòng kiểm tra lại!", true);
        
        // Phục hồi lại nút bấm khi bị lỗi
        finalDisableMfaBtn.disabled = false;
        finalDisableMfaBtn.innerHTML = '<i class="fas fa-lock-open"></i> Xác nhận Tắt';
    }
}

// ── 5. Danh sách thiết bị tin cậy ─────────────────────────
async function loadDevices() {
    const container = document.getElementById('devicesList');
    try {
        const result = await fetchAPI('/auth/devices');
        if (result.success) {
            // Giả sử backend trả về deviceId hiện tại hoặc ta so sánh IP
            container.innerHTML = result.data.map(d => `
                <div class="device-item ${d.isCurrent ? 'current-device' : ''}">
                    <div>
                        <strong>${d.deviceName || 'Thiết bị lạ'} ${d.isCurrent ? '<span class="badge-current">Thiết bị này</span>' : ''}</strong>
                        <p class="muted" style="font-size:12px">
                            IP: <span class="ip-highlight">${d.ipAddress || 'Không xác định'}</span> 
                            • ${new Date(d.lastUsedAt).toLocaleString()}
                        </p>
                    </div>
                    ${!d.isCurrent ? `<button class="btn btn-outline" style="color:#ef4444" onclick="revokeDevice('${d.id}')">Gỡ bỏ</button>` : ''}
                </div>
            `).join('');
        }
    } catch (err) { container.innerHTML = "Lỗi tải thiết bị."; }
}

window.revokeDevice = async function(deviceId) {
    if (!confirm("Bạn muốn đăng xuất tài khoản khỏi thiết bị này?")) return;
    try {
        await fetchAPI(`/auth/devices/${deviceId}`, { method: 'DELETE' });
        loadDevices();
    } catch (err) { alert("Không thể gỡ thiết bị."); }
}

// ── 6. Đăng xuất ──────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await fetchAPI('/auth/logout', { method: 'POST', body: JSON.stringify({ allDevices: false }) });
    } catch (e) {}
    localStorage.clear();
    window.location.href = '../../login.html';
});

// ── Tab Navigation ────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'devices') loadDevices();
    });
});

document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    if (typeof loadOrderStats === 'function') loadOrderStats();
});

function closeMFAModal() { document.getElementById('mfaModal').style.display = 'none'; }

// Load order statistics and update DOM elements
async function loadOrderStats() {
    try {
        const apiBase = window.CONFIG?.API_BASE_URL || 'http://localhost:5000/api';
        const token = localStorage.getItem('accessToken');
        const res = await fetch(`${apiBase}/orders/my?limit=100`, {
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });
        const data = await res.json();

        // Normalize response: if API uses { success, data } pattern
        const orders = Array.isArray(data) ? data : (data.data && Array.isArray(data.data) ? data.data : []);

        const pendingCount = orders.filter(o => o.status === 'pending').length;
        const escrowTotal = orders
            .filter(o => o.status === 'paid' || o.status === 'shipped')
            .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

        const pendingEl = document.getElementById('statPendingOrders');
        const escrowEl = document.getElementById('statEscrowAmount');
        if (pendingEl) pendingEl.textContent = String(pendingCount);
        if (escrowEl) escrowEl.textContent = new Intl.NumberFormat('vi-VN').format(escrowTotal) + ' đ';
    } catch (err) {
        console.error('loadOrderStats error', err);
    }
}