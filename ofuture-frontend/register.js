// ============================================================
// O'Future - Đăng ký & Xác thực OTP (Sử dụng fetchAPI)
// ============================================================

const appState = {
  isPasswordValid: false,
  registeredEmail: null 
};

// ── DOM Elements ──────────────────────────────────────────
const elements = {
  form: document.getElementById('registerForm'),
  fullName: document.getElementById('fullName'),
  email: document.getElementById('email'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  confirmPassword: document.getElementById('confirmPassword'),
  confirmStatus: document.getElementById('confirmStatus'),
  submitBtn: document.getElementById('submitBtn'),
  // Modal OTP
  otpModal: document.getElementById('otpModal'),
  otpInput: document.getElementById('otpInput'),
  verifyOtpBtn: document.getElementById('verifyOtpBtn'),
  resendOtpBtn: document.getElementById('resendOtpBtn'),
  displayOtpEmail: document.getElementById('displayOtpEmail')
};

// ── Password Validation Rules ──────────────────────────────
const passwordRules = {
  length: /^.{8,}$/,           
  uppercase: /[A-Z]/,          
  lowercase: /[a-z]/,          
  number: /\d/,                
  special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 
};

const passwordRequirementIds = {
  length: 'req-length',
  uppercase: 'req-uppercase',
  lowercase: 'req-lowercase',
  number: 'req-number',
  special: 'req-special',
};

// ── Thông báo (Toast) ──────────────────────────────────────
function showNotification(message, type = 'info') {
  // Thay vì alert thô kệch, tạo thông báo đẹp trên màn hình
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; padding: 12px 24px;
    background: ${type === 'success' ? '#10b981' : '#ef4444'}; color: white;
    border-radius: 8px; z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3500);
}

// ── Logic UI: Kiểm tra mật khẩu ────────────────────────────
function updatePasswordRequirements() {
  if (!elements.password) return;
  const pwd = elements.password.value;
  let allValid = true;

  for (const [ruleName, regex] of Object.entries(passwordRules)) {
    const isValid = regex.test(pwd);
    if (!isValid) allValid = false;
    
    const reqElement = document.getElementById(passwordRequirementIds[ruleName]);
    if (reqElement) {
      if (isValid) {
        reqElement.classList.add('met');
        reqElement.style.color = '#10b981';
        reqElement.querySelector('.requirement-icon').textContent = '✓';
      } else {
        reqElement.classList.remove('met');
        reqElement.style.color = '#64748b';
        reqElement.querySelector('.requirement-icon').textContent = '○';
      }
    }
  }
  appState.isPasswordValid = allValid;
  checkPasswordMatch();
  updateSubmitButton();
}

function checkPasswordMatch() {
  const pwd = elements.password.value;
  const confirmPwd = elements.confirmPassword.value;
  
  if (confirmPwd.length === 0) {
    elements.confirmStatus.textContent = '';
    return false;
  }
  
  if (pwd === confirmPwd) {
    elements.confirmStatus.textContent = 'Mật khẩu trùng khớp ✓';
    elements.confirmStatus.style.color = '#10b981';
    return true;
  } else {
    elements.confirmStatus.textContent = 'Mật khẩu không khớp ✗';
    elements.confirmStatus.style.color = '#ef4444';
    return false;
  }
}

function updateSubmitButton() {
  const isFormFilled = elements.fullName.value.trim() && elements.email.value.trim() && elements.username.value.trim();
  const isMatch = elements.password.value === elements.confirmPassword.value && elements.confirmPassword.value.length > 0;
  elements.submitBtn.disabled = !(isFormFilled && appState.isPasswordValid && isMatch);
}

