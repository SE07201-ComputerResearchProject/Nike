// routes/orderRoutes.ts
// ─────────────────────────────────────────────
// Order routes — full RBAC on every endpoint.
// ─────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';

const {
  createOrder,
  getMyOrders,
  getOrderById,
  getSellerOrders,
  cancelOrder,
  markShipped,
  confirmDelivery,
  getAllOrders,
  adminUpdateStatus,
} = require('../controllers/orderController');

const { authenticate } = require('../middleware/auth');
const { authorizeRoles, adminOnly } = require('../middleware/role');
const { riskScore, detectSuspiciousPayload } = require('../middleware/security');
const { evaluateTrust, requireTrust } = require('../middleware/trustEvaluator');
const { writeLimiter } = require('../middleware/rateLimiter');
const { validateCreateOrder, validateUUIDParam, validatePaginationQuery } = require('../middleware/validate');

const router = express.Router();

// ── Inline validators ──────────────────────────

const validateCancelOrder = [
  param('id').isUUID().withMessage('Order ID must be a valid UUID.'),
  body('reason').optional().trim().isLength({ max: 500 }).escape(),
  (req: Request, res: Response, next: NextFunction): any => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({
      success: false, errors: errors.array().map((e: any) => ({ field: e.path, message: e.msg }))
    });
    next();
  },
];

const validateShipOrder = [
  param('id').isUUID().withMessage('Order ID must be a valid UUID.'),
  body('trackingNumber').optional().trim().isLength({ max: 100 }).escape(),
  body('carrier').optional().trim().isLength({ max: 100 }).escape(),
  (req: Request, res: Response, next: NextFunction): any => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({
      success: false, errors: errors.array().map((e: any) => ({ field: e.path, message: e.msg }))
    });
    next();
  },
];

const validateAdminStatus = [
  param('id').isUUID().withMessage('Order ID must be a valid UUID.'),
  body('status')
    .isIn(['pending','paid','shipped','completed','cancelled','refunded'])
    .withMessage('Invalid status value.'),
  body('reason').optional().trim().isLength({ max: 500 }).escape(),
  (req: Request, res: Response, next: NextFunction): any => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({
      success: false, errors: errors.array().map((e: any) => ({ field: e.path, message: e.msg }))
    });
    next();
  },
];

// ─────────────────────────────────────────────
// BUYER ROUTES
// ─────────────────────────────────────────────

router.post(
  '/',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  authorizeRoles('buyer', 'admin'),
  writeLimiter,
  detectSuspiciousPayload,
  validateCreateOrder,
  createOrder
);

router.get(
  '/my',
  authenticate,
  authorizeRoles('buyer', 'admin'),
  validatePaginationQuery,
  getMyOrders
);

router.post(
  '/:id/confirm-delivery',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  authorizeRoles('buyer'),
  validateUUIDParam('id'),
  confirmDelivery
);

// ─────────────────────────────────────────────
// SELLER ROUTES
// ─────────────────────────────────────────────

router.get(
  '/seller',
  authenticate,
  authorizeRoles('seller', 'admin'),
  validatePaginationQuery,
  getSellerOrders
);

router.post(
  '/:id/ship',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  authorizeRoles('seller', 'admin'),
  validateShipOrder,
  markShipped
);

// ─────────────────────────────────────────────
// SHARED: BUYER + SELLER + ADMIN
// ─────────────────────────────────────────────

router.post(
  '/:id/cancel',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  validateCancelOrder,
  cancelOrder
);

router.get(
  '/:id',
  authenticate,
  validateUUIDParam('id'),
  getOrderById
);

// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────

router.get(
  '/',
  authenticate,
  adminOnly,
  validatePaginationQuery,
  getAllOrders
);

router.put(
  '/:id/status',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('full'),
  adminOnly,
  validateAdminStatus,
  adminUpdateStatus
);

export = router;