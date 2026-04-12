// controllers/authController.ts
// ─────────────────────────────────────────────
// Authentication controller.
// Handles: register, login, refresh, logout, me, google-login
// ─────────────────────────────────────────────

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import UserModel from '../models/userModel';
import RefreshTokenModel from '../models/refreshTokenModel';
import { LogModel, LOG_EVENTS } from '../models/logModel';
import logger from '../utils/logger';
const {
  signAccessToken,
  generateRawRefreshToken,
  getClientIp,
  getLockoutExpiry,
} = require('../utils/securityUtils');
import mfaService from '../services/mfaService';
import crypto from 'crypto';
const redisClient = require('../utils/redisClient');
import emailService from '../services/emailService';
import { OAuth2Client } from 'google-auth-library';
import { pool } from '../config/db';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Config constants
const SALT_ROUNDS         = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
const MAX_FAILED_ATTEMPTS = 5;   // lock after 5 consecutive failures
const REFRESH_TOKEN_DAYS  = 7;

interface AuthRequest extends Request {
  user?: any;
  meta?: any;
}

// ── Helper: build log context from request ────
const reqContext = (req: AuthRequest) => ({
  ipAddress : getClientIp(req),
  userAgent : req.headers['user-agent'] ?? null,
  endpoint  : req.originalUrl,
  method    : req.method,
});

// ── Helper: format token expiry as Date ───────
const refreshTokenExpiry = (): Date => {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_DAYS);
  return d;
};

