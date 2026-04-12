// ofuture-backend/routes/sellerRoutes.ts
import express, { Request, Response } from 'express';
import { pool }         from '../config/db';
import OrderModel       from '../models/orderModel';
import { SampleModel }  from '../models/sampleModel';
import { authenticate } from '../middleware/auth';
const { authorizeRoles } = require('../middleware/role');
const { publicLimiter }  = require('../middleware/rateLimiter');
import logger from '../utils/logger';

const router = express.Router();

interface SellerReq extends Request { user?: any; }

// ── All seller routes: auth + seller (or admin) role ─────
router.use(authenticate, authorizeRoles('seller', 'admin'));

// ─────────────────────────────────────────────────────────
// GET /api/seller/orders
// Replaces: GET /api/orders?sellerId=... (was adminOnly)
// ─────────────────────────────────────────────────────────
router.get('/orders', async (req: SellerReq, res: Response) => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const orders = await OrderModel.findBySeller(req.user.id, {
      page  : Math.max(1, parseInt(page as string)  || 1),
      limit : Math.min(100, parseInt(limit as string) || 20),
      status: status as string,
    });
    res.status(200).json({ success: true, data: orders });
  } catch (err) {
    logger.error('seller/orders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/seller/escrow
// New endpoint — no equivalent existed for sellers
// ─────────────────────────────────────────────────────────
router.get('/escrow', async (req: SellerReq, res: Response) => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const parsedPage  = Math.max(1, parseInt(page  as string) || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const conditions: string[] = ['e.seller_id = ?'];
    const params: any[]        = [req.user.id];      // ← from JWT, not query param

    if (status) { conditions.push('e.status = ?'); params.push(status); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [rows]: any = await pool.execute(
      `SELECT
         e.id, e.order_id,
         e.amount, e.platform_fee, e.net_amount,
         e.status, e.held_at, e.released_at, e.refunded_at,
         e.release_reason, e.refund_reason, e.created_at,
         o.status   AS order_status
       FROM escrow_transactions e
       JOIN orders o ON o.id = e.order_id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM escrow_transactions e ${where}`,
      params
    );

    res.status(200).json({
      success    : true,
      data       : rows,
      pagination : {
        page      : parsedPage,
        limit     : parsedLimit,
        total     : Number(total),
        totalPages: Math.ceil(Number(total) / parsedLimit),
      },
    });
  } catch (err) {
    logger.error('seller/escrow error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch escrow transactions.' });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/seller/reviews
// Reviews for THIS seller's products only
// ─────────────────────────────────────────────────────────
router.get('/reviews', async (req: SellerReq, res: Response) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const parsedPage  = Math.max(1, parseInt(page  as string) || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const [rows]: any = await pool.execute(
      `SELECT
         r.id, r.rating, r.title, r.body,
         r.is_verified, r.created_at,
         p.id   AS product_id,
         p.name AS product_name,
         u.username AS buyer_username
       FROM reviews r
       JOIN products p ON p.id = r.product_id
       JOIN users    u ON u.id = r.buyer_id
       WHERE p.seller_id = ? AND r.is_hidden = 0
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM reviews r
       JOIN products p ON p.id = r.product_id
       WHERE p.seller_id = ? AND r.is_hidden = 0`,
      [req.user.id]
    );

    res.status(200).json({
      success    : true,
      data       : rows,
      pagination : {
        page      : parsedPage,
        limit     : parsedLimit,
        total     : Number(total),
        totalPages: Math.ceil(Number(total) / parsedLimit),
      },
    });
  } catch (err) {
    logger.error('seller/reviews error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/seller/disputes
// Disputes filed against THIS seller's orders
// ─────────────────────────────────────────────────────────
router.get('/disputes', async (req: SellerReq, res: Response) => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const parsedPage  = Math.max(1, parseInt(page  as string) || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const conditions: string[] = ['o.seller_id = ?'];
    const params: any[]        = [req.user.id];

    if (status) { conditions.push('d.status = ?'); params.push(status); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [rows]: any = await pool.execute(
      `SELECT
         d.id, d.order_id, d.reason, d.evidence_urls,
         d.status, d.created_at, d.resolved_at,
         o.total_amount,
         u.username AS complainant_username
       FROM disputes d
       JOIN orders o ON d.order_id       = o.id
       JOIN users  u ON d.complainant_id = u.id
       ${where}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       ${where}`,
      params
    );

    res.status(200).json({
      success    : true,
      data       : rows,
      pagination : {
        page      : parsedPage,
        limit     : parsedLimit,
        total     : Number(total),
        totalPages: Math.ceil(Number(total) / parsedLimit),
      },
    });
  } catch (err) {
    logger.error('seller/disputes error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch disputes.' });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/seller/samples
// Replaces: GET /api/samples?sellerId=... (didn't exist)
// ─────────────────────────────────────────────────────────
router.get('/samples', async (req: SellerReq, res: Response) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const parsedPage  = Math.max(1, parseInt(page  as string) || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const samples = await SampleModel.findBySeller(
      req.user.id,
      parsedLimit,
      offset
    );
    res.status(200).json({ success: true, data: samples });
  } catch (err) {
    logger.error('seller/samples error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch samples.' });
  }
});

export = router;