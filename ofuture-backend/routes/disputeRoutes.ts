// routes/disputeRoutes.ts
import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';

const {
  createDispute,
  getMyDisputes,
  getAllDisputes,
  resolveDispute,
  submitEvidence,
  sendChatMessage,
  getDisputeChat,
  markChatAsRead
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

const validateSubmitEvidence = [
  param('id').isUUID().withMessage('Valid dispute ID is required.'),
  body('evidenceUrl').isURL().withMessage('Evidence must be a valid URL.'),
  body('description').optional().trim().escape(),
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
// SHARED ROUTES (Buyer & Seller)
// ─────────────────────────────────────────────
// 2.5 Submit evidence for a dispute
router.post(
  '/:id/evidence',
  authenticate,
  riskScore,
  authorizeRoles('buyer', 'seller'),
  writeLimiter,
  validateSubmitEvidence,
  submitEvidence
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

// ─────────────────────────────────────────────
// DISPUTE CHAT ROUTES (NEW)
// ─────────────────────────────────────────────
// 5. Send chat message in dispute
router.post(
  '/:disputeId/chat',
  authenticate,
  riskScore,
  authorizeRoles('buyer', 'seller'),
  writeLimiter,
  body('message').trim().isLength({ min: 1, max: 5000 }).withMessage('Message must be between 1 and 5000 characters.').escape(),
  body('attachments').optional().isArray().withMessage('Attachments must be an array.'),
  validate,
  sendChatMessage
);

// 6. Get dispute chat history
router.get(
  '/:disputeId/chat',
  authenticate,
  authorizeRoles('buyer', 'seller', 'admin'),
  validatePaginationQuery,
  getDisputeChat
);

// 7. Mark chat as read
router.put(
  '/:disputeId/chat/read',
  authenticate,
  authorizeRoles('buyer', 'seller'),
  markChatAsRead
);

export = router;