// ─────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────
const register = async (req: AuthRequest, res: Response): Promise<any> => {
  const { email, username, password, fullName, role = 'buyer', phone } = req.body;
  const ctx = reqContext(req);

  try {
    // 1. Check email uniqueness
    const existingEmail = await UserModel.findByEmail(email);
    if (existingEmail) {
      await LogModel.write({ ...ctx, eventType: LOG_EVENTS.REGISTER_FAIL, severity: 'warn',
        message: `Registration attempt with existing email: ${email}` });

      return res.status(409).json({
        success : false,
        message : 'An account with this email or username already exists.',
      });
    }

    // 2. Check username uniqueness
    const existingUsername = await UserModel.findByUsername(username);
    if (existingUsername) {
      return res.status(409).json({
        success : false,
        message : 'An account with this email or username already exists.',
      });
    }

    // 3. Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // 4. Create user (admin role cannot be self-registered)
    const safeRole = ['buyer', 'seller'].includes(role) ? role : 'buyer';
    await UserModel.create({ email, username, passwordHash, role: safeRole, fullName, phone });

    // 5. Fetch new user to get generated UUID
    const newUser = await UserModel.findByEmail(email);

    // --- START OF OTP GENERATION ---
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const redisKey = `otp:${newUser.email}`;

    // Store OTP in Redis with 5-minute expiration (300 seconds)
    await redisClient.set(redisKey, otpCode, 'EX', 300);

    try {
      await emailService.sendOtpEmail(newUser.email, otpCode);
    } catch (mailErr) {
      logger.error(`Failed to send OTP email to ${newUser.email} during registration`);
    }
    // --- END OF OTP GENERATION ---

    // 6. Log success
    await LogModel.write({
      ...ctx,
      userId    : newUser.id,
      eventType : LOG_EVENTS.REGISTER_SUCCESS,
      severity  : 'info',
      message   : `New ${safeRole} registered: ${email}`,
    });

    logger.info(`New user registered: ${email} (${safeRole})`);

    res.status(201).json({
      success : true,
      message : 'Account created successfully. Please check your email for the OTP verification code.',
      data    : {
        id       : newUser.id,
        email    : newUser.email,
        username : newUser.username,
        role     : newUser.role,
        fullName : newUser.full_name,
      },
    });

  } catch (err) {
    logger.error('register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────
const login = async (req: AuthRequest, res: Response): Promise<any> => {
  // 1. Nhận thêm captchaToken từ Frontend gửi lên
  const { email, password, captchaToken } = req.body;
  const ctx = reqContext(req);

  try {
    // --- BẮT ĐẦU LỚP BẢO VỆ RECAPTCHA ---
    if (!captchaToken) {
      return res.status(400).json({ success: false, message: 'Vui lòng xác minh bạn không phải là robot.' });
    }

    // Đảm bảo bạn đã đặt biến RECAPTCHA_SECRET_KEY trong file .env
    const secretKey = process.env.RECAPTCHA_SECRET_KEY; 
    const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${captchaToken}`;
    
    // Gọi API lên Google để kiểm chứng token
    const googleRes = await fetch(verifyUrl, { method: 'POST' });
    const googleData = await googleRes.json();

    if (!googleData.success) {
      await LogModel.write({ ...ctx, eventType: LOG_EVENTS.LOGIN_FAIL, severity: 'warn',
        message: `Captcha verification failed for email: ${email}` });
      return res.status(400).json({ success: false, message: 'Xác thực Captcha thất bại. Vui lòng thử lại!' });
    }
    // --- KẾT THÚC LỚP BẢO VỆ RECAPTCHA ---

    const user = await UserModel.findByEmail(email);

    if (!user) {
      await LogModel.write({ ...ctx, eventType: LOG_EVENTS.LOGIN_FAIL, severity: 'warn',
        message: `Login attempt for unknown email: ${email}` });

      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.is_active) {
      await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.LOGIN_BLOCKED, severity: 'warn',
        message: 'Login attempt on suspended account.' });
      return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMs   = new Date(user.locked_until).getTime() - new Date().getTime();
      const remainingMins = Math.ceil(remainingMs / 60000);
      await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.LOGIN_BLOCKED, severity: 'warn',
        message: `Login attempt on locked account. Locked for ${remainingMins} more min.` });

      return res.status(429).json({
        success : false,
        message : `Account temporarily locked due to too many failed attempts. Try again in ${remainingMins} minute(s).`,
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      const newFailCount = user.failed_attempts + 1;
      await UserModel.incrementFailedAttempts(user.id);

      if (newFailCount >= MAX_FAILED_ATTEMPTS) {
        const lockExpiry = getLockoutExpiry(newFailCount);
        await UserModel.lockAccount(user.id, lockExpiry);
        await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.LOGIN_BLOCKED, severity: 'warn',
          message: `Account locked after ${newFailCount} failed attempts.` });

        return res.status(429).json({
          success : false,
          message : 'Too many failed attempts. Account locked for 5 minutes.',
        });
      }

      await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.LOGIN_FAIL, severity: 'warn',
        message: `Failed login attempt #${newFailCount}` });

      return res.status(401).json({
        success : false,
        message : 'Invalid email or password.',
        hint    : `${MAX_FAILED_ATTEMPTS - newFailCount} attempt(s) remaining before lockout.`,
      });
    }

    const ip = getClientIp(req);
    await UserModel.updateLoginMeta(user.id, { ip, failedAttempts: 0 });

    if (user.mfa_enabled) {
      const mfaToken = mfaService.generateMfaToken(user.id);
      return res.status(200).json({
        success    : true,
        mfaRequired: true,
        message    : 'MFA verification required.',
        mfaToken,
      });
    }

    const tokenPayload   = { id: user.id, email: user.email, role: user.role };
    const accessToken    = signAccessToken(tokenPayload);
    const rawRefresh     = generateRawRefreshToken();

    await RefreshTokenModel.create({
      userId      : user.id,
      rawToken    : rawRefresh,
      deviceInfo  : req.headers['user-agent'] ?? null,
      ipAddress   : ip,
      expiresAt   : refreshTokenExpiry(),
    });

    await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.LOGIN_SUCCESS, severity: 'info',
      message: `Successful login from IP: ${ip}` });

    logger.info(`User logged in: ${user.email}`);

    res.status(200).json({
      success : true,
      message : 'Login successful.',
      data    : {
        accessToken,
        refreshToken : rawRefresh,
        expiresIn    : process.env.JWT_EXPIRES_IN || '15m',
        user         : {
          id         : user.id,
          email      : user.email,
          username   : user.username,
          role       : user.role,
          fullName   : user.full_name,
          mfaEnabled : Boolean(user.mfa_enabled),
        },
      },
    });

  } catch (err) {
    logger.error('login error:', err);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/refresh
// ─────────────────────────────────────────────
const refreshToken = async (req: AuthRequest, res: Response): Promise<any> => {
  const { refreshToken: rawToken } = req.body;
  const ctx = reqContext(req);

  try {
    if (!rawToken) {
      return res.status(400).json({ success: false, message: 'Missing refreshToken in request body.' });
    }

    const stored = await RefreshTokenModel.findValid(rawToken);
    if (!stored) {
      logger.warn('Refresh token not found or expired for request', { ...ctx, tokenPreview: String(rawToken).slice(0,20) });
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    const userId = stored.user_id || stored.userId;
    const user = await UserModel.findById(userId);

    if (!user || !user.is_active) {
      await RefreshTokenModel.revoke(rawToken);
      return res.status(401).json({ success: false, message: 'User not found or suspended.' });
    }

    const revokeRes: any = await RefreshTokenModel.revoke(rawToken);
    if (!revokeRes || revokeRes.affectedRows === 0) {
      return res.status(401).json({ success: false, message: 'Invalid or already used refresh token.' });
    }

    const tokenPayload = { id: user.id, email: user.email, role: user.role };
    const newAccess     = signAccessToken(tokenPayload);
    const newRawRefresh = generateRawRefreshToken();

    await RefreshTokenModel.create({
      userId     : user.id,
      rawToken   : newRawRefresh,
      deviceInfo : req.headers['user-agent'] ?? null,
      ipAddress  : getClientIp(req),
      expiresAt  : refreshTokenExpiry(),
    });

    await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.TOKEN_REFRESH, severity: 'info',
      message: 'Token pair rotated.' });

    return res.status(200).json({
      success : true,
      data    : {
        accessToken  : newAccess,
        refreshToken : newRawRefresh,
        expiresIn    : process.env.JWT_EXPIRES_IN || '15m',
      },
    });

  } catch (err) {
    logger.error('refreshToken error:', err);
    return res.status(500).json({ success: false, message: 'Token refresh failed.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────
const logout = async (req: AuthRequest, res: Response): Promise<any> => {
  const { refreshToken: rawToken, allDevices = false } = req.body;
  const ctx = reqContext(req);

  try {
    if (allDevices) {
      await RefreshTokenModel.revokeAllForUser(req.user.id);
    } else if (rawToken) {
      await RefreshTokenModel.revoke(rawToken);
    }

    await LogModel.write({ ...ctx, userId: req.user.id, eventType: LOG_EVENTS.LOGOUT, severity: 'info',
      message: allDevices ? 'Logged out from all devices.' : 'Logged out from one device.' });

    res.status(200).json({ success: true, message: 'Logged out successfully.' });

  } catch (err) {
    logger.error('logout error:', err);
    res.status(500).json({ success: false, message: 'Logout failed.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────
const getMe = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const user = await UserModel.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.status(200).json({
      success : true,
      data    : {
        id          : user.id,
        email       : user.email,
        username    : user.username,
        role        : user.role,
        fullName    : user.full_name,
        phone       : user.phone,
        avatarUrl   : user.avatar_url,
        isVerified  : Boolean(user.is_verified),
        mfaEnabled  : Boolean(user.mfa_enabled),
        lastLoginAt : user.last_login_at,
        createdAt   : user.created_at,
      },
    });

  } catch (err) {
    logger.error('getMe error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/verify-email
// ─────────────────────────────────────────────
const verifyEmail = async (req: AuthRequest, res: Response): Promise<any> => {
  const { email, otp } = req.body;
  const ctx = reqContext(req);
  try {
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    const redisKey = `otp:${email}`;
    const storedOtp = await redisClient.get(redisKey);

    if (!storedOtp) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired or does not exist. Please request a new one.'
      });
    }

    if (storedOtp !== String(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect OTP.'
      });
    }

    const user = await UserModel.findByEmail(email);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        message: 'This account has already been verified.'
      });
    }

    await UserModel.verifyUser(user.id);
    await redisClient.del(redisKey);

    await LogModel.write({
      ...ctx,
      userId: user.id,
      eventType: LOG_EVENTS.REGISTER_SUCCESS, // Reusing event type per original code
      severity: 'info',
      message: `Email verification successful: ${email}`
    });

    res.status(200).json({
      success: true,
      message: 'Email verified successfully. You can now log in.'
    });
  } catch (err) {
    logger.error('verifyEmail error:', err);
    res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.'
    });
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/resend-otp
// ─────────────────────────────────────────────
const resendOtp = async (req: AuthRequest, res: Response): Promise<any> => {
  const { email } = req.body;
  const ctx = reqContext(req);
  try {
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const user = await UserModel.findByEmail(email);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        message: 'This account has already been verified.'
      });
    }

    const redisKey = `otp:${email}`;
    const cooldownKey = `otp_cooldown:${email}`;

    const isCoolingDown = await redisClient.get(cooldownKey);
    if (isCoolingDown) {
      return res.status(429).json({ 
        success: false, 
        message: 'Please wait 60 seconds before requesting a new code.' 
      });
    }

    const otpCode = crypto.randomInt(100000, 999999).toString();

    await redisClient.set(redisKey, otpCode, 'EX', 300);
    await redisClient.set(cooldownKey, '1', 'EX', 60);

    await emailService.sendOtpEmail(email, otpCode);

    await LogModel.write({
      ...ctx,
      userId: user.id,
      eventType: LOG_EVENTS.REGISTER_SUCCESS, // Reusing event type per original code
      severity: 'info',
      message: `Resent OTP to: ${email}`
    });

    res.status(200).json({
      success: true,
      message: 'A new OTP has been sent to your email.'
    });
  } catch (err) {
    logger.error('resendOtp error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP. Please try again.'
    });
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/google-login
// ─────────────────────────────────────────────
const googleLogin = async (req: AuthRequest, res: Response): Promise<any> => {
  const { idToken } = req.body;
  const ctx = reqContext(req);

  try {
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Google ID token is required.' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    
    if (!payload || !payload.email) {
      return res.status(400).json({ success: false, message: 'Invalid Google token payload.' });
    }
    
    const { email, name, picture } = payload;

    let user = await UserModel.findByEmail(email);
    const ip = getClientIp(req);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const randomPassword = crypto.randomBytes(32).toString('hex'); 
      const passwordHash = await bcrypt.hash(randomPassword, SALT_ROUNDS);
      
      const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') || 'user';
      const username = `${baseUsername}_${crypto.randomInt(1000, 9999)}`;

      await UserModel.create({
        email,
        username,
        passwordHash,
        role: 'buyer',
        fullName: name || 'Google User',
        phone: null
      });

      user = await UserModel.findByEmail(email);
      
      await UserModel.verifyUser(user.id);
      await UserModel.updateProfile(user.id, { avatarUrl: picture });

      await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.REGISTER_SUCCESS, severity: 'info',
        message: `New user registered via Google: ${email}` });
    } else {
      if (!user.is_active) {
        await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.LOGIN_BLOCKED, severity: 'warn',
          message: 'Google login attempt on suspended account.' });
        return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
      }

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
         return res.status(429).json({ success: false, message: 'Account temporarily locked.' });
      }
      
      await UserModel.updateLoginMeta(user.id, { ip, failedAttempts: 0 });
    }

    if (user.mfa_enabled) {
      const mfaToken = mfaService.generateMfaToken(user.id);
      return res.status(200).json({
        success    : true,
        mfaRequired: true,
        message    : 'MFA verification required.',
        mfaToken,
      });
    }

    const tokenPayload   = { id: user.id, email: user.email, role: user.role };
    const accessToken    = signAccessToken(tokenPayload);
    const rawRefresh     = generateRawRefreshToken();

    await RefreshTokenModel.create({
      userId      : user.id,
      rawToken    : rawRefresh,
      deviceInfo  : req.headers['user-agent'] ?? null,
      ipAddress   : ip,
      expiresAt   : refreshTokenExpiry(),
    });

    await LogModel.write({ ...ctx, userId: user.id, eventType: LOG_EVENTS.LOGIN_SUCCESS, severity: 'info',
      message: `Successful Google login from IP: ${ip}` });

    logger.info(`User logged in via Google: ${user.email}`);

    res.status(200).json({
      success : true,
      message : 'Login successful.',
      data    : {
        accessToken,
        refreshToken : rawRefresh,
        isNewUser    : isNewUser,
        expiresIn    : process.env.JWT_EXPIRES_IN || '15m',
        user         : {
          id         : user.id,
          email      : user.email,
          username   : user.username,
          role       : user.role,
          fullName   : user.full_name,
          avatarUrl  : user.avatar_url || picture,
          mfaEnabled : Boolean(user.mfa_enabled),
        },
      },
    });

  } catch (err) {
    logger.error('googleLogin error:', err);
    res.status(500).json({ success: false, message: 'Google login failed. Invalid or expired token.' });
  }
};

