// routes/paymentRoutes.ts
import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
const paymentController = require('../controllers/paymentController');

const { authenticate } = require('../middleware/auth');
const { authorizeRoles, adminOnly } = require('../middleware/role');
const { riskScore } = require('../middleware/security');
const { evaluateTrust, requireTrust } = require('../middleware/trustEvaluator');
const { financialLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction): any => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

// ─────────────────────────────────────────────
// 1. PUBLIC ROUTE (Webhook của MoMo gọi về)
// Không dùng Auth, không dùng CSRF. Verify bằng chữ ký số trong Service.
// ─────────────────────────────────────────────
router.post('/momo/callback', paymentController.momoCallback);


// ─────────────────────────────────────────────
// 2. PROTECTED ROUTES (Yêu cầu đăng nhập + Trust Evaluator)
// ─────────────────────────────────────────────
router.use(authenticate, riskScore, evaluateTrust, requireTrust('standard'), financialLimiter);

const validateCreate = [
  body('orderId').isUUID().withMessage('Valid orderId required'),
  body('amount').isNumeric().withMessage('Amount must be numeric'),
  validate
];

// Tạo thanh toán MoMo (Chỉ Buyer)
router.post('/momo/create', authorizeRoles('buyer'), validateCreate, paymentController.createMoMo);

// Tạo thanh toán VietQR (Chỉ Buyer)
router.post('/qr/create', authorizeRoles('buyer'), validateCreate, paymentController.createQR);

// Lấy trạng thái thanh toán
router.get('/:paymentId/status', param('paymentId').isUUID(), validate, paymentController.getStatus);

// ─────────────────────────────────────────────
// 3. ADMIN ROUTES
// ─────────────────────────────────────────────
// Admin xác nhận thủ công khi nhận được tiền chuyển khoản ngân hàng (QR)
router.put('/qr/:paymentId/status', adminOnly, [
  param('paymentId').isUUID(),
  body('success').isBoolean(),
  validate
], paymentController.updateQRStatus);

export = router;