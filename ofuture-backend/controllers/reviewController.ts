// controllers/reviewController.ts
// ─────────────────────────────────────────────
// Review & Rating system controller.
//
// Buyer:  createReview, editReview, deleteReview
// Public: getProductReviews, getReviewById
// Admin:  hideReview, unhideReview, adminListAll
//
// Rules enforced here:
//   1. Only buyers with a COMPLETED order for that
//      product may leave a review.
//   2. One review per buyer per product (DB unique key
//      is the ultimate guard; we pre-check for clarity).
//   3. Product avg_rating + review_count are
//      recalculated inside the same transaction
//      as the INSERT so they are never stale.
// ─────────────────────────────────────────────

import { Request, Response } from 'express';
import { pool } from '../config/db';
import ReviewModel from '../models/reviewModel';
import ProductModel from '../models/productModel';
import { LogModel, LOG_EVENTS } from '../models/logModel';
import logger from '../utils/logger';

interface ReviewRequest extends Request {
  user?: any;
  meta?: any;
}

// ── Audit context helper ──────────────────────
const ctx = (req: ReviewRequest) => ({
  userId    : req.user?.id ?? null,
  ipAddress : req.meta?.ip,
  userAgent : req.meta?.userAgent,
  endpoint  : req.originalUrl,
  method    : req.method,
});

// ─────────────────────────────────────────────
// POST /api/reviews
// Buyer creates a review for a completed order.
// ─────────────────────────────────────────────
const createReview = async (req: ReviewRequest, res: Response): Promise<any> => {
  const { orderId, rating, title, body: reviewBody } = req.body;
  const buyerId = req.user.id;

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Verify the order exists, belongs to buyer,
    //       is for an active product, and is completed ──
    const [[order]]: any = await conn.execute(
      `SELECT o.id, o.product_id, o.buyer_id, o.status,
              p.name AS product_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.id = ? AND o.buyer_id = ?
       LIMIT 1`,
      [orderId, buyerId]
    );

    if (!order) {
      await conn.rollback();
      return res.status(404).json({
        success : false,
        message : 'Order not found or does not belong to you.',
      });
    }

    if (order.status !== 'completed') {
      await conn.rollback();
      return res.status(409).json({
        success : false,
        message : `Reviews can only be left for completed orders. This order is "${order.status}".`,
      });
    }

    // ── 2. Check for duplicate review (buyer + product) ──
    const [[existing]]: any = await conn.execute(
      `SELECT id FROM reviews
       WHERE buyer_id = ? AND product_id = ?
       LIMIT 1`,
      [buyerId, order.product_id]
    );

    if (existing) {
      await conn.rollback();
      return res.status(409).json({
        success    : false,
        message    : 'You have already reviewed this product.',
        existingId : existing.id,
      });
    }

    // ── 3. Insert review ──────────────────────
    await conn.execute(
      `INSERT INTO reviews
         (product_id, buyer_id, order_id, rating, title, body, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        order.product_id,
        buyerId,
        orderId,
        rating,
        title      ? title.trim()      : null,
        reviewBody ? reviewBody.trim() : null,
      ]
    );

    // ── 4. Fetch the new review ID ────────────
    const [[newReview]]: any = await conn.execute(
      `SELECT id, created_at FROM reviews
       WHERE buyer_id = ? AND product_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [buyerId, order.product_id]
    );

    // ── 5. Recalculate product avg_rating and review_count ──
    await conn.execute(
      `UPDATE products
       SET avg_rating   = (
             SELECT COALESCE(AVG(r.rating), 0)
             FROM reviews r
             WHERE r.product_id = ? AND r.is_hidden = 0
           ),
           review_count = (
             SELECT COUNT(*)
             FROM reviews r
             WHERE r.product_id = ? AND r.is_hidden = 0
           )
       WHERE id = ?`,
      [order.product_id, order.product_id, order.product_id]
    );

    await conn.commit();

    await LogModel.write({
      ...ctx(req),
      eventType : 'REVIEW_CREATED',
      severity  : 'info',
      message   : `Review created: reviewId=${newReview.id} productId=${order.product_id} rating=${rating}`,
    });

    logger.info(`Review created: id=${newReview.id} product=${order.product_id} buyer=${buyerId}`);

    res.status(201).json({
      success : true,
      message : 'Review posted successfully.',
      data    : {
        id          : newReview.id,
        productId   : order.product_id,
        productName : order.product_name,
        orderId,
        rating,
        title       : title ?? null,
        body        : reviewBody ?? null,
        isVerified  : true,
        createdAt   : newReview.created_at,
      },
    });

  } catch (err: any) {
    await conn.rollback().catch(() => {});

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success : false,
        message : 'You have already reviewed this product.',
      });
    }

    logger.error('createReview error:', err);
    res.status(500).json({ success: false, message: 'Failed to post review.' });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// GET /api/products/:productId/reviews