// ── Avatar & Trusted Devices Management ───────────────────────
const trustedDeviceModel = require('../models/trustedDeviceModel');

const uploadAvatar = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Chưa có file nào được tải lên.' });

    // Multer lưu file vào public/uploads, ta chỉ cần lưu URL tương đối vào DB
    const avatarUrl = '/uploads/' + req.file.filename;

    await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.user.id]);
    res.status(200).json({ success: true, message: 'Cập nhật ảnh đại diện thành công.', data: { avatarUrl } });
  } catch (err) {
    logger.error('uploadAvatar error:', err);
    res.status(500).json({ success: false, message: 'Lỗi khi lưu ảnh.' });
  }
};

const getDevices = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const devices = await trustedDeviceModel.findAllByUserId(req.user.id);
    res.status(200).json({ success: true, data: devices });
  } catch (err) {
    logger.error('getDevices error:', err);
    res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách thiết bị.' });
  }
};

const revokeDevice = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const deviceId = req.params.id;
    await trustedDeviceModel.revoke(deviceId);
    res.status(200).json({ success: true, message: 'Đã xóa thiết bị khỏi danh sách tin cậy.' });
  } catch (err) {
    logger.error('revokeDevice error:', err);
    res.status(500).json({ success: false, message: 'Lỗi khi xóa thiết bị.' });
  }
};

export = { register, login, refreshToken, logout, getMe, verifyEmail, resendOtp, googleLogin, uploadAvatar, getDevices, revokeDevice };