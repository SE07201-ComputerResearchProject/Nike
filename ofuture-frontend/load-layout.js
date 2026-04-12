// File: load-layout.js
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Tự động nhận diện thư mục gốc (Fix lỗi đường dẫn khi mở bằng Live Server)
    const basePath = window.location.pathname.includes('ofuture-frontend') ? '/ofuture-frontend' : '';

    // 2. Load Header
    const headerEl = document.getElementById('header-placeholder');
    if (headerEl) {
        try {
            const res = await fetch(`${basePath}/header.html`);
            headerEl.innerHTML = await res.text();
            
            // Fix lại link trong Header cho chuẩn với máy của bạn
            document.getElementById('logoLink').href = `${basePath}/index.html`;
            document.getElementById('homeLink').href = `${basePath}/index.html`;
            document.getElementById('productLink').href = `${basePath}/dashboard-buyer/buyer-products/index.html`;

            setupAuthUI(basePath); // Cập nhật nút Đăng nhập / Avatar
        } catch (e) { console.error("Lỗi load Header:", e); }
    }

    // 3. Load Footer
    const footerEl = document.getElementById('footer-placeholder');
    if (footerEl) {
        try {
            const res = await fetch(`${basePath}/footer.html`);
            footerEl.innerHTML = await res.text();
        } catch (e) { console.error("Lỗi load Footer:", e); }
    }
});

function setupAuthUI(basePath) {
    const authSection = document.getElementById('globalAuthSection');
    if (!authSection) return;

    const userStr = localStorage.getItem('user');
    if (userStr) {
        const user = JSON.parse(userStr);
        let dashLink = `${basePath}/index.html`;
        if (user.role === 'buyer') dashLink = `${basePath}/dashboard-buyer/buyer-home/index.html`;
        else if (user.role === 'seller') dashLink = `${basePath}/dashboard-seller/indexSeller.html`;
        else if (user.role === 'admin') dashLink = `${basePath}/dashboard-admin/indexAdmin.html`;

        authSection.innerHTML = `
            <a href="${dashLink}" style="padding: 8px 16px; border: 1px solid #cbd5e1; border-radius: 8px; text-decoration:none; color:#0f172a; font-weight:600; font-family:'Inter', sans-serif; font-size: 14px;">Vào Dashboard</a>
            <div style="width: 36px; height: 36px; border-radius: 50%; background: #4f46e5; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-family:'Inter', sans-serif;">${user.fullName ? user.fullName.charAt(0).toUpperCase() : 'U'}</div>
            <button onclick="logoutGlobal()" style="border:none; background:none; color:#ef4444; font-weight:600; cursor:pointer; font-family:'Inter', sans-serif; font-size: 14px;">Đăng xuất</button>
        `;
    } else {
        authSection.innerHTML = `
            <a href="${basePath}/login.html" style="padding: 8px 16px; border: 1px solid #cbd5e1; border-radius: 8px; text-decoration:none; color:#0f172a; font-weight:600; font-family:'Inter', sans-serif; font-size: 14px;">Đăng nhập</a>
            <a href="${basePath}/register.html" style="padding: 8px 16px; background: #4f46e5; color: white; border-radius: 8px; text-decoration:none; font-weight:600; font-family:'Inter', sans-serif; font-size: 14px;">Đăng ký</a>
        `;
    }
}

window.logoutGlobal = function() {
    localStorage.clear();
    const basePath = window.location.pathname.includes('ofuture-frontend') ? '/ofuture-frontend' : '';
    window.location.href = `${basePath}/login.html`;
}