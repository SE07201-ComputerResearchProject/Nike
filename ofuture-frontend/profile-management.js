// ── Navigation (Giữ nguyên hiệu ứng chuyển tab) ────────────────────────
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        const section = e.currentTarget.dataset.section;
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
        e.currentTarget.classList.add('active');
        document.getElementById(`${section}-section`).classList.add('active');
    });
});

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className   = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── Load Profile ────────────────────────────────────────────────────────
async function loadProfile() {
    try {
        const response = await fetchAPI('/auth/me');
        const data = response.data;

        document.getElementById('email').value    = data.email     || '';
        document.getElementById('username').value = data.username  || '';
        document.getElementById('fullName').value = data.fullName  || '';
        document.getElementById('phone').value    = data.phone     || '';
        if (data.avatarUrl) {
            document.getElementById('avatarPreview').src = `${CONFIG.BASE_URL}${data.avatarUrl}`;
        } else {
            // Nếu không có avatar, dùng một link ảnh mặc định online để tránh lỗi 404 default-avatar.png
            document.getElementById('avatarPreview').src = 'https://ui-avatars.com/api/?name=' + (data.fullName || 'User');
        }

        // Xử lý hiển thị UI cho MFA
        const mfaStatus = document.getElementById('mfaStatus');
        const mfaBtn = document.getElementById('mfaToggleBtn');
        
        if (data.mfaEnabled) {
            mfaStatus.innerHTML = "Trạng thái: <b style='color:#10b981;'>Đã bật an toàn</b>";
            mfaBtn.textContent = "Tắt MFA";
            mfaBtn.className = "btn btn-danger"; // Đổi màu nút thành đỏ
            mfaBtn.dataset.action = "disable";
        } else {
            mfaStatus.innerHTML = "Trạng thái: <b style='color:#ef4444;'>Chưa kích hoạt</b>";
            mfaBtn.textContent = "Bật MFA";
            mfaBtn.className = "btn btn-primary"; // Đổi màu nút thành xanh
            mfaBtn.dataset.action = "enable";
        }

    } catch (error) {
        showToast(error.message || 'Lỗi tải dữ liệu người dùng', 'error');
    }
}

// ── Cập nhật Mật khẩu ────────────────────────────────────────────────
async function updatePassword() {
    const oldPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;

    if (!oldPassword || !newPassword) return showToast('Vui lòng nhập đầy đủ mật khẩu!', 'error');

    try {
        await fetchAPI('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ oldPassword, newPassword }),
        });
        showToast('Đổi mật khẩu thành công!');
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
    } catch (error) {
        showToast(error.message || 'Lỗi khi đổi mật khẩu', 'error');
    }
}

// ── Quản lý MFA (Bật / Tắt) ──────────────────────────────────────────
document.getElementById('mfaToggleBtn')?.addEventListener('click', async function() {
    const action = this.dataset.action;

    if (action === "enable") {
        try {
            // 1. Gọi API Setup để lấy QR Code
            const response = await fetchAPI("/mfa/setup", { method: "POST" });
            
            // 2. Hiển thị Modal quét QR
            document.getElementById('mfaQrCode').src = response.data.qrCode;
            document.getElementById('mfaSetupModal').style.display = 'block';
            document.getElementById('mfaOverlay').style.display = 'block';
            document.getElementById('mfaConfirmCode').value = '';
        } catch (error) {
            showToast(error.message || "Lỗi khi khởi tạo mã QR.", 'error');
        }
    } else if (action === "disable") {
        // Mở modal Disable MFA an toàn
        document.getElementById('mfaDisablePassword').value = '';
        document.getElementById('mfaDisableCode').value = '';
        document.getElementById('mfaDisableModal').style.display = 'block';
        document.getElementById('mfaOverlay').style.display = 'block';
    }
});

// Hàm gắn vào nút "Xác nhận" trong Modal QR
async function confirmMfaSetup() {
    const code = document.getElementById("mfaConfirmCode").value.trim();
    if (!code || code.length < 6) return showToast("Vui lòng nhập đủ 6 số OTP.", "error");

    try {
        await fetchAPI("/mfa/confirm", {
            method: "POST",
            body: JSON.stringify({ code })
        });
        
        showToast("Tuyệt vời! Bạn đã bật MFA thành công.");
        cancelMfaSetup();
        loadProfile(); // Reload UI để nút đổi thành "Tắt MFA"
    } catch (error) {
        showToast(error.message || "Mã OTP không chính xác.", "error");
    }
}

