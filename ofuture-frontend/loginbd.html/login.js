// ============================================================
// O'Future Login Form Handler
// Handles authentication and redirect to index.html
// ============================================================

const CONFIG = {
  API_BASE_URL: 'http://localhost:5000/api',
  LOGIN_ENDPOINT: '/auth/login',
};

// Show notification/toast message
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background-color: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Add CSS animations
function ensureAnimations() {
  if (!document.getElementById('login-animations')) {
    const style = document.createElement('style');
    style.id = 'login-animations';
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

// Handle login form submission
async function handleLoginSubmit(event) {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const loginBtn = document.getElementById('loginBtn');

  // CAPTCHA temporarily disabled for testing — skip client-side check

  if (!email || !password) {
    showNotification('Please enter email and password', 'error');
    return;
  }

  try {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Đang đăng nhập...';

    const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.LOGIN_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      console.log('=== LOGIN SUCCESS ===');
      console.log('Full response:', data);
      console.log('User data:', data.data?.user || data.user);
      console.log('User Role:', data.data?.user?.role || data.user?.role);
      
      // Save tokens to localStorage
      if (data.data?.accessToken) {
        localStorage.setItem('accessToken', data.data.accessToken);
      }
      if (data.data?.refreshToken) {
        localStorage.setItem('refreshToken', data.data.refreshToken);
      }
      if (data.data?.user) {
        localStorage.setItem('user', JSON.stringify(data.data.user));
      }

      showNotification('Login successful! Redirecting...', 'success');
      
      // Role-based redirect
      const user = data.data?.user || data.user;
      const userRole = user?.role;
      
      console.log('Extracted role:', userRole);
      console.log('Type of role:', typeof userRole);
      
      if (!userRole) {
        console.warn('⚠️  WARNING: User role not found!');
        console.log('Full user object:', user);
      }
      
      const APP_ROOT = `${window.location.origin}/Nike/ofuture-frontend`;
      let redirectUrl = `${APP_ROOT}/index.html`; // default for buyer/user
      
      if (userRole === 'admin') {
        redirectUrl = `${APP_ROOT}/dashboard-admin/index.html`;
        console.log('✓ Admin user detected - redirecting to admin dashboard');
      } else if (userRole === 'seller') {
        redirectUrl = `${APP_ROOT}/dashboard-seller/index.html`;
        console.log('✓ Seller user detected');
      } else if (userRole === 'buyer') {
        redirectUrl = `${APP_ROOT}/index.html`;
        console.log('✓ Buyer user detected');
      } else {
        console.warn('⚠️  Unknown role - defaulting to home page. Role value:', userRole);
      }
      
      console.log('Final redirect URL:', redirectUrl);
      
      // Redirect after 500ms
      setTimeout(() => {
        console.log('Executing redirect to:', redirectUrl);
        window.location.href = redirectUrl;
      }, 500);
    } else {
      console.log('Login failed - response.ok:', response.ok, 'data.success:', data.success);
      showNotification(data.message || 'Login failed. Please try again.', 'error');
      loginBtn.disabled = false;
      loginBtn.textContent = 'Đăng nhập';
    }
  } catch (error) {
    console.error('Login error:', error);
    showNotification('Network error. Please try again.', 'error');
    loginBtn.disabled = false;
    loginBtn.textContent = 'Đăng nhập';
  }
}

// Initialize login form
function initializeLoginForm() {
  ensureAnimations();
  
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
  }
}

