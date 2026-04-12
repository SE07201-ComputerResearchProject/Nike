// ============================================================
// O'Future - Complete Profile Handler
// Tích hợp fetchAPI & Điều hướng Role-based
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Kiểm tra Token (Chặn khách vãng lai)
    // const token = localStorage.getItem('accessToken');
    // if (!token) {
    //     window.location.href = '../../login.html';
    //     return;
    // }

    const form = document.getElementById('completeProfileForm');
    const saveBtn = document.getElementById('saveBtn');

    // --- HIỆU ỨNG ẨN/HIỆN FORM THEO ROLE ---
    const roleRadios = document.querySelectorAll('input[name="userRole"]');
    const storeInfoSection = document.getElementById('storeInfoSection');
    const storeNameInput = document.getElementById('storeName');

    roleRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'seller') {
                // Hiện form cửa hàng, bắt buộc nhập tên cửa hàng
                storeInfoSection.style.display = 'block';
                storeNameInput.setAttribute('required', 'true');
            } else {
                // Ẩn form cửa hàng, bỏ bắt buộc
                storeInfoSection.style.display = 'none';
                storeNameInput.removeAttribute('required');
                storeNameInput.value = ''; // Xóa trắng dữ liệu nếu đổi lại thành buyer
            }
        });
    });

    // 2. Xử lý gửi Form
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const selectedRole = document.querySelector('input[name="userRole"]:checked').value;

        // Khởi tạo Payload cơ bản
        const payload = {
            role: selectedRole, // Truyền role xuống Backend
            phone: document.getElementById('phone').value.trim(),
            address: document.getElementById('address').value.trim(),
            city: document.getElementById('city').value.trim()
        };

        // Nếu là Seller thì mới nhét thêm thông tin Cửa hàng
        if (selectedRole === 'seller') {
            payload.store_name = document.getElementById('storeName').value.trim();
            payload.category = document.getElementById('category').value;
            payload.scale = document.getElementById('scale').value;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Đang lưu hồ sơ...';

        try {
            const result = await fetchAPI('/auth/profile', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });

            if (result.success) {
                // Cập nhật LocalStorage
                const user = JSON.parse(localStorage.getItem('user'));
                const updatedUser = { ...user, ...payload, role: selectedRole };
                localStorage.setItem('user', JSON.stringify(updatedUser));

                alert('Hồ sơ đã được hoàn thiện!');

                // Điều hướng CHUẨN XÁC theo Role vừa chọn
                if (selectedRole === 'seller') {
                    window.location.href = '../../dashboard-seller/indexSeller.html';
                } else {
                    window.location.href = '../buyer-home/index.html';
                }
            } else {
                throw new Error(result.message || 'Cập nhật thất bại.');
            }
        } catch (error) {
            alert('Lỗi: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Hoàn tất & Vào TRANG CHỦ';
        }
    });
});