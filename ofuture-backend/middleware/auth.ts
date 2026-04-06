// middleware/auth.ts
// ─────────────────────────────────────────────
// JWT authentication middleware.
// Attaches req.user on success.
// Used on every protected route.
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
const { verifyAccessToken } = require('../utils/securityUtils');
import UserModel from '../models/userModel';
import logger from '../utils/logger';

// Mở rộng Request của Express để TypeScript hiểu có thuộc tính user
interface AuthRequest extends Request {
  user?: any;
}

/**
 * authenticate()
 * Validates the Bearer token from the Authorization header.
 * Rejects expired, tampered, or missing tokens.
 * Also checks that the account is still active in the DB.
 */
const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<any> => {
  try {
    // 1. Extract token from header
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required. Use: Authorization: Bearer <token>',
      });
    }

    const token = authHeader.split(' ')[1];

    // 2. Verify signature & expiry
    let decoded: any;
    try {
      decoded = verifyAccessToken(token);
    } catch (err: any) {
      const msg = err.name === 'TokenExpiredError'
        ? 'Access token has expired. Please refresh your session.'
        : 'Invalid access token.';

      return res.status(401).json({ success: false, message: msg });
    }

    // Reject intermediate MFA token (must complete MFA)
    if (decoded && decoded.mfaPending) {
      return res.status(401).json({
        success: false,
        code: 'MFA_PENDING',
        message: 'MFA verification required.',
        mfaRequired: true,
      });
    }

    // 3. Load user from DB — confirms account still exists & is active
    const user = await UserModel.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User account not found.' });
    }

    if (!user.is_active) {
      logger.warn(`Suspended account attempted access: userId=${user.id}`);
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.',
      });
    }

    // 4. Attach clean user object — no password hash, no MFA secret
    req.user = {
      id         : user.id,
      email      : user.email,
      username   : user.username,
      role       : user.role,
      fullName   : user.full_name,
      isVerified : user.is_verified,
      mfaEnabled : user.mfa_enabled,
      // If access token included mfaVerified flag, honor it. Otherwise false.
      mfaVerified: Boolean(decoded?.mfaVerified),
    };

    return next();
  } catch (err) {
    logger.error('authenticate middleware error:', err);
    res.status(500).json({ success: false, message: 'Authentication error.' });
  }
};

export { authenticate };