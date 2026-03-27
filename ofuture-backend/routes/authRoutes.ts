// routes/authRoutes.ts
// ─────────────────────────────────────────────
// Authentication routes with tight rate limiting
// applied separately to each sensitive endpoint.
// ─────────────────────────────────────────────

import express from 'express';
import rateLimit from 'express-rate-limit';
const { register, login, refreshToken, logout, getMe, updateMe, deleteMe, verifyEmail, resendOtp, googleLogin, forgotPassword, resetPassword } = require('../controllers/authController');
const { authenticate }     = require('../middleware/auth');
const { noCache, autobanCheck } = require('../middleware/security');
const { rotateCsrfToken } = require('../middleware/csrf');
const { validateRegister, validateLogin, validateRefreshToken, validateUpdateProfile, validateDeleteAccount, validateForgotPassword, validateResetPassword } = require('../middleware/validate');

const router = express.Router();

// ── Strict rate limits for auth endpoints ─────

// Register: 5 accounts per IP per hour
const registerLimiter = rateLimit({
  windowMs : 1 * 60 * 1000,
  max      : 5,
  message  : { success: false, message: 'Too many registration attempts. Try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

// Login: 10 attempts per IP per 15 minutes
const loginLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 10,
  message  : { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

// OTP verify/resend limiters: 15 lần / 15 phút
const otpLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 15,
  message  : { success: false, message: 'Too many OTP attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

// Token refresh: 30 per 15 minutes
const refreshLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 30,
  message  : { success: false, message: 'Too many refresh requests.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

// ── Route Definitions ─────────────────────────

router.post('/register', registerLimiter, validateRegister, register);

router.post('/login', loginLimiter, noCache, autobanCheck, validateLogin, rotateCsrfToken, login);

router.post('/refresh', refreshLimiter, noCache, validateRefreshToken, refreshToken);

router.post('/logout', authenticate, logout);

router.get('/me', authenticate, getMe);

router.put('/me', authenticate, validateUpdateProfile, updateMe);

router.delete('/me', authenticate, validateDeleteAccount, deleteMe);

router.post('/verify-email', otpLimiter, verifyEmail);

router.post('/resend-otp', otpLimiter, resendOtp);

router.post('/google-login', loginLimiter, noCache, autobanCheck, googleLogin);

router.post('/forgot-password', otpLimiter, validateForgotPassword, forgotPassword);

router.post('/reset-password', otpLimiter, validateResetPassword, resetPassword);

export = router;