// ============================================================
// CORE API WRAPPER - Xử lý mọi kết nối từ FE lên BE
// ============================================================

const CONFIG = {
  // Tự động nhận diện môi trường để chuyển URL, tránh hardcode 
  BASE_URL: 'http://localhost:5000',
  API_BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:5000/api' 
    : 'https://your-production-api.com/api'
};

window.CONFIG = CONFIG;

async function fetchAPI(endpoint, options = {}) {
  const token = localStorage.getItem('accessToken');
  
  const headers = { ...options.headers };
  // Nếu dữ liệu không phải là File/FormData thì mới ép kiểu JSON
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  // Đính kèm Token nếu có
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    }); 

    // ── XỬ LÝ LỖI 401 (Mất Session / Token hết hạn) ──
    if (response.status === 401) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      
      const basePath = window.location.pathname.includes('ofuture-frontend') ? '/ofuture-frontend' : '';
      
      alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!');
      window.location.href = `${basePath}/login.html`;
      throw new Error('Unauthorized');
    }

    const data = await response.json();
    
    // Ném lỗi nếu response trả về không success
    if (!response.ok || !data.success) {
      throw new Error(data.message || `Lỗi HTTP: ${response.status}`);
    }
    
    return data; // Trả về toàn bộ object chuẩn của BE
  } catch (error) {
    console.error('[API Error]:', error);
    throw error;
  }
}