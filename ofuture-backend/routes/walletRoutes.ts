// routes/walletRoutes.ts
// ─────────────────────────────────────────────
// Wallet Routes — REST endpoints for wallet operations
// ─────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import { param, validationResult } from 'express-validator';
const walletController = require('../controllers/walletController');

const { authenticate } = require('../middleware/auth');
const { adminOnly } = require('../middleware/role');

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction): any => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

// ─────────────────────────────────────────────
// PROTECTED ROUTES (Require Authentication)
// ─────────────────────────────────────────────
router.use(authenticate);

/**
 * GET /api/wallet/balance
 * Get current wallet balance for authenticated user
 */
router.get('/balance', walletController.getBalance);

/**
 * GET /api/wallet/details
 * Get wallet details (balance + recent transactions)
 */
router.get('/details', walletController.getWalletDetails);

/**
 * GET /api/wallet/transactions
 * Get wallet transaction history with pagination
 * Query: ?page=1&limit=20
 */
router.get('/transactions', walletController.getTransactionHistory);

/**
 * GET /api/wallet/transactions/:transactionId
 * Get specific transaction details
 */
router.get(
  '/transactions/:transactionId',
  [param('transactionId').isUUID()],
  validate,
  walletController.getTransaction
);

// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────

/**
 * GET /api/admin/wallet/user/:userId
 * Get wallet balance for specific user (Admin only)
 */
router.get(
  '/admin/wallet/user/:userId',
  adminOnly,
  [param('userId').isUUID()],
  validate,
  walletController.getUserWalletAdmin
);

/**
 * POST /api/admin/wallet/adjust
 * Adjust wallet balance (Admin only)
 * Body: { userId, amount, description }
 */
router.post(
  '/admin/wallet/adjust',
  adminOnly,
  walletController.adjustWalletBalance
);

export = router;
