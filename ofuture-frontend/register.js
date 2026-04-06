// ============================================================
// O'Future Register Feature
// ============================================================

const appState = {
  isPasswordValid: false,
};

// ── DOM Elements ──────────────────────────────────────────
const elements = {
  form: document.getElementById('registerForm'),
  fullName: document.getElementById('fullName'),
  email: document.getElementById('email'),
  username: document.getElementById('username'),
  phone: document.getElementById('phone'),
  role: document.getElementById('role'),
  password: document.getElementById('password'),
  confirmPassword: document.getElementById('confirmPassword'),
  confirmStatus: document.getElementById('confirmStatus'),
  submitBtn: document.getElementById('submitBtn'),
};

// ── Password Validation ──────────────────────────────────
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

// ── Utility Functions ─────────────────────────────────────
function validatePassword(pwd) {
  const results = {};
  for (const [key, regex] of Object.entries(passwordRules)) {
    results[key] = regex.test(pwd);
  }
  return results;
}

function isPasswordValid(pwd) {
  return Object.values(validatePassword(pwd)).every((isValid) => isValid);
}

function updatePasswordRequirements() {
  const pwd = elements.password.value;
  const validation = validatePassword(pwd);

  for (const [key, isValid] of Object.entries(validation)) {
    const reqId = passwordRequirementIds[key];
    const reqElement = document.getElementById(reqId);
    if (reqElement) {
      reqElement.classList.toggle('met', isValid);
      reqElement.classList.toggle('unmet', !isValid);
    }
  }

  appState.isPasswordValid = isPasswordValid(pwd);
  updateSubmitButton();
}

function checkPasswordMatch() {
  const pwd = elements.password.value;
  const confirmPwd = elements.confirmPassword.value;

  if (!confirmPwd) {
    elements.confirmStatus.textContent = '';
    elements.confirmStatus.className = 'password-match-status';
    return false;
  }

  const isMatch = pwd === confirmPwd;
  elements.confirmStatus.textContent = isMatch ? '✓ Passwords match' : '✗ Passwords do not match';
  elements.confirmStatus.className = `password-match-status ${isMatch ? 'match' : 'mismatch'}`;

  return isMatch;
}

function updateSubmitButton() {
  const isFormValid =
    elements.fullName.value.trim() &&
    elements.email.value.trim() &&
    elements.username.value.trim() &&
    appState.isPasswordValid &&
    elements.password.value === elements.confirmPassword.value;

  elements.submitBtn.disabled = !isFormValid;
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; padding: 12px 20px;
    background-color: ${type === 'success' ? '#10b981' : '#ef4444'};
    color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000; animation: slideIn 0.3s ease-out;
  `;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3500);
}

function ensureAnimations() {
  if (!document.getElementById('register-animations')) {
    const style = document.createElement('style');
    style.id = 'register-animations';
    style.textContent = `
      @keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }
    `;
    document.head.appendChild(style);
  }
}

// ── API Integration (Integration Phase) ────────────────────
async function submitRegistration(event) {
  event.preventDefault();

  if (!appState.isPasswordValid || elements.password.value !== elements.confirmPassword.value) {
    showNotification('Vui lòng hoàn thiện đúng các trường yêu cầu', 'error');
    return;
  }

  // Khớp chính xác với payload mà authController.ts đang bóc tách
  const payload = {
    fullName: elements.fullName.value.trim(), 
    email: elements.email.value.trim(),
    username: elements.username.value.trim(),
    phone: elements.phone.value.trim() || undefined,
    password: elements.password.value,
    role: elements.role.value,
  };

  try {
    elements.submitBtn.disabled = true;
    elements.submitBtn.textContent = 'Đang xử lý...';

    // Gọi API thông qua wrapper chung api.js
    const response = await fetchAPI('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (response.success) {
      showNotification('Đăng ký thành công! Vui lòng kiểm tra Email để lấy mã OTP.', 'success');
      
      // Chuyển hướng về trang đăng nhập sau 2.5 giây để User kịp đọc thông báo
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 2500);
    }
  } catch (error) {
    console.error('Lỗi đăng ký:', error);
    showNotification(error.message || 'Lỗi kết nối máy chủ. Vui lòng thử lại.', 'error');
  } finally {
    elements.submitBtn.disabled = false;
    elements.submitBtn.textContent = 'Đăng ký';
  }
}

// ── Initialization ────────────────────────────────────────
function initializeRegisterForm() {
  ensureAnimations();
  
  elements.password.addEventListener('input', updatePasswordRequirements);
  elements.password.addEventListener('change', updatePasswordRequirements);
  elements.confirmPassword.addEventListener('input', () => { checkPasswordMatch(); updateSubmitButton(); });
  elements.fullName.addEventListener('input', updateSubmitButton);
  elements.email.addEventListener('input', updateSubmitButton);
  elements.username.addEventListener('input', updateSubmitButton);
  
  elements.form.addEventListener('submit', submitRegistration);

  updatePasswordRequirements();
  updateSubmitButton();
}

document.addEventListener('DOMContentLoaded', initializeRegisterForm);