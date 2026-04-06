// routes/adminRoutes.ts
// ─────────────────────────────────────────────
// Admin Dashboard routes.
// Every route requires: authenticate + adminOnly.
// ─────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import { param, body, query, validationResult } from 'express-validator';
import { pool } from '../config/db';

const {
  getDashboardStats,
  listUsers,
  getUserDetail,
  suspendUser,
  changeUserRole,
  deleteUser,
  listAllProducts,
  listAllOrders,
  getRevenueReport,
  getAuditLogs,
  getSuspiciousActivity,
  getSystemHealth,
} = require('../controllers/adminController');

const { authenticate } = require('../middleware/auth');
const { riskScore } = require('../middleware/security');
const { adminLimiter } = require('../middleware/rateLimiter');
const { mfaForAdmin } = require('../middleware/requireMfa');
const ipBlocklist = require('../utils/ipBlocklist');
const { adminOnly } = require('../middleware/role');
const escrowController = require('../controllers/escrowController');
const reviewController = require('../controllers/reviewController');

const router = express.Router();

// ── Blanket pipeline on the entire router ─────
router.use(authenticate, adminOnly, riskScore, adminLimiter);

// ── Reusable validation runner ────────────────
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

// ── UUID param validator ────────────────────────
const uuidParam = (name = 'id') => [
  param(name).isUUID().withMessage(`${name} must be a valid UUID.`),
  validate,
];

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
router.get('/stats', getDashboardStats);

