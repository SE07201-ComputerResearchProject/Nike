// controllers/adminController.ts
// ─────────────────────────────────────────────
// Admin Dashboard controller.
// ─────────────────────────────────────────────

import { Request, Response } from 'express';
import { pool } from '../config/db';
import UserModel from '../models/userModel';
import ProductModel from '../models/productModel';
import OrderModel from '../models/orderModel';
import { LogModel, LOG_EVENTS } from '../models/logModel';
import logger from '../utils/logger';

interface AdminRequest extends Request {
  user?: any;
  meta?: any;
}

// ── Audit context ─────────────────────────────
const ctx = (req: AdminRequest) => ({
  userId    : req.user?.id ?? null,
  ipAddress : req.meta?.ip,
  userAgent : req.meta?.userAgent,
  endpoint  : req.originalUrl,
  method    : req.method,
});

// ═════════════════════════════════════════════
// A. DASHBOARD STATISTICS
// ═════════════════════════════════════════════

const getDashboardStats = async (req: AdminRequest, res: Response) => {
  try {
    const [
      [userStats],
      [productStats],
      [orderStats],
      [escrowStats],
      [reviewStats],
      [recentSignups],
      [recentOrders],
    ]: any = await Promise.all([
      pool.execute(`
        SELECT
          COUNT(*)                                       AS total_users,
          SUM(role = 'buyer')                            AS buyers,
          SUM(role = 'seller')                           AS sellers,
          SUM(role = 'admin')                            AS admins,
          SUM(is_active = 0)                             AS suspended,
          SUM(DATE(created_at) = CURDATE())              AS new_today,
          SUM(created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS new_this_week
        FROM users
      `),
      pool.execute(`
        SELECT
          COUNT(*)                      AS total_products,
          SUM(status = 'active')        AS active,
          SUM(status = 'inactive')      AS inactive,
          SUM(status = 'deleted')       AS deleted,
          SUM(stock_quantity = 0 AND status = 'active') AS out_of_stock
        FROM products
      `),
      pool.execute(`
        SELECT
          COUNT(*)                                          AS total_orders,
          SUM(status = 'pending')                           AS pending,
          SUM(status = 'paid')                              AS paid,
          SUM(status = 'shipped')                           AS shipped,
          SUM(status = 'completed')                         AS completed,
          SUM(status = 'cancelled')                         AS cancelled,
          SUM(status = 'refunded')                          AS refunded,
          COALESCE(SUM(total_amount), 0)                    AS gross_revenue,
          COALESCE(SUM(CASE WHEN status = 'completed'
                       THEN total_amount END), 0)           AS completed_revenue,
          COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE()
                       THEN total_amount END), 0)           AS revenue_today,
          COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                       THEN total_amount END), 0)           AS revenue_30d
        FROM orders
      `),
      pool.execute(`
        SELECT
          COUNT(*)                                           AS total_escrows,
          SUM(status = 'pending')                            AS pending,
          SUM(status = 'held')                               AS held,
          SUM(status = 'released')                           AS released,
          SUM(status = 'refunded')                           AS refunded,
          SUM(status = 'disputed')                           AS disputed,
          COALESCE(SUM(CASE WHEN status = 'held'
                       THEN amount END), 0)                  AS total_held,
          COALESCE(SUM(platform_fee), 0)                     AS total_fees_collected,
          COALESCE(SUM(CASE WHEN status = 'released'
                       THEN platform_fee END), 0)            AS fees_earned
        FROM escrow_transactions
      `),
      pool.execute(`
        SELECT
          COUNT(*)                         AS total_reviews,
          SUM(is_hidden = 1)               AS hidden,
          ROUND(AVG(rating), 2)            AS platform_avg_rating,
          SUM(rating = 5)                  AS five_star,
          SUM(rating = 4)                  AS four_star,
          SUM(rating <= 3)                 AS three_or_below
        FROM reviews
      `),
      pool.execute(`
        SELECT DATE(created_at) AS date, COUNT(*) AS signups
        FROM users
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `),
      pool.execute(`
        SELECT DATE(created_at) AS date,
               COUNT(*)          AS orders,
               COALESCE(SUM(total_amount), 0) AS revenue
        FROM orders
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `),
    ]);

    res.status(200).json({
      success   : true,
      data      : {
        users    : mapRow(userStats[0]),
        products : mapRow(productStats[0]),
        orders   : mapRow(orderStats[0]),
        escrow   : mapRow(escrowStats[0]),
        reviews  : mapRow(reviewStats[0]),
        trends   : {
          signups : recentSignups,
          orders  : recentOrders,
        },
        generatedAt : new Date().toISOString(),
      },
    });

  } catch (err) {
    logger.error('getDashboardStats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard stats.' });
  }
};

