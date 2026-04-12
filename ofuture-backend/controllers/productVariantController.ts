import { Request, Response } from 'express';
import ProductVariantModel from '../models/productVariantModel';
import ProductModel from '../models/productModel';

/**
 * ProductVariantController handles product variant-related HTTP requests
 */
class ProductVariantController {
  /**
   * GET /api/products/:productId/variants
   * Get all variants for a product
   */
  static async getByProduct(req: Request, res: Response): Promise<void> {
    try {
      const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : String(req.params.productId);

      // Verify product exists
      const product = await ProductModel.findById(productId);
      if (!product) {
        res.status(404).json({
          success: false,
          message: 'Product not found',
        });
        return;
      }

      const variants = await ProductVariantModel.getByProductId(productId);

      res.json({
        success: true,
        data: variants,
      });
    } catch (error) {
      console.error('Error fetching variants:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch variants',
      });
    }
  }

  /**
   * GET /api/products/:productId/variants/grouped
   * Get variants grouped by attribute name
   */
  static async getGroupedByProduct(req: Request, res: Response): Promise<void> {
    try {
      const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : String(req.params.productId);

      // Verify product exists
      const product = await ProductModel.findById(productId);
      if (!product) {
        res.status(404).json({
          success: false,
          message: 'Product not found',
        });
        return;
      }

      const variants = await ProductVariantModel.getGroupedByProduct(productId);

      res.json({
        success: true,
        data: variants,
      });
    } catch (error) {
      console.error('Error fetching grouped variants:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch variants',
      });
    }
  }

  /**
   * GET /api/products/:productId/variants/available
   * Get available variants (stock > 0)
   */
  static async getAvailableByProduct(req: Request, res: Response): Promise<void> {
    try {
      const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : String(req.params.productId);

      // Verify product exists
      const product = await ProductModel.findById(productId);
      if (!product) {
        res.status(404).json({
          success: false,
          message: 'Product not found',
        });
        return;
      }

      const variants = await ProductVariantModel.getAvailableByProduct(productId);

      res.json({
        success: true,
        data: variants,
      });
    } catch (error) {
      console.error('Error fetching available variants:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch variants',
      });
    }
  }

  /**
   * GET /api/variants/:id
   * Get variant by ID
   */
  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
      const variant = await ProductVariantModel.getById(id);

      if (!variant) {
        res.status(404).json({
          success: false,
          message: 'Variant not found',
        });
        return;
      }

      res.json({
        success: true,
        data: variant,
      });
    } catch (error) {
      console.error('Error fetching variant:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch variant',
      });
    }
  }

  /**
   * GET /api/variants/sku/:sku
   * Get variant by SKU
   */
  static async getBySku(req: Request, res: Response): Promise<void> {
    try {
      const sku = Array.isArray(req.params.sku) ? req.params.sku[0] : String(req.params.sku);
      const variant = await ProductVariantModel.getBySku(sku);

      if (!variant) {
        res.status(404).json({
          success: false,
          message: 'Variant not found',
        });
        return;
      }

      res.json({
        success: true,
        data: variant,
      });
    } catch (error) {
      console.error('Error fetching variant:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch variant',
      });
    }
  }

  /**
   * POST /api/products/:productId/variants
   * Create new variant (seller only)
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const user: any = (req as any).user;
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : String(req.params.productId);
      const { attribute_name, attribute_value, sku, stock_quantity, price_adjustment } = req.body;

      // Verify product exists and belongs to seller
      const product = await ProductModel.findById(productId);
      if (!product) {
        res.status(404).json({
          success: false,
          message: 'Product not found',
        });
        return;
      }

      if (product.seller_id !== user.id) {
        res.status(403).json({
          success: false,
          message: 'You can only add variants to your own products',
        });
        return;
      }

      // Validate required fields
      if (!attribute_name || !attribute_value || !sku || stock_quantity === undefined) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields: attribute_name, attribute_value, sku, stock_quantity',
        });
        return;
      }

      // Check SKU uniqueness
      const existingSku = await ProductVariantModel.getBySku(sku);
      if (existingSku) {
        res.status(400).json({
          success: false,
          message: 'SKU already exists',
        });
        return;
      }

      const id = await ProductVariantModel.create({
        product_id: productId,
        attribute_name,
        attribute_value,
        sku,
        stock_quantity,
        price_adjustment,
      });

      const variant = await ProductVariantModel.getById(id);

      res.status(201).json({
        success: true,
        message: 'Variant created successfully',
        data: variant,
      });
    } catch (error) {
      console.error('Error creating variant:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create variant',
      });
    }
  }

  /**
   * PUT /api/variants/:id
   * Update variant (seller only)
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const user: any = (req as any).user;
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
      const variant = await ProductVariantModel.getById(id);

      if (!variant) {
        res.status(404).json({
          success: false,
          message: 'Variant not found',
        });
        return;
      }

      // Verify product belongs to seller
      const product = await ProductModel.findById(variant.product_id);
      if (!product || product.seller_id !== user.id) {
        res.status(403).json({
          success: false,
          message: 'You can only edit variants of your own products',
        });
        return;
      }

      // Check SKU uniqueness if changing SKU
      if (req.body.sku && req.body.sku !== variant.sku) {
        const existingSku = await ProductVariantModel.getBySku(req.body.sku);
        if (existingSku) {
          res.status(400).json({
            success: false,
            message: 'SKU already exists',
          });
          return;
        }
      }

      const success = await ProductVariantModel.update(id, req.body);

      if (!success) {
        res.status(404).json({
          success: false,
          message: 'Variant not found',
        });
        return;
      }

      const updated = await ProductVariantModel.getById(id);

      res.json({
        success: true,
        message: 'Variant updated successfully',
        data: updated,
      });
    } catch (error) {
      console.error('Error updating variant:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update variant',
      });
    }
  }

  /**
   * DELETE /api/variants/:id
   * Delete variant (seller only)
   */
  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const user: any = (req as any).user;
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
      const variant = await ProductVariantModel.getById(id);

      if (!variant) {
        res.status(404).json({
          success: false,
          message: 'Variant not found',
        });
        return;
      }

      // Verify product belongs to seller
      const product = await ProductModel.findById(variant.product_id);
      if (!product || product.seller_id !== user.id) {
        res.status(403).json({
          success: false,
          message: 'You can only delete variants of your own products',
        });
        return;
      }

      const success = await ProductVariantModel.delete(id);

      if (!success) {
        res.status(404).json({
          success: false,
          message: 'Variant not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Variant deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting variant:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete variant',
      });
    }
  }
}

export default ProductVariantController;
