import { RowDataPacket } from 'mysql2';
import { pool } from '../config/db';

export interface Category extends RowDataPacket {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parent_id?: string;
  image_url?: string;
  is_active: number;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryWithChildren extends Category {
  children?: CategoryWithChildren[];
}

class CategoryModel {
  /**
   * Create a new category
   */
  static async create(data: {
    name: string;
    slug: string;
    description?: string;
    parent_id?: string;
    image_url?: string;
    display_order?: number;
  }): Promise<string> {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO categories 
        (name, slug, description, parent_id, image_url, display_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `;
      const [result]: any = await conn.execute(query, [
        data.name,
        data.slug,
        data.description || null,
        data.parent_id || null,
        data.image_url || null,
        data.display_order || 0,
      ]);
      return result.insertId;
    } finally {
      conn.release();
    }
  }

  /**
   * Get category by ID
   */
  static async getById(id: string): Promise<Category | null> {
    const conn = await pool.getConnection();
    try {
      const query = 'SELECT * FROM categories WHERE id = ? AND is_active = 1';
      const [rows] = await conn.execute<Category[]>(query, [id]);
      return rows.length > 0 ? rows[0] : null;
    } finally {
      conn.release();
    }
  }

  /**
   * Get category by slug
   */
  static async getBySlug(slug: string): Promise<Category | null> {
    const conn = await pool.getConnection();
    try {
      const query = 'SELECT * FROM categories WHERE slug = ? AND is_active = 1';
      const [rows] = await conn.execute<Category[]>(query, [slug]);
      return rows.length > 0 ? rows[0] : null;
    } finally {
      conn.release();
    }
  }

  /**
   * Get all top-level categories (parent_id IS NULL)
   */
  static async getTopLevel(): Promise<Category[]> {
    const conn = await pool.getConnection();
    try {
      const query = `
        SELECT * FROM categories 
        WHERE parent_id IS NULL AND is_active = 1
        ORDER BY display_order ASC, name ASC
      `;
      const [rows] = await conn.execute<Category[]>(query);
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Get subcategories for a parent
   */
  static async getByParentId(parentId: string): Promise<Category[]> {
    const conn = await pool.getConnection();
    try {
      const query = `
        SELECT * FROM categories 
        WHERE parent_id = ? AND is_active = 1
        ORDER BY display_order ASC, name ASC
      `;
      const [rows] = await conn.execute<Category[]>(query, [parentId]);
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Get category hierarchy (tree structure)
   */
  static async getHierarchy(): Promise<CategoryWithChildren[]> {
    const conn = await pool.getConnection();
    try {
      // Get all active categories
      const query = `
        SELECT * FROM categories 
        WHERE is_active = 1
        ORDER BY display_order ASC, name ASC
      `;
      const [rows] = await conn.execute<Category[]>(query);

      // Build hierarchy
      const categories = new Map<string, CategoryWithChildren>();
      const rootCategories: CategoryWithChildren[] = [];

      rows.forEach((cat) => {
        categories.set(cat.id, { ...cat, children: [] });
      });

      rows.forEach((cat) => {
        if (cat.parent_id) {
          const parent = categories.get(cat.parent_id);
          if (parent) {
            parent.children?.push(categories.get(cat.id)!);
          }
        } else {
          rootCategories.push(categories.get(cat.id)!);
        }
      });

      return rootCategories;
    } finally {
      conn.release();
    }
  }

  /**
   * Get all active categories (flat list)
   */
  static async getAll(): Promise<Category[]> {
    const conn = await pool.getConnection();
    try {
      const query = `
        SELECT * FROM categories 
        WHERE is_active = 1
        ORDER BY display_order ASC, name ASC
      `;
      const [rows] = await conn.execute<Category[]>(query);
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Update category
   */
  static async update(
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string;
      parent_id?: string;
      image_url?: string;
      display_order?: number;
      is_active?: number;
    }
  ): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (data.name !== undefined) {
        updates.push('name = ?');
        values.push(data.name);
      }
      if (data.slug !== undefined) {
        updates.push('slug = ?');
        values.push(data.slug);
      }
      if (data.description !== undefined) {
        updates.push('description = ?');
        values.push(data.description);
      }
      if (data.parent_id !== undefined) {
        updates.push('parent_id = ?');
        values.push(data.parent_id);
      }
      if (data.image_url !== undefined) {
        updates.push('image_url = ?');
        values.push(data.image_url);
      }
      if (data.display_order !== undefined) {
        updates.push('display_order = ?');
        values.push(data.display_order);
      }
      if (data.is_active !== undefined) {
        updates.push('is_active = ?');
        values.push(data.is_active);
      }

      if (updates.length === 0) return true;

      values.push(id);
      const query = `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`;
      const [result]: any = await conn.execute(query, values);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Soft delete category (set is_active = 0)
   */
  static async delete(id: string): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = 'UPDATE categories SET is_active = 0 WHERE id = ?';
      const [result]: any = await conn.execute(query, [id]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }
}

export default CategoryModel;