// ═════════════════════════════════════════════
// B. USER MANAGEMENT
// ═════════════════════════════════════════════

const listUsers = async (req: AdminRequest, res: Response) => {
  try {
    const {
      page     = '1',
      limit    = '20',
      role,
      isActive,
      search,
    } = req.query;

    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const offset      = (parsedPage - 1) * parsedLimit;

    const conditions: string[] = [];
    const params: any[]        = [];

    if (role) { conditions.push('role = ?'); params.push(role); }
    if (isActive !== undefined) {
      conditions.push('is_active = ?');
      params.push(isActive === 'true' || isActive === '1' ? 1 : 0);
    }
    if (search) {
      conditions.push('(email LIKE ? OR username LIKE ? OR full_name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows]: any = await pool.execute(
      `SELECT
         id, email, username, role, full_name,
         is_active, is_verified, mfa_enabled,
         last_login_at, last_login_ip,
         failed_attempts, locked_until, created_at
       FROM users
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total FROM users ${where}`,
      params
    );

    res.status(200).json({
      success    : true,
      data       : rows.map(formatUser),
      pagination : buildPagination(parsedPage, parsedLimit, Number(total)),
    });

  } catch (err) {
    logger.error('admin listUsers error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

const getUserDetail = async (req: AdminRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    const [[user]]: any = await pool.execute(
      `SELECT
         id, email, username, role, full_name, phone,
         avatar_url, is_active, is_verified, mfa_enabled,
         last_login_at, last_login_ip,
         failed_attempts, locked_until, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const [[orderCount], [productCount], [reviewCount], [escrowTotal]]: any =
      await Promise.all([
        pool.execute(
          `SELECT COUNT(*) AS total,
                  SUM(status = 'completed') AS completed,
                  COALESCE(SUM(total_amount), 0) AS spent
           FROM orders WHERE buyer_id = ?`,
          [id]
        ),
        pool.execute(
          `SELECT COUNT(*) AS total,
                  SUM(status = 'active') AS active
           FROM products WHERE seller_id = ?`,
          [id]
        ),
        pool.execute(
          'SELECT COUNT(*) AS total FROM reviews WHERE buyer_id = ?',
          [id]
        ),
        pool.execute(
          `SELECT COALESCE(SUM(net_amount), 0) AS earned
           FROM escrow_transactions
           WHERE seller_id = ? AND status = 'released'`,
          [id]
        ),
      ]);

    res.status(200).json({
      success : true,
      data    : {
        ...formatUser(user),
        lockedUntil : user.locked_until,
        activity    : {
          orders   : mapRow(orderCount[0]),
          products : mapRow(productCount[0]),
          reviews  : mapRow(reviewCount[0]),
          escrow   : mapRow(escrowTotal[0]),
        },
      },
    });

  } catch (err) {
    logger.error('getUserDetail error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch user detail.' });
  }
};

const suspendUser = async (req: AdminRequest, res: Response): Promise<any> => {
  const id = req.params.id as string;
  const { suspend = true, reason } = req.body;

  try {
    const [[target]]: any = await pool.execute(
      'SELECT id, role, username, is_active FROM users WHERE id = ? LIMIT 1',
      [id]
    );

    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (target.role === 'admin') {
      return res.status(403).json({
        success : false,
        message : 'Admin accounts cannot be suspended through the API.',
      });
    }

    if (id === req.user.id) {
      return res.status(400).json({
        success : false,
        message : 'You cannot suspend your own account.',
      });
    }

    const isSuspend = suspend === true || suspend === 'true';
    await UserModel.setActiveStatus(id, !isSuspend);

    const action = isSuspend ? 'suspended' : 'unsuspended';

    await LogModel.write({
      ...ctx(req),
      eventType : LOG_EVENTS.ACCOUNT_SUSPENDED,
      severity  : 'warn',
      message   : `Admin ${action} userId=${id} username="${target.username}" reason="${reason ?? 'none'}"`,
      payload   : { targetId: id, action, reason },
    });

    logger.warn(`Admin ${action} account: userId=${id} by adminId=${req.user.id}`);

    res.status(200).json({
      success : true,
      message : `Account "${target.username}" has been ${action}.`,
      data    : { userId: id, isActive: !isSuspend, action },
    });

  } catch (err) {
    logger.error('suspendUser error:', err);
    res.status(500).json({ success: false, message: 'Failed to update account status.' });
  }
};

const changeUserRole = async (req: AdminRequest, res: Response): Promise<any> => {
  const { id }   = req.params;
  const { role } = req.body;

  if (!['buyer', 'seller'].includes(role)) {
    return res.status(400).json({
      success : false,
      message : 'Role must be "buyer" or "seller". Admin role cannot be granted via API.',
    });
  }

  try {
    const [[user]]: any = await pool.execute(
      'SELECT id, role, username FROM users WHERE id = ? LIMIT 1',
      [id]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({
        success : false,
        message : 'Admin role cannot be changed through the API.',
      });
    }

    if (user.role === role) {
      return res.status(409).json({
        success : false,
        message : `User "${user.username}" is already a ${role}.`,
      });
    }

    await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, id]);

    await LogModel.write({
      ...ctx(req),
      eventType : 'ROLE_CHANGED',
      severity  : 'warn',
      message   : `Admin changed userId=${id} role: "${user.role}" → "${role}"`,
      payload   : { targetId: id, from: user.role, to: role },
    });

    res.status(200).json({
      success : true,
      message : `Role updated: "${user.username}" is now a ${role}.`,
      data    : { userId: id, previousRole: user.role, newRole: role },
    });

  } catch (err) {
    logger.error('changeUserRole error:', err);
    res.status(500).json({ success: false, message: 'Failed to change user role.' });
  }
};

const deleteUser = async (req: AdminRequest, res: Response): Promise<any> => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
  }

  try {
    const [[user]]: any = await pool.execute(
      'SELECT id, role, username, email FROM users WHERE id = ? LIMIT 1',
      [id]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({
        success : false,
        message : 'Admin accounts cannot be deleted via API.',
      });
    }

    await pool.execute(
      `UPDATE products SET status = 'deleted' WHERE seller_id = ? AND status != 'deleted'`,
      [id]
    );

    await pool.execute('DELETE FROM users WHERE id = ?', [id]);

    await LogModel.write({
      ...ctx(req),
      eventType : 'USER_DELETED',
      severity  : 'critical',
      message   : `Admin hard-deleted userId=${id} email="${user.email}"`,
      payload   : { targetId: id, email: user.email },
    });

    logger.warn(`Admin deleted account: userId=${id} email=${user.email}`);

    res.status(200).json({
      success : true,
      message : `Account "${user.username}" (${user.email}) has been permanently deleted.`,
    });

  } catch (err) {
    logger.error('deleteUser error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
};

// ═════════════════════════════════════════════
// C. PRODUCT MODERATION
// ═════════════════════════════════════════════

const listAllProducts = async (req: AdminRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status, sellerId, search } = req.query;

    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const conditions: string[] = [];
    const params: any[]        = [];

    if (status)   { conditions.push('p.status = ?');    params.push(status); }
    if (sellerId) { conditions.push('p.seller_id = ?'); params.push(sellerId); }
    if (search) {
      conditions.push('(p.name LIKE ? OR p.category LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows]: any = await pool.execute(
      `SELECT
         p.id, p.name, p.category, p.price, p.stock_quantity,
         p.status, p.avg_rating, p.review_count, p.created_at,
         u.username AS seller_username, u.email AS seller_email
       FROM products p
       JOIN users u ON u.id = p.seller_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total FROM products p ${where}`,
      params
    );

    res.status(200).json({
      success    : true,
      data       : rows,
      pagination : buildPagination(parsedPage, parsedLimit, Number(total)),
    });

  } catch (err) {
    logger.error('admin listAllProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products.' });
  }
};

const deleteProduct = async (req: AdminRequest, res: Response) => {
  try {
    const { id } = req.params;
    await pool.execute(`UPDATE products SET status = 'deleted' WHERE id = ?`, [id]);
    await LogModel.write({ ...ctx(req), eventType: 'PRODUCT_DELETED', severity: 'warn', message: `Admin deleted product ${id}` });
    res.status(200).json({ success: true, message: 'Product deleted successfully.' });
  } catch (err) {
    logger.error('admin deleteProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product.' }); 
  }
};

// ═════════════════════════════════════════════
// D. ORDER OVERSIGHT
// ═════════════════════════════════════════════

const listAllOrders = async (req: AdminRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status, buyerId, sellerId, from, to } = req.query;

    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const conditions: string[] = [];
    const params: any[]        = [];

    if (status)   { conditions.push('o.status = ?');     params.push(status); }
    if (buyerId)  { conditions.push('o.buyer_id = ?');   params.push(buyerId); }
    if (sellerId) { conditions.push('o.seller_id = ?');  params.push(sellerId); }
    if (from)     { conditions.push('o.created_at >= ?'); params.push(from); }
    if (to)       { conditions.push('o.created_at <= ?'); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows]: any = await pool.execute(
      `SELECT
         o.id, o.status, o.quantity, o.unit_price,
         o.total_amount, o.created_at, o.completed_at, o.cancelled_at,
         b.username AS buyer,  b.email AS buyer_email,
         s.username AS seller, s.email AS seller_email,
         p.name     AS product,
         e.status   AS escrow_status,
         e.amount   AS escrow_amount
       FROM orders o
       JOIN users    b ON b.id = o.buyer_id
       JOIN users    s ON s.id = o.seller_id
       JOIN products p ON p.id = o.product_id
       LEFT JOIN escrow_transactions e ON e.order_id = o.id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total FROM orders o ${where}`,
      params
    );

    res.status(200).json({
      success    : true,
      data       : rows,
      pagination : buildPagination(parsedPage, parsedLimit, Number(total)),
    });

  } catch (err) {
    logger.error('admin listAllOrders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
};

// ═════════════════════════════════════════════
// E. REVENUE REPORT
// ═════════════════════════════════════════════

const getRevenueReport = async (req: AdminRequest, res: Response) => {
  try {
    const { period = '30d' } = req.query;

    const periodMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const days = periodMap[period as string] ?? 30;

    const [daily]: any = await pool.execute(
      `SELECT
         DATE(o.created_at)               AS date,
         COUNT(o.id)                      AS orders,
         SUM(o.status = 'completed')      AS completed,
         SUM(o.status = 'refunded')       AS refunded,
         COALESCE(SUM(o.total_amount), 0) AS gross,
         COALESCE(SUM(e.platform_fee), 0) AS fees,
         COALESCE(SUM(e.net_amount), 0)   AS net_to_sellers
       FROM orders o
       LEFT JOIN escrow_transactions e ON e.order_id = o.id
       WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(o.created_at)
       ORDER BY date ASC`,
      [days]
    );

    const [topSellers]: any = await pool.execute(
      `SELECT
         u.id, u.username,
         COUNT(o.id)                      AS total_orders,
         COALESCE(SUM(o.total_amount), 0) AS gross_sales,
         COALESCE(SUM(e.net_amount), 0)   AS net_earned
       FROM orders o
       JOIN users u ON u.id = o.seller_id
       LEFT JOIN escrow_transactions e ON e.order_id = o.id
       WHERE o.status = 'completed'
         AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY u.id, u.username
       ORDER BY gross_sales DESC
       LIMIT 10`,
      [days]
    );

    const [topProducts]: any = await pool.execute(
      `SELECT
         p.id, p.name, p.category,
         COUNT(o.id)                      AS total_orders,
         SUM(o.quantity)                  AS units_sold,
         COALESCE(SUM(o.total_amount), 0) AS revenue
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.status = 'completed'
         AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY p.id, p.name, p.category
       ORDER BY revenue DESC
       LIMIT 10`,
      [days]
    );

    const [[summary]]: any = await pool.execute(
      `SELECT
         COUNT(o.id)                                        AS total_orders,
         SUM(o.status = 'completed')                        AS completed_orders,
         SUM(o.status = 'refunded')                         AS refunded_orders,
         COALESCE(SUM(o.total_amount), 0)                   AS gross_revenue,
         COALESCE(SUM(e.platform_fee), 0)                   AS platform_fees,
         COALESCE(SUM(CASE WHEN e.status = 'released'
                      THEN e.net_amount END), 0)             AS paid_to_sellers,
         COALESCE(SUM(CASE WHEN e.status = 'refunded'
                      THEN e.amount END), 0)                 AS total_refunded,
         COALESCE(AVG(o.total_amount), 0)                   AS avg_order_value
       FROM orders o
       LEFT JOIN escrow_transactions e ON e.order_id = o.id
       WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );

    res.status(200).json({
      success : true,
      period,
      data    : {
        summary     : mapRow(summary),
        daily,
        topSellers,
        topProducts,
        generatedAt : new Date().toISOString(),
      },
    });

  } catch (err) {
    logger.error('getRevenueReport error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate revenue report.' });
  }
};

// ═════════════════════════════════════════════
// F. REVIEWS, ESCROW, PAYMENTS & AI (MỚI BỔ SUNG)
// ═════════════════════════════════════════════

const listAllReviews = async (req: AdminRequest, res: Response) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const [rows]: any = await pool.execute(
      `SELECT r.id, r.rating, r.body, r.is_hidden, u.username, p.name as product_name 
       FROM reviews r JOIN users u ON u.id = r.buyer_id JOIN products p ON p.id = r.product_id 
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [parsedLimit, offset]
    );
    const [[{ total }]]: any = await pool.execute(`SELECT COUNT(*) AS total FROM reviews`);
    res.status(200).json({ success: true, data: rows, pagination: buildPagination(parsedPage, parsedLimit, Number(total)) });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch reviews.' }); }
};

const hideReview = async (req: AdminRequest, res: Response) => {
  try {
    await pool.execute(`UPDATE reviews SET is_hidden = ? WHERE id = ?`, [req.body.is_hidden ? 1 : 0, req.params.id]);
    res.status(200).json({ success: true, message: 'Review visibility updated.' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to update review.' }); }
};

const listEscrow = async (req: AdminRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const where = status ? 'WHERE e.status = ?' : '';
    const params = status ? [status, parsedLimit, offset] : [parsedLimit, offset];
    
    const [rows]: any = await pool.execute(
      `SELECT e.id, e.amount, e.status, e.created_at, b.username AS buyer_username, s.username AS seller_username 
       FROM escrow_transactions e JOIN orders o ON o.id = e.order_id 
       JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id 
       ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`, params
    );
    const [[{ total }]]: any = await pool.execute(`SELECT COUNT(*) AS total FROM escrow_transactions e ${where}`, status ? [status] : []);
    
    res.status(200).json({ 
      success: true, 
      data: rows.map((r:any) => ({
        id: r.id, amount: r.amount, status: r.status, created_at: r.created_at, 
        buyer: {username: r.buyer_username}, seller: {username: r.seller_username}
      })), 
      pagination: buildPagination(parsedPage, parsedLimit, Number(total)) 
    });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch escrow.' }); }
};

const resolveEscrowDispute = async (req: AdminRequest, res: Response) => {
  try {
    const { action } = req.body; 
    const newStatus = action === 'release' ? 'released' : 'returned';
    await pool.execute(`UPDATE escrow_transactions SET status = ? WHERE id = ?`, [newStatus, req.params.id]);
    await LogModel.write({ ...ctx(req), eventType: 'ESCROW_RESOLVED', severity: 'info', message: `Admin resolved escrow ${req.params.id} via ${action}` });
    res.status(200).json({ success: true, message: `Escrow has been ${newStatus}.` });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to resolve escrow.' }); }
};

const listPayments = async (req: AdminRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const [rows]: any = await pool.execute(`SELECT id, amount, status, gateway, created_at FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?`, [parsedLimit, offset]);
    res.status(200).json({ success: true, data: rows, pagination: buildPagination(parsedPage, parsedLimit, 100) });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch payments.' }); }
};

const updatePaymentStatus = async (req: AdminRequest, res: Response) => {
  try {
    const { action } = req.body;
    await pool.execute(`UPDATE payments SET status = ? WHERE id = ?`, [action === 'approve' ? 'approved' : 'rejected', req.params.id]);
    res.status(200).json({ success: true, message: `Payment ${action}d.` });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to update payment.' }); }
};

const listAiKnowledge = async (req: AdminRequest, res: Response) => {
  try {
    const [rows]: any = await pool.execute(`SELECT id, topic, content FROM ai_knowledge_base ORDER BY created_at DESC`);
    res.status(200).json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch AI knowledge.' }); }
};

const addAiTopic = async (req: AdminRequest, res: Response) => {
  try {
    await pool.execute(`INSERT INTO ai_knowledge_base (id, topic, content) VALUES (UUID(), ?, ?)`, [req.body.topic, req.body.content]);
    res.status(200).json({ success: true, message: 'Topic added.' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to add topic.' }); }
};

const deleteAiTopic = async (req: AdminRequest, res: Response) => {
  try {
    await pool.execute(`DELETE FROM ai_knowledge_base WHERE id = ?`, [req.params.id]);
    res.status(200).json({ success: true, message: 'Topic deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to delete topic.' }); }
};

const listLiveChats = async (req: AdminRequest, res: Response) => {
  try {
    const [rows]: any = await pool.execute(`SELECT id, user_id, status FROM chat_sessions WHERE status = 'handoff_to_admin' ORDER BY updated_at DESC`);
    res.status(200).json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch chats.' }); }
};

const getSystemSettings = async (req: AdminRequest, res: Response) => {
  try {
    const [rows]: any = await pool.execute(`SELECT setting_key, setting_value FROM system_settings`);
    const settings = rows.reduce((acc: any, row: any) => ({ ...acc, [row.setting_key]: row.setting_value }), {});
    res.status(200).json({ success: true, data: settings });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch settings.' }); }
};

const updateSystemSettings = async (req: AdminRequest, res: Response) => {
  try {
    const { settings } = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await pool.execute(`INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [key, String(value), String(value)]);
    }
    await LogModel.write({ ...ctx(req), eventType: 'SETTINGS_UPDATED', severity: 'info', message: `Admin updated system settings` });
    res.status(200).json({ success: true, message: 'Settings saved.' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to save settings.' }); }
};

// ═════════════════════════════════════════════
// G. AUDIT LOG VIEWER
// ═════════════════════════════════════════════

const getAuditLogs = async (req: AdminRequest, res: Response) => {
  try {
    const {
      page      = '1',
      limit     = '50',
      severity,
      eventType,
      userId,
      ipAddress,
      from,
      to,
      q,
      includePayload = false,
    } = req.query;

    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(200, parseInt(limit as string) || 50);
    const offset      = (parsedPage - 1) * parsedLimit;

    const conditions: string[] = [];
    const params: any[]        = [];

    if (severity)  { conditions.push('l.severity = ?');    params.push(severity); }
    if (eventType) { conditions.push('l.event_type = ?');  params.push(eventType); }
    if (userId)    { conditions.push('l.user_id = ?');     params.push(userId); }
    if (ipAddress) { conditions.push('l.ip_address = ?');  params.push(ipAddress); }
    if (from)      { conditions.push('l.created_at >= ?'); params.push(from); }
    if (to)        { conditions.push('l.created_at <= ?'); params.push(to); }

    if (q && (q as string).trim()) {
      const qparam = `%${(q as string).trim()}%`;
      let searchClause = '(l.message LIKE ? OR l.endpoint LIKE ? OR u.username LIKE ?)';
      params.push(qparam, qparam, qparam);
      if (includePayload === 'true') {
        searchClause = `(l.message LIKE ? OR l.endpoint LIKE ? OR u.username LIKE ? OR l.payload LIKE ?)`;
        params.push(qparam);
      }
      conditions.push(searchClause);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const selectPayload = includePayload === 'true';
    const selectCols = `l.id, l.event_type, l.severity,
          l.ip_address, l.user_agent, l.endpoint,
          l.method, l.status_code, l.message, l.created_at,
          u.username AS actor_username${selectPayload ? ', l.payload' : ''}`;

    const [rows]: any = await pool.execute(
      `SELECT ${selectCols}
       FROM logs l
       LEFT JOIN users u ON u.id = l.user_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total FROM logs l LEFT JOIN users u ON u.id = l.user_id ${where}`,
      params
    );

    const sanitized = rows.map((r: any) => {
      if (r.payload && typeof r.payload === 'string') {
        try { r.payload = JSON.parse(r.payload); } catch (e) { /* leave as string */ }
      }
      if (selectPayload && r.payload && typeof r.payload === 'object') {
        r.payload = redactPayloadRecursive(r.payload);
      }
      return r;
    });

    res.status(200).json({
      success    : true,
      data       : sanitized,
      pagination : buildPagination(parsedPage, parsedLimit, Number(total)),
    });

  } catch (err) {
    logger.error('getAuditLogs error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs.' });
  }
};

const getSuspiciousActivity = async (req: AdminRequest, res: Response) => {
  try {
    const hours  = Math.min(168, parseInt(req.query.hours as string) || 24);
    const limit  = Math.min(200, parseInt(req.query.limit as string) || 100);

    const [rows]: any = await pool.execute(
      `SELECT
         l.id, l.event_type, l.severity,
         l.ip_address, l.user_agent, l.endpoint,
         l.method, l.message, l.payload, l.created_at,
         u.username AS actor_username
       FROM logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.severity IN ('warn', 'critical')
         AND l.created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
       ORDER BY l.created_at DESC
       LIMIT ?`,
      [hours, limit]
    );

    const byIp = rows.reduce((acc: Record<string, number>, row: any) => {
      const ip = row.ip_address ?? 'unknown';
      acc[ip]  = (acc[ip] ?? 0) + 1;
      return acc;
    }, {});

    const hotspots = Object.entries(byIp)
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, eventCount: count as number }));

    res.status(200).json({
      success   : true,
      window    : `${hours}h`,
      total     : rows.length,
      hotspots,
      data      : rows,
    });

  } catch (err) {
    logger.error('getSuspiciousActivity error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch suspicious activity.' });
  }
};