// Public — paginated reviews for a product.
// Only non-hidden reviews are returned.
// ─────────────────────────────────────────────
const getProductReviews = async (req: ReviewRequest, res: Response): Promise<any> => {
  try {
    const productId = req.params.productId as string;
    const {
      page  = '1',
      limit = '20',
      sort  = 'newest',
    } = req.query;

    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit as string) || 20));
    const offset      = (parsedPage - 1) * parsedLimit;

    const product: any = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const orderMap: Record<string, string> = {
      newest  : 'r.created_at DESC',
      oldest  : 'r.created_at ASC',
      highest : 'r.rating DESC, r.created_at DESC',
      lowest  : 'r.rating ASC,  r.created_at DESC',
    };
    const orderBy = orderMap[sort as string] ?? orderMap.newest;

    const [reviews]: any = await pool.execute(
      `SELECT
         r.id, r.rating, r.title, r.body,
         r.is_verified, r.created_at, r.updated_at,
         u.username   AS buyer_username,
         u.avatar_url AS buyer_avatar
       FROM reviews r
       JOIN users u ON u.id = r.buyer_id
       WHERE r.product_id = ? AND r.is_hidden = 0
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [productId, parsedLimit, offset]
    );

    const [distribution]: any = await pool.execute(
      `SELECT rating, COUNT(*) AS count
       FROM reviews
       WHERE product_id = ? AND is_hidden = 0
       GROUP BY rating
       ORDER BY rating DESC`,
      [productId]
    );

    const distMap: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const row of distribution) {
      distMap[row.rating as number] = Number(row.count);
    }

    const [[{ total }]]: any = await pool.execute(
      'SELECT COUNT(*) AS total FROM reviews WHERE product_id = ? AND is_hidden = 0',
      [productId]
    );

    res.status(200).json({
      success  : true,
      product  : {
        id          : product.id,
        name        : product.name,
        avgRating   : parseFloat(product.avg_rating ?? 0),
        reviewCount : product.review_count ?? 0,
      },
      distribution : distMap,
      data         : reviews.map((r: any) => formatReview(r)),
      pagination   : {
        page       : parsedPage,
        limit      : parsedLimit,
        total      : Number(total),
        totalPages : Math.ceil(Number(total) / parsedLimit),
      },
    });

  } catch (err) {
    logger.error('getProductReviews error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/reviews/:id
// Public — single review detail.
// ─────────────────────────────────────────────
const getReviewById = async (req: ReviewRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const [rows]: any = await pool.execute(
      `SELECT
         r.id, r.rating, r.title, r.body,
         r.is_verified, r.is_hidden, r.created_at, r.updated_at,
         r.product_id, r.order_id,
         u.username   AS buyer_username,
         u.avatar_url AS buyer_avatar,
         p.name       AS product_name
       FROM reviews r
       JOIN users    u ON u.id = r.buyer_id
       JOIN products p ON p.id = r.product_id
       WHERE r.id = ?
       LIMIT 1`,
      [id]
    );

    const review = rows[0];

    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }

    if (review.is_hidden && req.user?.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }

    res.status(200).json({ success: true, data: formatReview(review, true) });

  } catch (err) {
    logger.error('getReviewById error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch review.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/reviews/my
// Buyer — list all their own reviews.
// ─────────────────────────────────────────────
const getMyReviews = async (req: ReviewRequest, res: Response): Promise<any> => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(50, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const [rows]: any = await pool.execute(
      `SELECT
         r.id, r.rating, r.title, r.body,
         r.is_verified, r.is_hidden, r.created_at,
         p.id   AS product_id,
         p.name AS product_name,
         p.slug AS product_slug
       FROM reviews r
       JOIN products p ON p.id = r.product_id
       WHERE r.buyer_id = ?
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      'SELECT COUNT(*) AS total FROM reviews WHERE buyer_id = ?',
      [req.user.id]
    );

    res.status(200).json({
      success    : true,
      data       : rows.map((r: any) => formatReview(r, false, true)),
      pagination : {
        page       : parsedPage,
        limit      : parsedLimit,
        total      : Number(total),
        totalPages : Math.ceil(Number(total) / parsedLimit),
      },
    });

  } catch (err) {
    logger.error('getMyReviews error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch your reviews.' });
  }
};

