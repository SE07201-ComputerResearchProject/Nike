// routes/escrowRoutes.ts
// ─────────────────────────────────────────────
// Escrow routes — every endpoint is authenticated.
// ─────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';

const {
  pay, release, refund,
  dispute, resolve,
  getStatus, adminListAll,
} = require('../controllers/escrowController');

const { authenticate } = require('../middleware/auth');
const { evaluateTrust, requireTrust } = require('../middleware/trustEvaluator');
const { riskScore, detectSuspiciousPayload }  = require('../middleware/security');
const { financialLimiter } = require('../middleware/rateLimiter');
const { mfaForFinancial } = require('../middleware/requireMfa');
const { authorizeRoles, adminOnly } = require('../middleware/role');

const router = express.Router();

// ── Reusable validation helper ────────────────
const validate = (req: Request, res: Response, next: NextFunction): any => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success : false,
      message : 'Validation failed.',
      errors  : errors.array().map((e: any) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

// ── Validators ────────────────────────────────

const validateOrderId = [
  body('orderId').isUUID().withMessage('orderId must be a valid UUID.'),
  validate,
];

const validatePay = [
  body('orderId').isUUID().withMessage('orderId must be a valid UUID.'),
  body('paymentMethod').optional().isObject().withMessage('paymentMethod must be an object.'),
  body('paymentMethod.cardNumber')
    .optional()
    .trim()
    .isLength({ min: 13, max: 19 }).withMessage('Card number must be 13–19 digits.'),
  validate,
];

const validateRefund = [
  body('orderId').isUUID().withMessage('orderId must be a valid UUID.'),
  body('reason').optional().trim().isLength({ max: 500 }).escape(),
  validate,
];

const validateDispute = [
  body('orderId').isUUID().withMessage('orderId must be a valid UUID.'),
  body('reason')
    .trim()
    .isLength({ min: 10, max: 1000 }).withMessage('Dispute reason must be 10–1000 characters.')
    .escape(),
  validate,
];

const validateResolve = [
  body('orderId').isUUID().withMessage('orderId must be a valid UUID.'),
  body('resolution')
    .isIn(['release', 'refund']).withMessage('resolution must be "release" or "refund".'),
  body('reason')
    .trim()
    .isLength({ min: 5, max: 500 }).withMessage('Resolution reason must be 5–500 characters.')
    .escape(),
  validate,
];

const validateOrderIdParam = [
  param('orderId').isUUID().withMessage('orderId must be a valid UUID.'),
  validate,
];

// ─────────────────────────────────────────────
// ADMIN ROUTES  (must be declared before /:orderId)
// ─────────────────────────────────────────────

router.get(
  '/admin/all',
  authenticate,
  adminOnly,
  adminListAll
);

router.post(
  '/resolve',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('full'),
  mfaForFinancial,
  adminOnly,
  financialLimiter,
  detectSuspiciousPayload,
  validateResolve,
  resolve
);

router.post(
  '/refund',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  mfaForFinancial,
  authorizeRoles('buyer', 'admin'),
  financialLimiter,
  detectSuspiciousPayload,
  validateRefund,
  refund
);

// ─────────────────────────────────────────────
// BUYER ROUTES
// ─────────────────────────────────────────────

router.post(
  '/pay',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  mfaForFinancial,
  authorizeRoles('buyer'),
  financialLimiter,
  detectSuspiciousPayload,
  validatePay,
  pay
);

router.post(
  '/release',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  mfaForFinancial,
  authorizeRoles('buyer'),
  financialLimiter,
  validateOrderId,
  release
);

router.post(
  '/dispute',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  mfaForFinancial,
  authorizeRoles('buyer'),
  financialLimiter,
  detectSuspiciousPayload,
  validateDispute,
  dispute
);

// ─────────────────────────────────────────────
// SHARED: Buyer | Seller | Admin
// ─────────────────────────────────────────────

router.get(
  '/:orderId',
  authenticate,
  validateOrderIdParam,
  getStatus
);

export = router;