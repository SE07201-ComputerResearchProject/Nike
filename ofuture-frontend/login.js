// ============================================================
// O'Future Login Form Handler (Optimized API + Original Animations)
// ============================================================

// ── 1. Giao diện thông báo (Toast Notifications) ────────────
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; padding: 12px 20px;
    background-color: ${type === 'success' ? '#10b981' : '#ef4444'};
    color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000; animation: slideIn 0.3s ease-out;
  `;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function ensureAnimations() {
  if (!document.getElementById('login-animations')) {
    const style = document.createElement('style');
    style.id = 'login-animations';
    style.textContent = `
      @keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }
    `;
    document.head.appendChild(style);
  }
}

// ── 2. Xử lý Đăng nhập thông thường ────────────────────────
// ── Khai báo biến toàn cục để lưu token MFA tạm thời ──
let currentMfaToken = null;

// ── Hàm tiện ích: Xử lý sau khi đăng nhập/xác thực thành công ──
function completeLoginFlow(userData) {
  if (userData.accessToken) localStorage.setItem('accessToken', userData.accessToken);
  if (userData.refreshToken) localStorage.setItem('refreshToken', userData.refreshToken);
  if (userData.user) localStorage.setItem('user', JSON.stringify(userData.user));

  showNotification('Xác thực thành công! Đang chuyển hướng...', 'success');
  
  const userRole = userData.user?.role;
  let redirectUrl = 'index.html'; 

  if (userRole === 'admin') redirectUrl = 'dashboard-admin/indexAdmin.html';
  else if (userRole === 'seller') redirectUrl = 'dashboard-seller/indexSeller.html';
  else if (userRole === 'buyer' || userRole === 'user') redirectUrl = 'buyer-dashboard.html';
  
  setTimeout(() => { window.location.href = redirectUrl; }, 500);
}

// ── 2. Xử lý Đăng nhập thông thường ────────────────────────
async function handleLoginSubmit(event) {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const loginBtn = document.getElementById('loginBtn');

  if (!email || !password) return showNotification('Vui lòng nhập email và mật khẩu', 'error');

  try {
    loginBtn.disabled = true; loginBtn.textContent = 'Đang đăng nhập...';

    // Dùng fetch thuần thay vì fetchAPI để bắt được payload mfaRequired khi HTTP Status = 403
    const response = await fetch(`${CONFIG.API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    const data = await response.json();

    // ── KIỂM TRA LUỒNG MFA ──
    if (data.mfaRequired) {
      currentMfaToken = data.mfaToken || (data.data && data.data.mfaToken);
      
      // Ẩn form đăng nhập thường, hiện form OTP
      loginBtn.style.display = 'none';
      document.getElementById('google-signin-button').style.display = 'none';
      document.querySelector('.switch-auth').style.display = 'none';
      document.getElementById('mfaSection').style.display = 'block';
      
      showNotification('Vui lòng nhập mã bảo mật (OTP)', 'info');
      return;
    }

    if (!response.ok || !data.success) throw new Error(data.message || 'Sai Email hoặc Mật khẩu');

    // Nếu không yêu cầu MFA, hoàn tất đăng nhập
    completeLoginFlow(data.data);

  } catch (error) {
    showNotification(error.message, 'error');
    loginBtn.disabled = false; loginBtn.textContent = 'Đăng nhập';
  }
}