// ─────────────────────────────────────────────
// PUT /api/reviews/:id
// Buyer edits their own review.
// Product rating is recalculated after the update.
// ─────────────────────────────────────────────
const editReview = async (req: ReviewRequest, res: Response): Promise<any> => {
  const id = req.params.id as string;
  const { rating, title, body: reviewBody } = req.body;
  const buyerId = req.user.id;

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[review]]: any = await conn.execute(
      'SELECT * FROM reviews WHERE id = ? FOR UPDATE',
      [id]
    );

    if (!review) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }

    if (req.user.role !== 'admin' && review.buyer_id !== buyerId) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: 'Access denied. You did not write this review.' });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (rating !== undefined)     { updates.push('rating = ?'); params.push(rating); }
    if (title  !== undefined)     { updates.push('title  = ?'); params.push(title  ? title.trim()      : null); }
    if (reviewBody !== undefined) { updates.push('body   = ?'); params.push(reviewBody ? reviewBody.trim() : null); }

    if (!updates.length) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'No fields provided to update.' });
    }

    params.push(id);
    await conn.execute(
      `UPDATE reviews SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (rating !== undefined) {
      await conn.execute(
        `UPDATE products
         SET avg_rating   = (
               SELECT COALESCE(AVG(r.rating), 0)
               FROM reviews r WHERE r.product_id = ? AND r.is_hidden = 0
             ),
             review_count = (
               SELECT COUNT(*)
               FROM reviews r WHERE r.product_id = ? AND r.is_hidden = 0
             )
         WHERE id = ?`,
        [review.product_id, review.product_id, review.product_id]
      );
    }

    await conn.commit();

    const [[updated]]: any = await pool.execute(
      'SELECT * FROM reviews WHERE id = ?', [id]
    );

    res.status(200).json({
      success : true,
      message : 'Review updated successfully.',
      data    : formatReview(updated),
    });

  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('editReview error:', err);
    res.status(500).json({ success: false, message: 'Failed to update review.' });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// DELETE /api/reviews/:id
// Buyer deletes their own review.
// Product rating is recalculated.
// ─────────────────────────────────────────────
const deleteReview = async (req: ReviewRequest, res: Response): Promise<any> => {
  const id = req.params.id as string;
  const buyerId = req.user.id;

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[review]]: any = await conn.execute(
      'SELECT * FROM reviews WHERE id = ? FOR UPDATE',
      [id]
    );

    if (!review) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }

    if (req.user.role !== 'admin' && review.buyer_id !== buyerId) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    await conn.execute('DELETE FROM reviews WHERE id = ?', [id]);

    await conn.execute(
      `UPDATE products
       SET avg_rating   = (
             SELECT COALESCE(AVG(r.rating), 0)
             FROM reviews r WHERE r.product_id = ? AND r.is_hidden = 0
           ),
           review_count = (
             SELECT COUNT(*)
             FROM reviews r WHERE r.product_id = ? AND r.is_hidden = 0
           )
       WHERE id = ?`,
      [review.product_id, review.product_id, review.product_id]
    );

    await conn.commit();

    await LogModel.write({
      ...ctx(req),
      eventType : 'REVIEW_DELETED',
      severity  : 'warn',
      message   : `Review deleted: id=${id} productId=${review.product_id} by userId=${req.user.id}`,
    });

    res.status(200).json({ success: true, message: 'Review deleted successfully.' });

  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('deleteReview error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete review.' });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// PUT /api/reviews/:id/hide   (Admin)
// PUT /api/reviews/:id/unhide (Admin)
// ─────────────────────────────────────────────
const setReviewVisibility = (hidden: boolean) => async (req: ReviewRequest, res: Response): Promise<any> => {
  const id = req.params.id as string;

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[review]]: any = await conn.execute(
      'SELECT * FROM reviews WHERE id = ? FOR UPDATE',
      [id]
    );

    if (!review) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }

    await conn.execute(
      'UPDATE reviews SET is_hidden = ? WHERE id = ?',
      [hidden ? 1 : 0, id]
    );

    await conn.execute(
      `UPDATE products
       SET avg_rating   = (
             SELECT COALESCE(AVG(r.rating), 0)
             FROM reviews r WHERE r.product_id = ? AND r.is_hidden = 0
           ),
           review_count = (
             SELECT COUNT(*)
             FROM reviews r WHERE r.product_id = ? AND r.is_hidden = 0
           )
       WHERE id = ?`,
      [review.product_id, review.product_id, review.product_id]
    );

    await conn.commit();

    const action = hidden ? 'hidden' : 'made visible';
    await LogModel.write({
      ...ctx(req),
      eventType : hidden ? 'REVIEW_HIDDEN' : 'REVIEW_UNHIDDEN',
      severity  : 'warn',
      message   : `Admin ${action} review id=${id}`,
    });

    res.status(200).json({
      success : true,
      message : `Review ${action} successfully.`,
      data    : { id, isHidden: hidden },
    });

  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('setReviewVisibility error:', err);
    res.status(500).json({ success: false, message: 'Failed to update review visibility.' });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// GET /api/reviews/admin/all  (Admin)
// ─────────────────────────────────────────────
const adminListAll = async (req: ReviewRequest, res: Response): Promise<any> => {
  try {
    const {
      page      = '1',
      limit     = '20',
      isHidden,
      productId,
      minRating,
      maxRating,
    } = req.query;

    const parsedPage  = Math.max(1, parseInt(page as string) || 1);
    const parsedLimit = Math.min(100, parseInt(limit as string) || 20);
    const offset      = (parsedPage - 1) * parsedLimit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (isHidden  !== undefined) { conditions.push('r.is_hidden = ?');    params.push(isHidden === 'true' ? 1 : 0); }
    if (productId)               { conditions.push('r.product_id = ?');   params.push(productId); }
    if (minRating)               { conditions.push('r.rating >= ?');      params.push(parseInt(minRating as string)); }
    if (maxRating)               { conditions.push('r.rating <= ?');      params.push(parseInt(maxRating as string)); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows]: any = await pool.execute(
      `SELECT
         r.id, r.rating, r.title, r.body,
         r.is_verified, r.is_hidden, r.created_at,
         r.product_id, r.buyer_id, r.order_id,
         u.username AS buyer_username,
         p.name     AS product_name
       FROM reviews r
       JOIN users    u ON u.id = r.buyer_id
       JOIN products p ON p.id = r.product_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parsedLimit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total FROM reviews r ${where}`,
      params
    );

    res.status(200).json({
      success    : true,
      data       : rows.map((r: any) => formatReview(r, true)),
      pagination : {
        page       : parsedPage,
        limit      : parsedLimit,
        total      : Number(total),
        totalPages : Math.ceil(Number(total) / parsedLimit),
      },
    });

  } catch (err) {
    logger.error('adminListAll reviews error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
};

// ─────────────────────────────────────────────
// Private formatters
// ─────────────────────────────────────────────
const formatReview = (r: any, includeAdminFields = false, includeProductInfo = false) => {
  const base: any = {
    id            : r.id,
    rating        : r.rating,
    title         : r.title   ?? null,
    body          : r.body    ?? null,
    isVerified    : Boolean(r.is_verified),
    buyerUsername : r.buyer_username ?? null,
    buyerAvatar   : r.buyer_avatar   ?? null,
    createdAt     : r.created_at,
    updatedAt     : r.updated_at ?? null,
  };

  if (includeAdminFields) {
    base.isHidden  = Boolean(r.is_hidden);
    base.productId = r.product_id;
    base.orderId   = r.order_id;
    base.buyerId   = r.buyer_id;
  }

  if (includeProductInfo) {
    base.product = {
      id   : r.product_id,
      name : r.product_name,
      slug : r.product_slug ?? null,
    };
    base.isHidden = Boolean(r.is_hidden);
  }

  return base;
};

export = {
  createReview,
  getProductReviews,
  getReviewById,
  getMyReviews,
  editReview,
  deleteReview,
  hideReview   : setReviewVisibility(true),
  unhideReview : setReviewVisibility(false),
  adminListAll,
};