// ═════════════════════════════════════════════
// H. SYSTEM HEALTH
// ═════════════════════════════════════════════

const getSystemHealth = async (req: AdminRequest, res: Response) => {
  try {
    const start = Date.now();
    const conn: any = await pool.getConnection();
    await conn.ping();
    conn.release();
    const dbLatency = Date.now() - start;

    const mem     = process.memoryUsage();
    const mbUsed  = Math.round(mem.heapUsed  / 1024 / 1024);
    const mbTotal = Math.round(mem.heapTotal / 1024 / 1024);

    const [[{ disputes }]]: any = await pool.execute(
      `SELECT COUNT(*) AS disputes FROM escrow_transactions WHERE status = 'disputed'`
    );

    const [[{ locked }]]: any = await pool.execute(
      `SELECT COUNT(*) AS locked FROM users WHERE locked_until > NOW()`
    );

    res.status(200).json({
      success : true,
      data    : {
        status      : 'healthy',
        uptime      : `${Math.floor(process.uptime())}s`,
        environment : process.env.NODE_ENV ?? 'development',
        database    : { status: 'connected', latency: `${dbLatency}ms` },
        memory      : { used: `${mbUsed}MB`, total: `${mbTotal}MB`, percent: `${Math.round(mbUsed / mbTotal * 100)}%` },
        attention   : {
          openDisputes   : Number(disputes),
          lockedAccounts : Number(locked),
        },
        timestamp   : new Date().toISOString(),
      },
    });

  } catch (err) {
    logger.error('getSystemHealth error:', err);
    res.status(503).json({ success: false, message: 'System health check failed.', status: 'degraded' });
  }
};