// ── 3. Xử lý Xác nhận OTP (MFA) ───────────────────────────
async function handleVerifyMfa() {
  const code = document.getElementById('mfaCode').value.trim();
  const verifyBtn = document.getElementById('verifyMfaBtn');

  if (!code || code.length < 6) return showNotification('Vui lòng nhập đủ 6 số OTP', 'error');

  try {
    verifyBtn.disabled = true; verifyBtn.textContent = 'Đang kiểm tra...';

    const response = await fetch(`${CONFIG.API_BASE_URL}/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken: currentMfaToken, code, codeType: 'totp' }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Mã OTP không hợp lệ');

    completeLoginFlow(data.data);

  } catch (error) {
    showNotification(error.message, 'error');
    verifyBtn.disabled = false; verifyBtn.textContent = 'Xác nhận OTP';
  }
}

// ── Khởi tạo Form và Lắng nghe sự kiện ────────────────────
function initializeLoginForm() {
  ensureAnimations();
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  const verifyBtn = document.getElementById('verifyMfaBtn');
  if (verifyBtn) verifyBtn.addEventListener('click', handleVerifyMfa);

  const cancelBtn = document.getElementById('cancelMfaBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      // Reset giao diện về lúc chưa đăng nhập
      document.getElementById('mfaSection').style.display = 'none';
      document.getElementById('loginBtn').style.display = 'block';
      document.getElementById('loginBtn').disabled = false;
      document.getElementById('loginBtn').textContent = 'Đăng nhập';
      document.getElementById('google-signin-button').style.display = 'block';
      document.querySelector('.switch-auth').style.display = 'block';
      document.getElementById('mfaCode').value = '';
      currentMfaToken = null;
    });
  }
}

// ── 4. Xử lý Đăng nhập Google ─────────────────────────────
function initializeGoogleSignIn() {
  if (typeof google === 'undefined') return;
  google.accounts.id.initialize({
    client_id: '755787409662-tdmm13om66r0jeg0csi6rf916fhobrlq.apps.googleusercontent.com', 
    callback: handleGoogleSignIn
  });

  google.accounts.id.renderButton(
    document.getElementById('google-signin-button'),
    { theme: 'outline', size: 'large' }
  );
}

async function handleGoogleSignIn(response) {
  const loginBtn = document.getElementById('loginBtn');
  try {
    if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Đang xác thực...'; }

    const googleToken = response.credential;
    const res = await fetch(`${CONFIG.API_BASE_URL}/auth/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: googleToken }),
    });
    
    const data = await res.json();

    if (data.mfaRequired) {
      currentMfaToken = data.mfaToken || (data.data && data.data.mfaToken);
      loginBtn.style.display = 'none';
      document.getElementById('google-signin-button').style.display = 'none';
      document.querySelector('.switch-auth').style.display = 'none';
      document.getElementById('mfaSection').style.display = 'block';
      showNotification('Vui lòng nhập mã bảo mật (OTP)', 'info');
      return;
    }

    if (!res.ok || !data.success) throw new Error(data.message || 'Xác thực Google thất bại');

    completeLoginFlow(data.data);

  } catch (error) {
    showNotification(error.message, 'error');
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Đăng nhập'; }
  }
}

// ============================================================
// Animation Script (Original) - GIỮ NGUYÊN 100%
// ============================================================
document.addEventListener('DOMContentLoaded', function(){
	const target = document.getElementById('target');
	const ball = document.getElementById('ball');
	const kicker = document.getElementById('kicker');
	const throwHand = document.getElementById('throw-hand');
	const body = document.body;
	let animating = false;

	if(!target || !ball) {
        // Nếu trang không có animation (đang test form thuần), vẫn phải gọi init auth
        initializeLoginForm();
        initializeGoogleSignIn();
        return;
    }

	function showLoginAfterFlight(){
		body.classList.add('show-login');
		target.classList.add('pulse');
		setTimeout(()=> target.classList.remove('pulse'), 420);
	}

	function fireBall(){
		if(animating) return;
		animating = true;
		const aimEl = target.querySelector && (target.querySelector('circle') || target.querySelector('.ring.inner'));
		const rect = aimEl ? aimEl.getBoundingClientRect() : target.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;

		let startX = - (ball.offsetWidth || 44) - 60; 
		let startY = centerY;
		if(throwHand){
			const f = throwHand.getBoundingClientRect();
			startX = f.left + f.width/2;
			startY = f.top + f.height/2;
			startY -= 6;
		}
		const endX = centerX;

		ball.style.visibility = 'visible';
		ball.style.transform = 'translate(-50%,-50%)';

		const p0 = { x: startX, y: startY };
		const p2 = { x: endX, y: centerY };
		const peak = Math.max(120, Math.abs(p2.x - p0.x) * 0.35);
		const p1 = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - peak };

		if(kicker) kicker.classList.add('throw');

		const duration = 600; 
		let startTime = null;

		function bezier(t, a, b, c){
			const u = 1 - t;
			return u*u*a + 2*u*t*b + t*t*c;
		}

		function step(ts){
			if(!startTime) startTime = ts;
			const t = Math.min((ts - startTime) / duration, 1);
			const x = bezier(t, p0.x, p1.x, p2.x);
			const y = bezier(t, p0.y, p1.y, p2.y);
			ball.style.left = x + 'px';
			ball.style.top = y + 'px';
			if(t < 1){
				requestAnimationFrame(step);
			} else {
				ball.classList.add('embedded');
				const inner = target.querySelector('.ring.inner');
				if(inner){ inner.classList.add('pierced'); }
				else if(target.classList && target.classList.contains('basket')){
					target.classList.remove('in-basket','pulse');
					void target.offsetWidth; 
					target.classList.add('in-basket','pulse');
					setTimeout(()=> target.classList.remove('pulse'), 420);
				}
				showLoginAfterFlight();
				if(kicker) kicker.classList.remove('throw');
				animating = false;
			}
		}

		requestAnimationFrame(step);
	}

	target.addEventListener('click', function(e){
		fireBall();
	});

	target.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fireBall(); } });

	setTimeout(()=>{
		if(!body.classList.contains('show-login')){
			fireBall();
		}
	}, 360);

	// Initialize form handlers
	initializeLoginForm();
	initializeGoogleSignIn();
});