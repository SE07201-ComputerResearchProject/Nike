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
import { validationResult } from 'express-validator';
import { pool } from '../config/db';
import NotificationService from '../services/notificationService';
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


// PUT /api/auth/profile  — Hoàn thiện hồ sơ (Update users + user_profiles)
router.put(
  '/profile',
  authenticate,
  [
    body('fullName').optional().trim().isLength({ min: 2, max: 150 }).escape(),
    body('phone').optional().isMobilePhone('any').withMessage('Invalid phone number.'),
    body('role').optional().isIn(['buyer', 'seller']).withMessage('Role must be buyer or seller.'),
    body('address').optional().trim().escape(),
    body('city').optional().trim().escape(),
    body('store_name').optional().trim().escape(),
    body('category').optional().trim().escape(),
    body('scale').optional().trim().escape(),
  ],
  async (req: any, res: Response): Promise<any> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { fullName, phone, role, address, city, store_name, category, scale } = req.body;
    const userId = req.user.id;

    if (req.user.role === 'seller') {
      return res.status(403).json({
        success: false,
        message: 'Thông tin seller không được đổi trực tiếp. Vui lòng gửi yêu cầu duyệt tới Admin.'
      });
    }

    // Lấy kết nối riêng để chạy Transaction (Đảm bảo ghi vào 2 bảng cùng lúc an toàn)
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // ==========================================
      // BƯỚC 1: CẬP NHẬT BẢNG `users` (Thông tin cốt lõi)
      // ==========================================
      const userUpdates: string[] = [];
      const userValues: any[] = [];

      if (fullName) { userUpdates.push('full_name = ?'); userValues.push(fullName); }
      if (phone) { userUpdates.push('phone = ?'); userValues.push(phone); }
      if (role) { userUpdates.push('role = ?'); userValues.push(role); }

      if (userUpdates.length > 0) {
        userValues.push(userId);
        await connection.execute(
          `UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`,
          userValues
        );
      }

      // ==========================================
      // BƯỚC 2: CẬP NHẬT BẢNG `user_profiles` (Thông tin mở rộng)
      // ==========================================
      // Kỹ thuật UPSERT: Nếu chưa có profile thì INSERT, có rồi thì UPDATE
      const profileSql = `
        INSERT INTO user_profiles (user_id, address, city, store_name, category, scale)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          address = VALUES(address),
          city = VALUES(city),
          store_name = VALUES(store_name),
          category = VALUES(category),
          scale = VALUES(scale)
      `;
      
      const profileValues = [
        userId,
        address || null,
        city || null,
        role === 'seller' ? (store_name || null) : null, // Chỉ lưu cửa hàng nếu là Seller
        role === 'seller' ? (category || null) : null,
        role === 'seller' ? (scale || 'small') : 'small'
      ];

      await connection.execute(profileSql, profileValues);

      // Lưu giao dịch thành công
      await connection.commit();
      res.status(200).json({ success: true, message: 'Hồ sơ đã được cập nhật hoàn chỉnh.', data: { role } });

    } catch (err) {
      // Nếu có lỗi ở bất kỳ bước nào, hủy toàn bộ giao dịch (Không lưu nửa vời)
      await connection.rollback();
      console.error('Update profile transaction error:', err);
      res.status(500).json({ success: false, message: 'Update failed due to server error.' });
    } finally {
      // Trả connection về pool
      connection.release();
    }
  }
);

// POST /api/auth/profile-change-request
// Seller submits profile change request for admin approval.
router.post(
  '/profile-change-request',
  authenticate,
  [
    body('fullName').optional().trim().isLength({ min: 2, max: 150 }).escape(),
    body('phone').optional().isMobilePhone('any').withMessage('Invalid phone number.'),
    body('address').optional().trim().escape(),
    body('city').optional().trim().escape(),
    body('store_name').optional().trim().escape(),
    body('category').optional().trim().escape(),
    body('scale').optional().trim().escape(),
  ],
  async (req: any, res: Response): Promise<any> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.user.id;
    const userRole = req.user.role;
    const { fullName, phone, address, city, store_name, category, scale } = req.body;

    if (userRole !== 'seller') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ tài khoản seller mới cần gửi yêu cầu duyệt thay đổi hồ sơ.'
      });
    }

    const requestedChanges = {
      fullName: fullName ?? null,
      phone: phone ?? null,
      address: address ?? null,
      city: city ?? null,
      store_name: store_name ?? null,
      category: category ?? null,
      scale: scale ?? null
    };

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(`
        CREATE TABLE IF NOT EXISTS seller_profile_change_requests (
          id CHAR(36) NOT NULL DEFAULT (UUID()),
          seller_id CHAR(36) NOT NULL,
          requested_changes JSON NOT NULL,
          status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
          admin_note TEXT NULL,
          reviewed_by CHAR(36) NULL,
          reviewed_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_spcr_seller (seller_id),
          INDEX idx_spcr_status (status),
          CONSTRAINT fk_spcr_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      const [pendingRows]: any = await connection.execute(
        `SELECT id FROM seller_profile_change_requests
         WHERE seller_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (pendingRows.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: 'Bạn đã có một yêu cầu thay đổi hồ sơ đang chờ Admin duyệt.'
        });
      }

      await connection.execute(
        `INSERT INTO seller_profile_change_requests (id, seller_id, requested_changes, status)
         VALUES (UUID(), ?, ?, 'pending')`,
        [userId, JSON.stringify(requestedChanges)]
      );

      const [admins]: any = await connection.execute(
        `SELECT id FROM users WHERE role = 'admin' AND is_active = 1`
      );

      await connection.commit();

      for (const admin of admins) {
        await NotificationService.sendAlert(
          admin.id,
          'Yêu cầu đổi hồ sơ seller',
          `Seller ${userId.slice(0, 8)}... vừa gửi yêu cầu thay đổi hồ sơ, cần duyệt.`,
          '/admin/users'
        );
      }

      return res.status(201).json({
        success: true,
        message: 'Yêu cầu thay đổi hồ sơ đã được gửi. Vui lòng chờ Admin duyệt.'
      });
    } catch (err) {
      await connection.rollback();
      console.error('profile-change-request error:', err);
      return res.status(500).json({ success: false, message: 'Không thể gửi yêu cầu thay đổi hồ sơ.' });
    } finally {
      connection.release();
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