// Hàm gắn vào nút "Hủy bỏ" trong Modal QR
function cancelMfaSetup() {
    document.getElementById("mfaSetupModal").style.display = "none";
    document.getElementById("mfaOverlay").style.display = "none";
}

// ── Xử lý Xác nhận & Hủy Modal Tắt MFA ────────────────────────────────
async function confirmMfaDisable() {
    const password = document.getElementById('mfaDisablePassword').value;
    const code = document.getElementById('mfaDisableCode').value.trim();

    if (!password) return showToast('Vui lòng nhập mật khẩu!', 'error');
    if (!code || code.length < 6) return showToast('Vui lòng nhập đủ 6 số OTP!', 'error');

    try {
        await fetchAPI('/mfa/disable', {
            method: 'POST',
            body: JSON.stringify({ password, code }),
        });
        
        showToast('Tắt MFA thành công!');
        cancelMfaDisable();
        loadProfile(); // Tải lại UI để nút chuyển lại thành "Bật MFA"
    } catch (error) { 
        showToast(error.message || 'Sai mật khẩu hoặc mã OTP', 'error'); 
    }
}

function cancelMfaDisable() {
    document.getElementById('mfaDisableModal').style.display = 'none';
    document.getElementById('mfaOverlay').style.display = 'none';
}

// ── Trusted Devices (Đang phát triển) ─────────────────────────────────
function loadDevices() {
    document.getElementById('devicesList').innerHTML =
      '<p style="color:#64748b">Tính năng quản lý thiết bị đang được phát triển.</p>';
}

// ── Khởi tạo khi load trang ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    loadDevices();
});

// ── XỬ LÝ UPLOAD AVATAR ──────────────────────────────────────────────
document.getElementById('avatarInput')?.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Dùng FormData vì chúng ta đang gửi File (không phải JSON)
    const formData = new FormData();
    formData.append('avatar', file);

    try {
        const response = await fetchAPI('/auth/avatar', {
            method: 'POST',
            body: formData // fetchAPI của bạn đã được cấu hình tự bỏ Content-Type khi gửi FormData
        });
        
        // Cập nhật giao diện ngay lập tức
        document.getElementById('avatarPreview').src = response.data.avatarUrl;
        showToast('Cập nhật ảnh đại diện thành công!');
        
        // (Tùy chọn) Cập nhật lại localStorage
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        user.avatarUrl = response.data.avatarUrl;
        localStorage.setItem('user', JSON.stringify(user));

    } catch (error) {
        showToast(error.message || 'Lỗi khi tải ảnh lên.', 'error');
    }
});

// ── XỬ LÝ DANH SÁCH THIẾT BỊ ─────────────────────────────────────────
async function loadDevices() {
    try {
        const response = await fetchAPI('/auth/devices');
        const devices = response.data;
        const container = document.getElementById('devicesList');

        if (!devices || devices.length === 0) {
            container.innerHTML = '<p>Không có thiết bị tin cậy nào.</p>';
            return;
        }

        container.innerHTML = devices.map(d => `
            <div class="device-item" style="padding:15px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
                <div>
                    <strong>${d.device_name || 'Thiết bị không tên'}</strong>
                    <div style="font-size:12px; color:gray;">
                        IP: ${d.ip_address} <br>
                        Sử dụng cuối: ${d.last_used_at ? new Date(d.last_used_at).toLocaleString() : 'N/A'}
                    </div>
                </div>
                <button onclick="revokeDevice(${d.id})" class="btn-revoke">Gỡ bỏ</button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Devices load error:', error);
    }
}

// ── HÀM ĐĂNG XUẤT 1 THIẾT BỊ ─────────────────────────────────────────
window.revokeDevice = async function(deviceId) {
    if (!confirm('Bạn có chắc chắn muốn đăng xuất thiết bị này?')) return;
    
    try {
        await fetchAPI(`/auth/devices/${deviceId}`, { method: 'DELETE' });
        showToast('Đã đăng xuất thiết bị thành công!');
        loadDevices(); // Load lại danh sách
    } catch (error) {
        showToast(error.message || 'Lỗi khi đăng xuất thiết bị.', 'error');
    }
};