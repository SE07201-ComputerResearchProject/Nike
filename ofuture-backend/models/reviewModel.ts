// models/reviewModel.ts
// ─────────────────────────────────────────────
// Data-access layer for the `reviews` table.
// ─────────────────────────────────────────────

import { pool } from '../config/db';

interface CreateReviewParams {
  productId: string;
  buyerId: string;
  orderId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
}

const ReviewModel = {

  async create({ productId, buyerId, orderId, rating, title, body }: CreateReviewParams) {
    const [result]: any = await pool.execute(
      `INSERT INTO reviews (product_id, buyer_id, order_id, rating, title, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [productId, buyerId, orderId, rating, title ?? null, body ?? null]
    );
    return result;
  },

  async findByProduct(productId: string, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const [rows]: any = await pool.execute(
      `SELECT r.id, r.rating, r.title, r.body, r.is_verified, r.created_at,
              u.username AS buyer_username, u.avatar_url
       FROM reviews r
       JOIN users u ON u.id = r.buyer_id
       WHERE r.product_id = ? AND r.is_hidden = 0
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [productId, limit, offset]
    );
    return rows;
  },

  async buyerAlreadyReviewed(buyerId: string, productId: string) {
    const [rows]: any = await pool.execute(
      'SELECT id FROM reviews WHERE buyer_id = ? AND product_id = ? LIMIT 1',
      [buyerId, productId]
    );
    return rows.length > 0;
  },

  async hide(id: string) {
    await pool.execute('UPDATE reviews SET is_hidden = 1 WHERE id = ?', [id]);
  },
};

export = ReviewModel;