import { Request, Response } from 'express';
import CategoryModel from '../models/categoryModel';

/**
 * CategoryController handles category-related HTTP requests
 */
class CategoryController {
  /**
   * GET /api/categories
   * Get all categories (tree structure)
   */
  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const categories = await CategoryModel.getHierarchy();
      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      console.error('Error fetching categories:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch categories',
      });
    }
  }

  /**
   * GET /api/categories/flat
   * Get all categories as flat list
   */
  static async getAllFlat(req: Request, res: Response): Promise<void> {
    try {
      const categories = await CategoryModel.getAll();
      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      console.error('Error fetching categories:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch categories',
      });
    }
  }

  /**
   * GET /api/categories/:id
   * Get category by ID
   */
  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
      const category = await CategoryModel.getById(id);

      if (!category) {
        res.status(404).json({
          success: false,
          message: 'Category not found',
        });
        return;
      }

      res.json({
        success: true,
        data: category,
      });
    } catch (error) {
      console.error('Error fetching category:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch category',
      });
    }
  }

  /**
   * GET /api/categories/slug/:slug
   * Get category by slug
   */
  static async getBySlug(req: Request, res: Response): Promise<void> {
    try {
      const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : String(req.params.slug);
      const category = await CategoryModel.getBySlug(slug);

      if (!category) {
        res.status(404).json({
          success: false,
          message: 'Category not found',
        });
        return;
      }

      res.json({
        success: true,
        data: category,
      });
    } catch (error) {
      console.error('Error fetching category:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch category',
      });
    }
  }

  /**
   * GET /api/categories/:id/children
   * Get subcategories for a parent
   */
  static async getChildren(req: Request, res: Response): Promise<void> {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
      const children = await CategoryModel.getByParentId(id);

      res.json({
        success: true,
        data: children,
      });
    } catch (error) {
      console.error('Error fetching subcategories:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subcategories',
      });
    }
  }

  /**
   * POST /api/categories (Admin only)
   * Create new category
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      // Check if user is admin (assumes middleware sets user role)
      const user: any = (req as any).user;
      if (!user || user.role !== 'admin') {
        res.status(403).json({
          success: false,
          message: 'Only admins can create categories',
        });
        return;
      }

      const { name, slug, description, parent_id, image_url, display_order } = req.body;

      if (!name || !slug) {
        res.status(400).json({
          success: false,
          message: 'Name and slug are required',
        });
        return;
      }

      // Check slug uniqueness
      const existing = await CategoryModel.getBySlug(slug);
      if (existing) {
        res.status(400).json({
          success: false,
          message: 'Slug already exists',
        });
        return;
      }

      const id = await CategoryModel.create({
        name,
        slug,
        description,
        parent_id,
        image_url,
        display_order,
      });

      const category = await CategoryModel.getById(id);

      res.status(201).json({
        success: true,
        message: 'Category created successfully',
        data: category,
      });
    } catch (error) {
      console.error('Error creating category:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create category',
      });
    }
  }

  /**
   * PUT /api/categories/:id (Admin only)
   * Update category
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      // Check if user is admin
      const user: any = (req as any).user;
      if (!user || user.role !== 'admin') {
        res.status(403).json({
          success: false,
          message: 'Only admins can update categories',
        });
        return;
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
      const { name, slug, description, parent_id, image_url, display_order, is_active } = req.body;

      // Check slug uniqueness if slug is being changed
      if (slug) {
        const existing = await CategoryModel.getBySlug(slug);
        if (existing && existing.id !== id) {
          res.status(400).json({
            success: false,
            message: 'Slug already exists',
          });
          return;
        }
      }

      const success = await CategoryModel.update(id, {
        name,
        slug,
        description,
        parent_id,
        image_url,
        display_order,
        is_active,
      });

      if (!success) {
        res.status(404).json({
          success: false,
          message: 'Category not found',
        });
        return;
      }

      const category = await CategoryModel.getById(id);

      res.json({
        success: true,
        message: 'Category updated successfully',
        data: category,
      });
    } catch (error) {
      console.error('Error updating category:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update category',
      });
    }
  }

  /**
   * DELETE /api/categories/:id (Admin only)
   * Delete category (soft delete)
   */
  static async delete(req: Request, res: Response): Promise<void> {
    try {
      // Check if user is admin
      const user: any = (req as any).user;
      if (!user || user.role !== 'admin') {
        res.status(403).json({
          success: false,
          message: 'Only admins can delete categories',
        });
        return;
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);

      const success = await CategoryModel.delete(id);

      if (!success) {
        res.status(404).json({
          success: false,
          message: 'Category not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Category deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting category:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete category',
      });
    }
  }
}

export default CategoryController;
