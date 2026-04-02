// ============================================================
// O'Future Register Feature
// Handles: Password Validation, Role Selection
// ============================================================

// Configuration
const CONFIG = {
  API_BASE_URL: 'http://localhost:5000/api',
  REGISTER_ENDPOINT: '/auth/register',
};

// State management
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
  passwordRequirements: document.getElementById('passwordRequirements'),
  confirmStatus: document.getElementById('confirmStatus'),
  submitBtn: document.getElementById('submitBtn'),
};

// ── Password Validation ──────────────────────────────────
const passwordRules = {
  length: /^.{8,}$/,           // At least 8 characters
  uppercase: /[A-Z]/,           // At least 1 uppercase
  lowercase: /[a-z]/,           // At least 1 lowercase
  number: /\d/,                 // At least 1 number
  special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,  // At least 1 special char
};

const passwordRequirementIds = {
  length: 'req-length',
  uppercase: 'req-uppercase',
  lowercase: 'req-lowercase',
  number: 'req-number',
  special: 'req-special',
};

// ── Utility Functions ─────────────────────────────────────

/**
 * Check if password meets all requirements
 */
function validatePassword(pwd) {
  const results = {};
  for (const [key, regex] of Object.entries(passwordRules)) {
    results[key] = regex.test(pwd);
  }
  return results;
}

/**
 * Check if all password requirements are met
 */
function isPasswordValid(pwd) {
  const validation = validatePassword(pwd);
  return Object.values(validation).every((isValid) => isValid);
}

/**
 * Update password requirements UI
 */
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

/**
 * Check if passwords match
 */
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



/**
 * Update submit button state
 */
function updateSubmitButton() {
  const pwd = elements.password.value;
  const confirmPwd = elements.confirmPassword.value;
  const fullName = elements.fullName.value.trim();
  const email = elements.email.value.trim();
  const username = elements.username.value.trim();

  const isFormValid =
    fullName &&
    email &&
    username &&
    appState.isPasswordValid &&
    pwd === confirmPwd;

  elements.submitBtn.disabled = !isFormValid;
}



/**
 * Show notification/toast message
 */
function showNotification(message, type = 'info') {
  // Create notification element
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

/**
 * Add CSS animations if not already present
 */
function ensureAnimations() {
  if (!document.getElementById('register-animations')) {
    const style = document.createElement('style');
    style.id = 'register-animations';
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

// ── API Calls ─────────────────────────────────────────────

/**
 * Submit registration form
 */
async function submitRegistration(event) {
  event.preventDefault();

  if (!appState.isPasswordValid) {
    showNotification('Please complete all required fields correctly', 'error');
    return;
  }

  const formData = {
    fullName: elements.fullName.value.trim(),
    email: elements.email.value.trim(),
    username: elements.username.value.trim(),
    phone: elements.phone.value.trim() || null,
    password: elements.password.value,
    confirmPassword: elements.confirmPassword.value,
    role: elements.role.value,
  };

  if (formData.password !== formData.confirmPassword) {
    showNotification('Passwords do not match', 'error');
    return;
  }

  try {
    elements.submitBtn.disabled = true;
    elements.submitBtn.textContent = 'Creating account...';

    const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.REGISTER_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: formData.fullName,
        email: formData.email,
        username: formData.username,
        phone: formData.phone,
        password: formData.password,
        role: formData.role,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      showNotification('Registration successful! Redirecting to login...', 'success');
      setTimeout(() => {
        window.location.href = 'loginbd.html/login.html';
      }, 1500);
    } else {
      showNotification(data.message || 'Registration failed', 'error');
      elements.submitBtn.disabled = false;
      elements.submitBtn.textContent = 'Dang ky';
    }
  } catch (error) {
    console.error('Error during registration:', error);
    showNotification('Network error. Please try again.', 'error');
    elements.submitBtn.disabled = false;
    elements.submitBtn.textContent = 'Dang ky';
  }
}

// ── Event Listeners ───────────────────────────────────────

/**
 * Initialize all event listeners
 */
function initializeEventListeners() {
  // Password validation - real-time feedback
  elements.password.addEventListener('input', updatePasswordRequirements);
  elements.password.addEventListener('change', updatePasswordRequirements);

  // Confirm password match
  elements.confirmPassword.addEventListener('input', () => {
    checkPasswordMatch();
    updateSubmitButton();
  });

  // Enable/disable based on form state
  elements.fullName.addEventListener('input', updateSubmitButton);
  elements.email.addEventListener('input', updateSubmitButton);
  elements.username.addEventListener('input', updateSubmitButton);

  // Form submission
  elements.form.addEventListener('submit', submitRegistration);
}

// ── Initialization ────────────────────────────────────────

/**
 * Initialize the register form
 */
function initializeRegisterForm() {
  ensureAnimations();
  initializeEventListeners();

  // Initialize password requirements
  updatePasswordRequirements();
  updateSubmitButton();

  console.log('Register form initialized');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeRegisterForm);
} else {
  initializeRegisterForm();
}
