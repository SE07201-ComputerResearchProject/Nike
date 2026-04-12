// ============================================================
// O'Future Buyer - Profile Management (Sử dụng fetchAPI chuẩn)
// ============================================================

let currentUser = null;

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

// ── 5. Danh sách thiết bị tin cậy ─────────────────────────
async function loadDevices() {
    const container = document.getElementById('devicesList');
    try {
        const result = await fetchAPI('/auth/devices');
        if (result.success) {
            container.innerHTML = result.data.map(d => `
                <div class="device-item">
                    <div>
                        <strong>${d.deviceName || 'Thiết bị lạ'}</strong>
                        <p class="muted" style="font-size:12px">IP: ${d.ipAddress} • ${new Date(d.lastUsedAt).toLocaleString()}</p>
                    </div>
                    <button class="btn btn-outline" style="color:#ef4444; border:none" onclick="revokeDevice('${d.id}')">Gỡ bỏ</button>
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

document.addEventListener('DOMContentLoaded', loadProfile);
function closeMFAModal() { document.getElementById('mfaModal').style.display = 'none'; }