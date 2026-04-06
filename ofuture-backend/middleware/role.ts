// middleware/role.ts
// ─────────────────────────────────────────────
// Full RBAC middleware suite for O'Future.
// All guards must be used AFTER authenticate().
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
const { can, hasMinRole, ROLES } = require('../config/permissions');
import { LogModel, LOG_EVENTS } from '../models/logModel';
const { getClientIp } = require('../utils/securityUtils');
import logger from '../utils/logger';

// Extend Request to include user attached by auth middleware
interface RoleRequest extends Request {
  user?: any;
}

// ─────────────────────────────────────────────
// Helper: write an access-denied security log
// ─────────────────────────────────────────────
const logDenied = async (req: RoleRequest, reason: string) => {
  try {
    await LogModel.write({
      userId     : req.user?.id ?? null,
      eventType  : LOG_EVENTS.SUSPICIOUS_ACTIVITY,
      severity   : 'warn',
      ipAddress  : getClientIp(req),
      userAgent  : req.headers['user-agent'],
      endpoint   : req.originalUrl,
      method     : req.method,
      message    : `Access denied — ${reason}`,
    });
  } catch {
    // log failures must never crash the response cycle
  }
};

// ─────────────────────────────────────────────
// 1. authorizeRoles(...allowedRoles)
// ─────────────────────────────────────────────
const authorizeRoles = (...allowedRoles: string[]) => {
  return async (req: RoleRequest, res: Response, next: NextFunction): Promise<any> => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      const reason = `role="${req.user.role}" attempted action requiring [${allowedRoles.join('|')}]`;
      await logDenied(req, reason);
      logger.warn(`RBAC denied: userId=${req.user.id} ${reason}`);

      return res.status(403).json({
        success  : false,
        message  : `Access denied. This action requires one of the following roles: ${allowedRoles.join(', ')}.`,
        yourRole : req.user.role,
      });
    }

    next();
  };
};

// ─────────────────────────────────────────────
// 2. authorizePermission(action, resource)
// ─────────────────────────────────────────────
const authorizePermission = (action: string, resource: string) => {
  return async (req: RoleRequest, res: Response, next: NextFunction): Promise<any> => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const allowed = can(req.user.role, action, resource);

    if (!allowed) {
      const reason = `role="${req.user.role}" cannot perform "${action}" on "${resource}"`;
      await logDenied(req, reason);
      logger.warn(`Permission denied: userId=${req.user.id} — ${reason}`);

      return res.status(403).json({
        success  : false,
        message  : `Your role (${req.user.role}) is not permitted to ${action} ${resource}.`,
      });
    }

    next();
  };
};

// ─────────────────────────────────────────────
// 3. requireOwnerOrAdmin(getOwnerId)
// ─────────────────────────────────────────────
const requireOwnerOrAdmin = (getOwnerId: (req: RoleRequest) => Promise<string | null> | string | null) => {
  return async (req: RoleRequest, res: Response, next: NextFunction): Promise<any> => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (req.user.role === ROLES.ADMIN) return next();

    try {
      const ownerId = await getOwnerId(req);

      if (!ownerId) {
        return res.status(404).json({ success: false, message: 'Resource not found.' });
      }

      if (req.user.id !== ownerId) {
        const reason = `userId=${req.user.id} attempted to access resource owned by userId=${ownerId}`;
        await logDenied(req, reason);
        logger.warn(`Ownership violation: ${reason}`);

        return res.status(403).json({
          success : false,
          message : 'Access denied. You do not own this resource.',
        });
      }

      next();
    } catch (err) {
      logger.error('requireOwnerOrAdmin error:', err);
      res.status(500).json({ success: false, message: 'Authorization check failed.' });
    }
  };
};

// ─────────────────────────────────────────────
// 4. requireMinRole(minRole)
// ─────────────────────────────────────────────
const requireMinRole = (minRole: string) => {
  return async (req: RoleRequest, res: Response, next: NextFunction): Promise<any> => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (!hasMinRole(req.user.role, minRole)) {
      const reason = `role="${req.user.role}" is below minimum required role "${minRole}"`;
      await logDenied(req, reason);

      return res.status(403).json({
        success  : false,
        message  : `Access denied. Minimum required role: ${minRole}.`,
        yourRole : req.user.role,
      });
    }

    next();
  };
};

// ─────────────────────────────────────────────
// 5. requireSelfOrAdmin(getUserIdFromRequest)
// ─────────────────────────────────────────────
const requireSelfOrAdmin = (getUserIdFromRequest: (req: RoleRequest) => string = (req) => req.params.id as string) => {
  return async (req: RoleRequest, res: Response, next: NextFunction): Promise<any> => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (req.user.role === ROLES.ADMIN) return next();

    const targetUserId = getUserIdFromRequest(req);

    if (req.user.id !== targetUserId) {
      const reason = `userId=${req.user.id} attempted to access profile of userId=${targetUserId}`;
      await logDenied(req, reason);

      return res.status(403).json({
        success : false,
        message : 'Access denied. You can only access your own profile.',
      });
    }

    next();
  };
};

// ─────────────────────────────────────────────
// 6. adminOnly — shorthand
// ─────────────────────────────────────────────
const adminOnly = authorizeRoles(ROLES.ADMIN);

export = {
  authorizeRoles,
  authorizePermission,
  requireOwnerOrAdmin,
  requireMinRole,
  requireSelfOrAdmin,
  adminOnly,
};