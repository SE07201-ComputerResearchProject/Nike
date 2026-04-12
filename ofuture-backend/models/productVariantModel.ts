import { RowDataPacket } from 'mysql2';
import { pool } from '../config/db';

export interface ProductVariant extends RowDataPacket {
  id: string;
  product_id: string;
  attribute_name: string;
  attribute_value: string;
  sku: string;
  stock_quantity: number;
  price_adjustment: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface VariantGroup {
  attribute_name: string;
  values: Array<{
    value: string;
    sku: string;
    stock_quantity: number;
    price_adjustment: number;
  }>;
}

class ProductVariantModel {
  /**
   * Create a new product variant
   */
  static async create(data: {
    product_id: string;
    attribute_name: string;
    attribute_value: string;
    sku: string;
    stock_quantity: number;
    price_adjustment?: number;
  }): Promise<string> {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO product_variants 
        (product_id, attribute_name, attribute_value, sku, stock_quantity, price_adjustment, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `;
      const [result]: any = await conn.execute(query, [
        data.product_id,
        data.attribute_name,
        data.attribute_value,
        data.sku,
        data.stock_quantity,
        data.price_adjustment || 0,
      ]);
      return result.insertId;
    } finally {
      conn.release();
    }
  }

  /**
   * Get variant by ID
   */
  static async getById(id: string): Promise<ProductVariant | null> {
    const conn = await pool.getConnection();
    try {
      const query = 'SELECT * FROM product_variants WHERE id = ?';
      const [rows] = await conn.execute<ProductVariant[]>(query, [id]);
      return rows.length > 0 ? rows[0] : null;
    } finally {
      conn.release();
    }
  }

  /**
   * Get variant by SKU
   */
  static async getBySku(sku: string): Promise<ProductVariant | null> {
    const conn = await pool.getConnection();
    try {
      const query = 'SELECT * FROM product_variants WHERE sku = ? AND is_active = 1';
      const [rows] = await conn.execute<ProductVariant[]>(query, [sku]);
      return rows.length > 0 ? rows[0] : null;
    } finally {
      conn.release();
    }
  }

  /**
   * Get all variants for a product
   */
  static async getByProductId(productId: string): Promise<ProductVariant[]> {
    const conn = await pool.getConnection();
    try {
      const query = `
        SELECT * FROM product_variants 
        WHERE product_id = ? AND is_active = 1
        ORDER BY attribute_name ASC, attribute_value ASC
      `;
      const [rows] = await conn.execute<ProductVariant[]>(query, [productId]);
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Get available variants for a product (stock > 0)
   */
  static async getAvailableByProduct(productId: string): Promise<ProductVariant[]> {
    const conn = await pool.getConnection();
    try {
      const query = `
        SELECT * FROM product_variants 
        WHERE product_id = ? AND is_active = 1 AND stock_quantity > 0
        ORDER BY attribute_name ASC, attribute_value ASC
      `;
      const [rows] = await conn.execute<ProductVariant[]>(query, [productId]);
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Group variants by attribute name
   * Useful for displaying variant options (e.g., sizes, colors)
   */
  static async getGroupedByProduct(productId: string): Promise<VariantGroup[]> {
    const conn = await pool.getConnection();
    try {
      const query = `
        SELECT * FROM product_variants 
        WHERE product_id = ? AND is_active = 1
        ORDER BY attribute_name ASC, attribute_value ASC
      `;
      const [variants] = await conn.execute<ProductVariant[]>(query, [productId]);

      const grouped = new Map<string, VariantGroup>();

      variants.forEach((v) => {
        if (!grouped.has(v.attribute_name)) {
          grouped.set(v.attribute_name, {
            attribute_name: v.attribute_name,
            values: [],
          });
        }

        grouped.get(v.attribute_name)!.values.push({
          value: v.attribute_value,
          sku: v.sku,
          stock_quantity: v.stock_quantity,
          price_adjustment: v.price_adjustment,
        });
      });

      return Array.from(grouped.values());
    } finally {
      conn.release();
    }
  }

  /**
   * Update variant stock quantity
   */
  static async updateStock(id: string, newStock: number): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = 'UPDATE product_variants SET stock_quantity = ? WHERE id = ?';
      const [result]: any = await conn.execute(query, [newStock, id]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Decrease stock for a variant (used when order is placed)
   */
  static async decrementStock(id: string, quantity: number): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = `
        UPDATE product_variants 
        SET stock_quantity = GREATEST(0, stock_quantity - ?)
        WHERE id = ?
      `;
      const [result]: any = await conn.execute(query, [quantity, id]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Increase stock for a variant (used when order is cancelled)
   */
  static async incrementStock(id: string, quantity: number): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = `
        UPDATE product_variants 
        SET stock_quantity = stock_quantity + ?
        WHERE id = ?
      `;
      const [result]: any = await conn.execute(query, [quantity, id]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Update variant details
   */
  static async update(
    id: string,
    data: {
      attribute_name?: string;
      attribute_value?: string;
      sku?: string;
      stock_quantity?: number;
      price_adjustment?: number;
      is_active?: number;
    }
  ): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (data.attribute_name !== undefined) {
        updates.push('attribute_name = ?');
        values.push(data.attribute_name);
      }
      if (data.attribute_value !== undefined) {
        updates.push('attribute_value = ?');
        values.push(data.attribute_value);
      }
      if (data.sku !== undefined) {
        updates.push('sku = ?');
        values.push(data.sku);
      }
      if (data.stock_quantity !== undefined) {
        updates.push('stock_quantity = ?');
        values.push(data.stock_quantity);
      }
      if (data.price_adjustment !== undefined) {
        updates.push('price_adjustment = ?');
        values.push(data.price_adjustment);
      }
      if (data.is_active !== undefined) {
        updates.push('is_active = ?');
        values.push(data.is_active);
      }

      if (updates.length === 0) return true;

      values.push(id);
      const query = `UPDATE product_variants SET ${updates.join(', ')} WHERE id = ?`;
      const [result]: any = await conn.execute(query, values);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Delete variant
   */
  static async delete(id: string): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = 'UPDATE product_variants SET is_active = 0 WHERE id = ?';
      const [result]: any = await conn.execute(query, [id]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Delete all variants for a product (when product is deleted)
   */
  static async deleteByProductId(productId: string): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = 'UPDATE product_variants SET is_active = 0 WHERE product_id = ?';
      const [result]: any = await conn.execute(query, [productId]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Get total stock for a product (sum of all variants)
   */
  static async getTotalStockForProduct(productId: string): Promise<number> {
    const conn = await pool.getConnection();
    try {
      const query = `
        SELECT SUM(stock_quantity) as total 
        FROM product_variants 
        WHERE product_id = ? AND is_active = 1
      `;
      const [rows]: any = await conn.execute(query, [productId]);
      return rows[0].total || 0;
    } finally {
      conn.release();
    }
  }
}

export default ProductVariantModel;
