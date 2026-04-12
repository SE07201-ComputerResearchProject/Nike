// models/productModel.ts
// ─────────────────────────────────────────────
// Data-access layer for the `products` table.
// ─────────────────────────────────────────────

import { pool } from '../config/db';

interface CreateProductParams {
  sellerId: string;
  name: string;
  slug: string;
  description?: string;
  category: string;
  categoryId?: string;
  price: number;
  wholesalePrice?: number;
  minimumQuantity?: number;
  stockQuantity?: number;
  imageUrls?: string[];
}

interface ListProductParams {
  page?: number;
  limit?: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  sellerId?: string;
  status?: string;
}

const ProductModel = {

  // ── Create ───────────────────────────────
  async create({ sellerId, name, slug, description, category, categoryId, price, wholesalePrice, minimumQuantity, stockQuantity, imageUrls }: CreateProductParams) {
    const [result]: any = await pool.execute(
      `INSERT INTO products
         (seller_id, name, slug, description, category, category_id, price, wholesale_price, minimum_quantity, stock_quantity, image_urls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sellerId, name, slug, description ?? null, category, categoryId ?? null, price, 
       wholesalePrice ?? null, minimumQuantity ?? 1, stockQuantity ?? 0, imageUrls ? JSON.stringify(imageUrls) : null]
    );
    return result;
  },

  // ── Find by ID ────────────────────────────
  async findById(id: string) {
    const [rows]: any = await pool.execute(
      `SELECT p.*, u.username AS seller_username, u.full_name AS seller_name
       FROM products p
       JOIN users u ON u.id = p.seller_id
       WHERE p.id = ? AND p.status != 'deleted' LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  },

  // ── Find by slug ──────────────────────────
  async findBySlug(slug: string) {
    const [rows]: any = await pool.execute(
      `SELECT * FROM products WHERE slug = ? AND status != 'deleted' LIMIT 1`,
      [slug]
    );
    return rows[0] ?? null;
  },

  // ── List with filters & pagination ────────
  async list({ page = 1, limit = 20, category, minPrice, maxPrice, search, sellerId, status = 'active' }: ListProductParams) {
    const offset = (page - 1) * limit;
    const conditions = ["p.status = ?"];
    const params: any[] = [status];

    if (category) { conditions.push('p.category = ?');    params.push(category); }
    if (sellerId) { conditions.push('p.seller_id = ?');   params.push(sellerId); }
    if (minPrice) { conditions.push('p.price >= ?');      params.push(minPrice); }
    if (maxPrice) { conditions.push('p.price <= ?');      params.push(maxPrice); }
    if (search)   {
      conditions.push('MATCH(p.name, p.description, p.category) AGAINST(? IN BOOLEAN MODE)');
      params.push(`${search}*`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [rows]: any = await pool.execute(
      `SELECT p.id, p.name, p.slug, p.category, p.price,
              p.stock_quantity, p.avg_rating, p.review_count,
              p.image_urls, p.created_at,
              u.username AS seller_username
       FROM products p
       JOIN users u ON u.id = p.seller_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total FROM products p ${where}`,
      params
    );

    return { rows, total, page, limit };
  },

  // ── Update ────────────────────────────────
  async update(id: string, sellerId: string | undefined, fields: any) {
    const allowed = ['name', 'description', 'category', 'category_id', 'price', 'wholesale_price', 'minimum_quantity', 'stock_quantity', 'image_urls', 'status'];
    const updates = [];
    const params: any[]  = [];

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(key === 'image_urls' ? JSON.stringify(fields[key]) : fields[key]);
      }
    }

    if (!updates.length) return null;

    if (sellerId !== undefined) {
      params.push(id, sellerId);
      const [result]: any = await pool.execute(
        `UPDATE products SET ${updates.join(', ')} WHERE id = ? AND seller_id = ? AND status != 'deleted'`,
        params
      );
      return result;
    } else {
      params.push(id);
      const [result]: any = await pool.execute(
        `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
      return result;
    }
  },

  // ── Soft delete ───────────────────────────
  async softDelete(id: string, sellerId: string) {
    const [result]: any = await pool.execute(
      `UPDATE products SET status = 'deleted' WHERE id = ? AND seller_id = ?`,
      [id, sellerId]
    );
    return result;
  },

  // ── Update rating (called after review insert) ──
  async recalculateRating(productId: string) {
    await pool.execute(
      `UPDATE products p
       SET avg_rating   = (SELECT COALESCE(AVG(r.rating), 0) FROM reviews r WHERE r.product_id = p.id),
           review_count = (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.is_hidden = 0)
       WHERE p.id = ?`,
      [productId]
    );
  },

  // ── Decrease stock (on order) ─────────────
  async decrementStock(id: string, quantity: number, conn: any = null) {
    const db = conn ?? pool;
    const [result]: any = await db.execute(
      `UPDATE products
       SET stock_quantity = stock_quantity - ?
       WHERE id = ? AND stock_quantity >= ?`,
      [quantity, id, quantity]
    );
    return result.affectedRows > 0;
  },

  // ── Restore stock (on cancel/refund) ──────
  async incrementStock(id: string, quantity: number, conn: any = null) {
    const db = conn ?? pool;
    await db.execute(
      'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
      [quantity, id]
    );
  },
};

export = ProductModel;