// ============================================================
// Animation Script (Original)
// ============================================================
// Lamp removed - no interactive JS required for lamp. Keep file present but empty.
document.addEventListener('DOMContentLoaded', function(){
	const target = document.getElementById('target');
		const ball = document.getElementById('ball');
		const kicker = document.getElementById('kicker');
		const throwHand = document.getElementById('throw-hand');
	const body = document.body;
	let animating = false;

	if(!target || !ball) return;

	function showLoginAfterFlight(){
		// show login and let CSS hide the throw scene together
		body.classList.add('show-login');
		// short pulse on the target
		target.classList.add('pulse');
		setTimeout(()=> target.classList.remove('pulse'), 420);
	}

	function fireBall(){
		if(animating) return;
		animating = true;
		// compute aim point in viewport coordinates (prefer an inner circle if present, e.g., basket opening)
		const aimEl = target.querySelector && (target.querySelector('circle') || target.querySelector('.ring.inner'));
		const rect = aimEl ? aimEl.getBoundingClientRect() : target.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;

		// determine start position from throw-hand if available, otherwise offscreen left
		let startX = - (ball.offsetWidth || 44) - 60; // default offscreen
		let startY = centerY;
		if(throwHand){
			const f = throwHand.getBoundingClientRect();
			startX = f.left + f.width/2;
			startY = f.top + f.height/2;
			// nudge the startY a bit upward so ball looks like it's released from hand
			startY -= 6;
		}
		const endX = centerX;
		const offsetStartX = startX - endX; // negative if left of target
		const offsetStartY = startY - centerY; // vertical offset

		// show ball and animate along a parabolic (quadratic Bezier) path from hand to basket
		ball.style.visibility = 'visible';
		ball.style.transform = 'translate(-50%,-50%)';

		// compute control point for a Bezier curve (peak above the middle)
		const p0 = { x: startX, y: startY };
		const p2 = { x: endX, y: centerY };
		const peak = Math.max(120, Math.abs(p2.x - p0.x) * 0.35);
		const p1 = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - peak };

		// trigger kicker throw animation (if present)
		if(kicker) kicker.classList.add('throw');

		const duration = 600; // ms (shorter flight for faster feel)
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
				// arrival
				ball.classList.add('embedded');
				const inner = target.querySelector('.ring.inner');
				if(inner){ inner.classList.add('pierced'); }
				else if(target.classList && target.classList.contains('basket')){
					// ensure the basket shake/pulse animation starts immediately on impact
					// remove then re-add to restart animation, forcing a reflow between
					target.classList.remove('in-basket','pulse');
					void target.offsetWidth; // force reflow
					target.classList.add('in-basket','pulse');
					setTimeout(()=> target.classList.remove('pulse'), 420);
				}
				// immediately switch to centered login and hide kicker + money + basket together
				showLoginAfterFlight();
				if(kicker) kicker.classList.remove('throw');
				animating = false;
			}
		}

		requestAnimationFrame(step);
	}

	// clicking the target no longer toggles the login; it only triggers a throw for fun
	target.addEventListener('click', function(e){
		// fire again on manual click, but do not open/close the login
		fireBall();
	});

	// keyboard accessibility (Enter or Space triggers a throw)
	target.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fireBall(); } });

	// auto-start the throw when the page loads (small delay to let layout settle)
	setTimeout(()=>{
		if(!body.classList.contains('show-login')){
			fireBall();
		}
	}, 360);

	// Initialize login form after DOM is ready
	initializeLoginForm();

	// Initialize Google Sign-In
	initializeGoogleSignIn();
});

// Initialize Google Sign-In
function initializeGoogleSignIn() {
  google.accounts.id.initialize({
    client_id: 'YOUR_GOOGLE_CLIENT_ID', // Replace with your actual client ID
    callback: handleGoogleSignIn
  });

  google.accounts.id.renderButton(
    document.getElementById('google-signin-button'),
    { theme: 'outline', size: 'large' }
  );
}

// Handle Google Sign-In response
async function handleGoogleSignIn(response) {
  try {
    const googleToken = response.credential;

    const loginResponse = await fetch(`${CONFIG.API_BASE_URL}/auth/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: googleToken }),
    });

    const data = await loginResponse.json();

    if (loginResponse.ok && data.success) {
      // Similar to regular login
      if (data.data?.accessToken) {
        localStorage.setItem('accessToken', data.data.accessToken);
      }
      if (data.data?.refreshToken) {
        localStorage.setItem('refreshToken', data.data.refreshToken);
      }
      if (data.data?.user) {
        localStorage.setItem('user', JSON.stringify(data.data.user));
      }

      showNotification('Google login successful! Redirecting...', 'success');

      // Role-based redirect (similar logic)
      const user = data.data?.user || data.user;
      const userRole = user?.role;
      const APP_ROOT = `${window.location.origin}/Nike/ofuture-frontend`;
      let redirectUrl = `${APP_ROOT}/index.html`;

      if (userRole === 'admin') {
        redirectUrl = `${APP_ROOT}/dashboard-admin/index.html`;
      } else if (userRole === 'seller') {
        redirectUrl = `${APP_ROOT}/dashboard-seller/index.html`;
      }

      setTimeout(() => {
        window.location.href = redirectUrl;
      }, 500);
    } else {
      showNotification(data.message || 'Google login failed', 'error');
    }
  } catch (error) {
    console.error('Google login error:', error);
    showNotification('Google login error', 'error');
  }
}