// ─────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────

const SENSITIVE_FIELD_PATTERNS = [
  /password/i, /password_confirmation/i, /pass_confirm/i,
  /access[_-]?token/i, /refresh[_-]?token/i, /mfa[_-]?secret/i,
  /backup[_-]?code/i, /backup_codes?/i, /card[_-]?number/i,
  /cardnumber/i, /cvv/i, /cvc/i, /pan/i, /ssn/i,
  /account[_-]?number/i, /routing[_-]?number/i, /secret/i,
  /token/i, /api[_-]?key/i,
];

const redactValue = () => '[REDACTED]';

const looksLikeCardNumber = (s: string) => typeof s === 'string' && /^\d{13,19}$/.test(s.replace(/\s+/g, ''));
const looksLikeJWT = (s: string) => typeof s === 'string' && /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s);

const isSensitiveKey = (key: string) => {
  if (!key) return false;
  for (const re of SENSITIVE_FIELD_PATTERNS) {
    if (re.test(key)) return true;
  }
  return false;
};

const redactPayloadRecursive = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(redactPayloadRecursive);
  if (obj && typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      try {
        if (isSensitiveKey(k)) {
          out[k] = redactValue();
          continue;
        }
        if (v === null || v === undefined) { out[k] = v; continue; }
        if (typeof v === 'string') {
          const trimmed = (v as string).trim();
          if (looksLikeCardNumber(trimmed) || looksLikeJWT(trimmed) || /secret|token|key/i.test(k)) {
            out[k] = redactValue();
            continue;
          }
          out[k] = trimmed.replace(/\b\d{13,19}\b/g, redactValue());
        } else if (typeof v === 'object') {
          out[k] = redactPayloadRecursive(v);
        } else {
          out[k] = v;
        }
      } catch (e) {
        out[k] = redactValue();
      }
    }
    return out;
  }
  return obj;
};

