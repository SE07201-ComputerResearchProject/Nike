// routes/sampleRoutes.ts
// ─────────────────────────────────────────────
// Sample Management Routes
// Includes full RBAC, Risk Scoring, and Validation.
// ─────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';

const {
  requestSample,
  getMySamples,
  getSellerSamples,
  updateSampleStatus,
  convertToOrder
} = require('../controllers/sampleController');

const { authenticate } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/role');
const { riskScore, detectSuspiciousPayload } = require('../middleware/security');
const { evaluateTrust, requireTrust } = require('../middleware/trustEvaluator');
const { writeLimiter } = require('../middleware/rateLimiter');
const { validatePaginationQuery, validateUUIDParam } = require('../middleware/validate');

const router = express.Router();

// ── Reusable validation runner ────────────────
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

// ── Inline Validators ─────────────────────────
const validateRequestSample = [
  body('productId').isUUID().withMessage('Valid product ID is required.'),
  body('notes').optional().trim().isLength({ max: 500 }).escape(),
  validate
];

const validateUpdateStatus = [
  param('id').isUUID().withMessage('Valid sample ID is required.'),
  body('status')
    .isIn(['approved', 'shipped', 'cancelled', 'returned'])
    .withMessage('Status must be approved, shipped, cancelled, or returned.'),
  validate
];

const validateConvert = [
  param('id').isUUID().withMessage('Valid sample ID is required.'),
  body('quantity').isInt({ min: 1 }).toInt().withMessage('Quantity must be at least 1.'),
  body('shippingAddress').isObject().withMessage('Shipping address is required.'),
  validate
];

// ─────────────────────────────────────────────
// BUYER ROUTES
// ─────────────────────────────────────────────

// 1. Gửi yêu cầu xin hàng mẫu
router.post(
  '/',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'), // Yêu cầu tài khoản có độ tin cậy cơ bản
  authorizeRoles('buyer'),
  writeLimiter,
  detectSuspiciousPayload,
  validateRequestSample,
  requestSample
);

// 2. Xem danh sách hàng mẫu đã xin
router.get(
  '/my',
  authenticate,
  authorizeRoles('buyer'),
  validatePaginationQuery,
  getMySamples
);

// 3. Chốt mẫu & chuyển thành Đơn hàng chính thức
router.post(
  '/:id/convert',
  authenticate,
  riskScore,
  evaluateTrust,
  requireTrust('standard'),
  authorizeRoles('buyer'),
  writeLimiter,
  detectSuspiciousPayload,
  validateConvert,
  convertToOrder
);

// ─────────────────────────────────────────────
// SELLER ROUTES
// ─────────────────────────────────────────────

// 4. Xem danh sách khách xin mẫu sản phẩm của mình
router.get(
  '/seller',
  authenticate,
  authorizeRoles('seller'),
  validatePaginationQuery,
  getSellerSamples
);

// 5. Duyệt mẫu / Cập nhật trạng thái giao hàng
router.put(
  '/:id/status',
  authenticate,
  riskScore,
  authorizeRoles('seller'),
  writeLimiter,
  validateUpdateStatus,
  updateSampleStatus
);

export = router;