// ── API: 1. Đăng ký để lấy OTP ─────────────────────────────
async function submitRegistration(e) {
  e.preventDefault();
  if (!appState.isPasswordValid || elements.password.value !== elements.confirmPassword.value) return;

  const payload = {
    fullName: elements.fullName.value.trim(),
    email: elements.email.value.trim(),
    username: elements.username.value.trim(),
    password: elements.password.value
  };

  try {
    elements.submitBtn.disabled = true;
    elements.submitBtn.textContent = 'Đang xử lý...';

    // Dùng fetchAPI từ file api.js
    const response = await fetchAPI('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (response.success) {
      showNotification('Đăng ký thành công! Vui lòng kiểm tra Email để lấy mã OTP.', 'success');
      appState.registeredEmail = payload.email;
      elements.displayOtpEmail.textContent = payload.email;
      
      // Hiện Modal OTP lên
      elements.otpModal.style.display = 'flex';
    }
  } catch (error) {
    showNotification(error.message || 'Email hoặc Username đã tồn tại.', 'error');
  } finally {
    elements.submitBtn.disabled = false;
    elements.submitBtn.textContent = 'Đăng ký tài khoản';
  }
}

// ── API: 2. Gửi mã OTP & CHUYỂN HƯỚNG TỚI HOÀN THIỆN HỒ SƠ ─
async function verifyOtp() {
  const otp = elements.otpInput.value.trim();
  if (otp.length !== 6) return showNotification('Vui lòng nhập đủ 6 số OTP.', 'error');

  try {
    elements.verifyOtpBtn.disabled = true;
    elements.verifyOtpBtn.textContent = 'Đang xác thực...';

    // Dùng fetchAPI gọi verify-email
    const response = await fetchAPI('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email: appState.registeredEmail, otp: otp })
    });

    if (response.success) {
      showNotification('Xác thực Email thành công! Đang chuyển hướng...', 'success');
      
      // Backend thường trả về Token sau khi verify thành công.
      // Lưu lại Token để Bypass trang Login, đi thẳng vào Complete Profile.
      if (response.data && response.data.accessToken) {
        localStorage.setItem('accessToken', response.data.accessToken);
        if (response.data.refreshToken) localStorage.setItem('refreshToken', response.data.refreshToken);
        if (response.data.user) localStorage.setItem('user', JSON.stringify(response.data.user));
      }

      // CHUYỂN HƯỚNG BẺ LÁI THẲNG SANG HOÀN THIỆN HỒ SƠ
      setTimeout(() => { 
        window.location.href = 'dashboard-buyer/complete-profile/index.html'; 
      }, 1000);
    }
  } catch (error) {
    showNotification(error.message || 'Mã OTP không hợp lệ hoặc đã hết hạn.', 'error');
    elements.verifyOtpBtn.disabled = false;
    elements.verifyOtpBtn.textContent = 'Xác minh & Tiếp tục';
  }
}

// ── API: 3. Gửi lại mã OTP ─────────────────────────────────
async function resendOtp() {
  try {
    const response = await fetchAPI('/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ email: appState.registeredEmail })
    });
    
    if (response.success) {
      showNotification('Mã OTP mới đã được gửi vào email của bạn.', 'success');
    }
  } catch (error) {
    showNotification(error.message || 'Không thể gửi lại mã OTP lúc này.', 'error');
  }
}

// ── Khởi tạo ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (elements.password) {
    elements.password.addEventListener('input', updatePasswordRequirements);
  }
  if (elements.confirmPassword) {
    elements.confirmPassword.addEventListener('input', () => { checkPasswordMatch(); updateSubmitButton(); });
  }
  if (elements.fullName) elements.fullName.addEventListener('input', updateSubmitButton);
  if (elements.email) elements.email.addEventListener('input', updateSubmitButton);
  if (elements.username) elements.username.addEventListener('input', updateSubmitButton);
  
  if (elements.form) elements.form.addEventListener('submit', submitRegistration);
  if (elements.verifyOtpBtn) elements.verifyOtpBtn.addEventListener('click', verifyOtp);
  if (elements.resendOtpBtn) elements.resendOtpBtn.addEventListener('click', resendOtp);
});