const formatUser = (u: any) => ({
  id            : u.id,
  email         : u.email,
  username      : u.username,
  role          : u.role,
  fullName      : u.full_name,
  phone         : u.phone ?? null,
  isActive      : Boolean(u.is_active),
  isVerified    : Boolean(u.is_verified),
  mfaEnabled    : Boolean(u.mfa_enabled),
  failedAttempts: u.failed_attempts,
  lastLoginAt   : u.last_login_at,
  lastLoginIp   : u.last_login_ip,
  createdAt     : u.created_at,
});

const mapRow = (row: any) => {
  if (!row) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'bigint' ? Number(v)
           : typeof v === 'string' && /^\d+\.\d+$/.test(v as string) ? parseFloat(v as string)
           : v;
  }
  return out;
};

const buildPagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages : Math.ceil(total / limit),
});

export = {
  getDashboardStats,
  listUsers,
  getUserDetail,
  suspendUser,
  changeUserRole,
  deleteUser,
  listAllProducts,
  deleteProduct,
  listAllOrders,
  getRevenueReport,
  getAuditLogs,
  getSuspiciousActivity,
  getSystemHealth,
  listAllReviews,
  hideReview,
  listEscrow,
  resolveEscrowDispute,
  listPayments,
  updatePaymentStatus,
  listAiKnowledge,
  addAiTopic,
  deleteAiTopic,
  listLiveChats,
  getSystemSettings,
  updateSystemSettings
};