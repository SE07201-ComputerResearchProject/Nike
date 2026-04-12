// ============================================================
// routes/notificationRoutes.ts
// Notification endpoints routing
// ============================================================

import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import {
  getNotifications,
  getUnreadNotifications,
  markNotificationAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
} from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';
import { riskScore, detectSuspiciousPayload } from '../middleware/security';
import { writeLimiter } from '../middleware/rateLimiter';

const router = express.Router();

/**
 * Validation helper
 */
const validate = (req: Request, res: Response, next: NextFunction): any => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: errors.array().map((e: any) => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  next();
};

/**
 * GET /api/notifications
 * Fetch user's notifications
 */
router.get(
  '/',
  authenticate,
  riskScore,
  getNotifications
);

/**
 * GET /api/notifications/unread
 * Get unread count and recent unread notifications
 */
router.get(
  '/unread',
  authenticate,
  getUnreadNotifications
);

/**
 * PUT /api/notifications/:id/read
 * Mark notification as read
 */
router.put(
  '/:id/read',
  authenticate,
  writeLimiter,
  riskScore,
  [
    param('id').isUUID().withMessage('Valid notification ID is required.'),
  ],
  validate,
  markNotificationAsRead
);

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put(
  '/read-all',
  authenticate,
  writeLimiter,
  riskScore,
  markAllAsRead
);

/**
 * DELETE /api/notifications/:id
 * Delete notification
 */
router.delete(
  '/:id',
  authenticate,
  writeLimiter,
  riskScore,
  [
    param('id').isUUID().withMessage('Valid notification ID is required.'),
  ],
  validate,
  deleteNotification
);

/**
 * DELETE /api/notifications/delete-all
 * Delete all notifications (requires confirmation)
 */
router.delete(
  '/delete-all',
  authenticate,
  writeLimiter,
  riskScore,
  detectSuspiciousPayload,
  [
    body('confirm')
      .exists()
      .custom((val) => val === true)
      .withMessage('Confirmation is required. Send { confirm: true }'),
  ],
  validate,
  deleteAllNotifications
);

export default router;
