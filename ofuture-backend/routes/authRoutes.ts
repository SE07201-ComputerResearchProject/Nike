// routes/authRoutes.ts
// ─────────────────────────────────────────────
// Authentication routes with tight rate limiting
// applied separately to each sensitive endpoint.
// ─────────────────────────────────────────────

import express from 'express';
import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import UserModel from '../models/userModel';
import { uploadImages } from '../middleware/upload';
import { pool } from '../config/db';
const { register, login, refreshToken, logout, getMe, verifyEmail, resendOtp, googleLogin, uploadAvatar, getDevices, revokeDevice } = require('../controllers/authController');
const { authenticate }     = require('../middleware/auth');
const { noCache, autobanCheck } = require('../middleware/security');
const { rotateCsrfToken } = require('../middleware/csrf');
const { validateRegister, validateLogin, validateRefreshToken } = require('../middleware/validate');

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


// PUT /api/auth/profile  — update fullName + phone
router.put(
  '/profile',
  authenticate,
  [
    body('fullName').optional().trim().isLength({ min: 2, max: 150 }).escape(),
    body('phone').optional().isMobilePhone('any').withMessage('Invalid phone number.'),
  ],
  async (req: any, res: Response): Promise<any> => {
    const { fullName, phone } = req.body;
    try {
      await UserModel.updateProfile(req.user.id, {
        fullName : fullName ?? null,
        phone    : phone    ?? null,
        avatarUrl: null,
      });
      res.status(200).json({ success: true, message: 'Profile updated.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Update failed.' });
    }
  }
);

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password required.'),
    body('newPassword')
      .isLength({ min: 8 }).withMessage('Min 8 characters.')
      .matches(/[A-Z]/).withMessage('Needs uppercase.')
      .matches(/[a-z]/).withMessage('Needs lowercase.')
      .matches(/\d/).withMessage('Needs number.')
      .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Needs special char.'),
  ],
  async (req: any, res: Response): Promise<any> => {
    const { currentPassword, newPassword } = req.body;
    try {
      const user = await UserModel.findByEmail(req.user.email);
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

      const match = await bcrypt.compare(currentPassword, user.password_hash);
      if (!match) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });

      const hash = await bcrypt.hash(newPassword, 12);
      await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);

      // Revoke all sessions so stolen tokens are invalidated
      await pool.execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [req.user.id]);

      res.status(200).json({ success: true, message: 'Password changed. Please log in again.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to change password.' });
    }
  }
);

// ── Route Definitions ─────────────────────────

router.post('/register', registerLimiter, validateRegister, register);

router.post('/login', loginLimiter, noCache, autobanCheck, validateLogin, rotateCsrfToken, login);

router.post('/refresh', refreshLimiter, noCache, validateRefreshToken, refreshToken);

router.post('/logout', authenticate, logout);

router.get('/me', authenticate, getMe);

router.post('/verify-email', otpLimiter, verifyEmail);

router.post('/resend-otp', otpLimiter, resendOtp);

router.post('/google-login', loginLimiter, noCache, autobanCheck, googleLogin);

// ── Avatar & Devices ───────────────────────────────
router.post('/avatar', authenticate, uploadImages.single('avatar'), uploadAvatar);

router.get('/devices', authenticate, getDevices);

router.delete('/devices/:id', authenticate, revokeDevice);

export = router;