// ─────────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────────
router.get(
  '/users',
  [
    query('role').optional().isIn(['buyer','seller','admin']).withMessage('Invalid role.'),
    query('isActive').optional().isBoolean(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
  ],
  listUsers
);

router.get('/users/:id', uuidParam('id'), getUserDetail);

router.put(
  '/users/:id/suspend',
  [
    ...uuidParam('id'),
    body('suspend').isBoolean().withMessage('suspend must be true or false.').toBoolean(),
    body('reason').optional().trim().isLength({ max: 500 }).escape(),
    validate,
  ],
  suspendUser
);

router.put(
  '/users/:id/role',
  [
    ...uuidParam('id'),
    body('role').isIn(['buyer','seller']).withMessage('Role must be "buyer" or "seller".'),
    validate,
  ],
  changeUserRole
);

router.delete('/users/:id', uuidParam('id'), deleteUser);

// ─────────────────────────────────────────────
// PRODUCT MODERATION
// ─────────────────────────────────────────────
router.get(
  '/products',
  [
    query('status').optional().isIn(['active','inactive','deleted']),
    query('sellerId').optional().isUUID(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
  ],
  listAllProducts
);

// ─────────────────────────────────────────────
// ORDER OVERSIGHT
// ─────────────────────────────────────────────
router.get(
  '/orders',
  [
    query('status').optional().isIn(['pending','paid','shipped','completed','cancelled','refunded']),
    query('buyerId').optional().isUUID(),
    query('sellerId').optional().isUUID(),
    query('from').optional().isDate().withMessage('from must be a valid date (YYYY-MM-DD).'),
    query('to').optional().isDate().withMessage('to must be a valid date (YYYY-MM-DD).'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
  ],
  listAllOrders
);

// ─────────────────────────────────────────────
// ESCROW MANAGEMENT
// ─────────────────────────────────────────────
router.get(
  '/escrow',
  [
    query('status').optional().isIn(['pending','processing','held','releasing','refunding','released','refunded','disputed']),
    validate,
  ],
  escrowController.adminListAll
);

// ─────────────────────────────────────────────
// REVIEW MODERATION
// ─────────────────────────────────────────────
router.get(
  '/reviews',
  reviewController.adminListAll
);

// ─────────────────────────────────────────────
// PAYMENTS (Inline Controller)
// ─────────────────────────────────────────────
router.get('/payments', async (req: Request, res: Response) => {
  try {
    // Lấy thông tin payment kèm username của buyer qua bảng orders
    const [rows]: any = await pool.execute(`
      SELECT p.id, p.amount, p.status, p.method AS gateway, p.created_at,
             u.username AS buyer_username
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      JOIN users u ON o.buyer_id = u.id
      ORDER BY p.created_at DESC LIMIT 50
    `);
    
    // Format lại dữ liệu cho khớp với frontend script.js (payment.user.username)
    const formatted = rows.map((r: any) => ({
      ...r,
      user: { username: r.buyer_username }
    }));
    
    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi tải danh sách Payment' });
  }
});

// ─────────────────────────────────────────────
// AI KNOWLEDGE BASE (Inline Controller)
// ─────────────────────────────────────────────
router.get('/ai-knowledge', async (req: Request, res: Response) => {
  try {
    const [rows]: any = await pool.execute('SELECT id, topic, content FROM knowledge_base ORDER BY created_at DESC');
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi tải AI Knowledge Base' });
  }
});

// ─────────────────────────────────────────────
// LIVE CHATS HANDOFF (Inline Controller)
// ─────────────────────────────────────────────
router.get('/chats', async (req: Request, res: Response) => {
  try {
    const status = req.query.status || 'handoff_to_admin';
    const [rows]: any = await pool.execute(`
      SELECT c.id, c.status, u.username 
      FROM chat_sessions c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.status = ? 
      ORDER BY c.created_at DESC
    `, [status]);

    // Format cho script.js (c.user.username)
    const formatted = rows.map((r: any) => ({
      id: r.id,
      status: r.status,
      user: { username: r.username }
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi tải Chat Session' });
  }
});

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────
router.get(
  '/reports/revenue',
  [
    query('period').optional().isIn(['7d','30d','90d','1y']).withMessage('period must be one of: 7d, 30d, 90d, 1y.'),
    validate,
  ],
  getRevenueReport
);

// ─────────────────────────────────────────────
// AUDIT LOG VIEWER
// ─────────────────────────────────────────────
router.get(
  '/logs',
  [
    query('severity').optional().isIn(['info','warn','error','critical']),
    query('eventType').optional().trim().isLength({ min: 1, max: 100 }),
    query('userId').optional().isUUID(),
    query('ipAddress').optional().isIP(),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('q').optional().trim().isLength({ min: 1, max: 1000 }).withMessage('Search query too long.'),
    query('includePayload').optional().isBoolean().toBoolean(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    validate,
  ],
  getAuditLogs
);

router.get(
  '/logs/suspicious',
  [
    query('hours').optional().isInt({ min: 1, max: 168 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    validate,
  ],
  getSuspiciousActivity
);

// ─────────────────────────────────────────────
// SYSTEM HEALTH
// ─────────────────────────────────────────────
router.get('/system/health', getSystemHealth);

// Mount outbox admin routes
const adminOutboxRoutes = require('./adminOutboxRoutes');
router.use('/outbox', adminOutboxRoutes);

// ─────────────────────────────────────────────
// IP BLOCKLIST MANAGEMENT
// ─────────────────────────────────────────────
router.get('/security/blocklist', async (req: Request, res: Response): Promise<any> => {
  try {
    const total = await Promise.resolve(ipBlocklist.size());
    const data  = await Promise.resolve(ipBlocklist.listAll());
    res.status(200).json({ success: true, total, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch blocklist.' });
  }
});

router.post('/security/block',
  [
    body('ip').isIP().withMessage('Must be a valid IPv4 or IPv6 address.'),
    body('durationMinutes').optional().isInt({ min: 1, max: 10080 }).toInt(),
    body('reason').optional().trim().isLength({ max: 300 }).escape(),
    validate,
  ],
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { ip, durationMinutes = 60, reason = 'Manual admin block' } = req.body;
      await Promise.resolve(ipBlocklist.block(ip, durationMinutes * 60 * 1000, reason));
      res.status(200).json({ success: true, message: `IP ${ip} blocked for ${durationMinutes} minute(s).` });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to block IP.' });
    }
  }
);

router.delete('/security/block/:ip', async (req: Request, res: Response): Promise<any> => {
  try {
    const removed = await Promise.resolve(ipBlocklist.unblock(req.params.ip));
    res.status(200).json({
      success : true,
      message : removed ? `IP ${req.params.ip} unblocked.` : `IP ${req.params.ip} was not blocked.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to unblock IP.' });
  }
});

export = router;