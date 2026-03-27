// routes/disputeRoutes.ts
import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';

const {
  createDispute,
  getMyDisputes,
  getAllDisputes,
  resolveDispute
} = require('../controllers/disputeController');

const { authenticate } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { riskScore, detectSuspiciousPayload } = require('../middleware/security');
const { writeLimiter } = require('../middleware/rateLimiter');
const { validatePaginationQuery } = require('../middleware/validate');

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction): any => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: errors.array().map((e: any) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

const validateCreateDispute = [
  body('orderId').isUUID().withMessage('Valid order ID is required.'),
  body('reason').trim().isLength({ min: 10, max: 1000 }).withMessage('Reason must be between 10 and 1000 characters.').escape(),
  body('evidenceUrl').optional().isURL().withMessage('Evidence must be a valid URL.'),
  validate
];

const validateResolveDispute = [
  param('id').isUUID().withMessage('Valid dispute ID is required.'),
  body('resolution')
    .isIn(['refund_buyer', 'release_seller', 'reject'])
    .withMessage('Resolution must be refund_buyer, release_seller, or reject.'),
  validate
];

// ─────────────────────────────────────────────
// BUYER ROUTES
// ─────────────────────────────────────────────
// 1. Create a dispute (Buyer)
router.post(
  '/',
  authenticate,
  riskScore,
  authorizeRoles('buyer'),
  writeLimiter,
  detectSuspiciousPayload,
  validateCreateDispute,
  createDispute
);

// 2. Get my disputes (Buyer)
router.get(
  '/my',
  authenticate,
  authorizeRoles('buyer'),
  validatePaginationQuery,
  getMyDisputes
);

// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────
// 3. View all disputes (Admin)
router.get(
  '/admin',
  authenticate,
  authorizeRoles('admin'),
  validatePaginationQuery,
  getAllDisputes
);

// 4. Resolve a dispute (Admin)
router.post(
  '/admin/:id/resolve',
  authenticate,
  riskScore,
  authorizeRoles('admin'),
  writeLimiter,
  validateResolveDispute,
  resolveDispute
);

export = router;