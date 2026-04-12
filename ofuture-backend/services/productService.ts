import ProductModel from '../models/productModel';
import ProductVariantModel from '../models/productVariantModel';

/**
 * ProductService handles business logic for products including:
 * - Wholesale pricing calculations
 * - Variant management
 * - Stock calculations
 */
class ProductService {
  /**
   * Calculate price based on quantity and wholesale pricing
   * Returns the effective unit price based on tiered wholesale pricing
   */
  static calculatePrice(
    basePrice: number,
    wholesalePrice: number | null | undefined,
    quantity: number
  ): {
    unitPrice: number;
    totalPrice: number;
    discount: number;
  } {
    // If no wholesale pricing, use base price
    if (!wholesalePrice) {
      return {
        unitPrice: basePrice,
        totalPrice: basePrice * quantity,
        discount: 0,
      };
    }

    // Apply wholesale pricing if quantity meets minimum
    const unitPrice = quantity >= 10 ? wholesalePrice : basePrice;
    const totalPrice = unitPrice * quantity;
    const discount = basePrice > wholesalePrice ? (basePrice - wholesalePrice) * quantity : 0;

    return {
      unitPrice,
      totalPrice,
      discount,
    };
  }

  /**
   * Get product with variants and pricing details
   */
  static async getProductWithVariants(productId: string) {
    const product = await ProductModel.findById(productId);

    if (!product) {
      return null;
    }

    // Get all variants if product has variants
    const variants = await ProductVariantModel.getGroupedByProduct(productId);

    return {
      ...product,
      variants,
      hasVariants: variants.length > 0,
    };
  }

  /**
   * Calculate total stock for product (including variants)
   */
  static async getAvailableStock(productId: string): Promise<number> {
    const product = await ProductModel.findById(productId);

    if (!product) {
      return 0;
    }

    // If product has variants, sum their stock; otherwise use product stock
    const variants = await ProductVariantModel.getByProductId(productId);

    if (variants.length > 0) {
      return variants.reduce((sum, v) => sum + v.stock_quantity, 0);
    }

    return product.stock_quantity || 0;
  }

  /**
   * Check if product can fulfill order with given quantity and variant
   */
  static async canFulfillOrder(
    productId: string,
    quantity: number,
    variantId?: string
  ): Promise<{
    canFulfill: boolean;
    availableStock: number;
    message?: string;
  }> {
    const product = await ProductModel.findById(productId);

    if (!product || product.status === 'deleted') {
      return {
        canFulfill: false,
        availableStock: 0,
        message: 'Product not found',
      };
    }

    if (product.status === 'inactive') {
      return {
        canFulfill: false,
        availableStock: 0,
        message: 'Product is inactive',
      };
    }

    // If variant is specified, check variant stock
    if (variantId) {
      const variant = await ProductVariantModel.getById(variantId);

      if (!variant || variant.product_id !== productId) {
        return {
          canFulfill: false,
          availableStock: 0,
          message: 'Variant not found',
        };
      }

      if (variant.is_active === 0) {
        return {
          canFulfill: false,
          availableStock: variant.stock_quantity,
          message: 'Variant is unavailable',
        };
      }

      const canFulfill = variant.stock_quantity >= quantity;

      return {
        canFulfill,
        availableStock: variant.stock_quantity,
        message: !canFulfill ? `Only ${variant.stock_quantity} items available` : undefined,
      };
    }

    // Check product or variants stock
    const availableStock = await this.getAvailableStock(productId);
    const canFulfill = availableStock >= quantity;

    return {
      canFulfill,
      availableStock,
      message: !canFulfill ? `Only ${availableStock} items available` : undefined,
    };
  }

  /**
   * Apply price adjustments for a variant
   */
  static async getPriceWithVariant(
    productId: string,
    variantId: string,
    quantity: number
  ): Promise<{
    basePrice: number;
    priceAdjustment: number;
    finalUnitPrice: number;
    totalPrice: number;
  } | null> {
    const product = await ProductModel.findById(productId);
    const variant = await ProductVariantModel.getById(variantId);

    if (!product || !variant || variant.product_id !== productId) {
      return null;
    }

    const basePrice = product.price;
    const priceAdjustment = variant.price_adjustment || 0;
    const finalUnitPrice = basePrice + priceAdjustment;
    const totalPrice = finalUnitPrice * quantity;

    return {
      basePrice,
      priceAdjustment,
      finalUnitPrice,
      totalPrice,
    };
  }

  /**
   * Search products by name, category, or price range
   */
  static async searchProducts(query: {
    search?: string;
    category?: string;
    categoryId?: string;
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    sellerId?: string;
    page?: number;
    limit?: number;
  }) {
    const {
      search,
      category,
      categoryId,
      minPrice,
      maxPrice,
      minRating,
      sellerId,
      page = 1,
      limit = 20,
    } = query;

    const offset = (page - 1) * limit;
    const conditions: string[] = ["p.status = 'active'"];
    const params: any[] = [];

    if (search) {
      conditions.push('MATCH(p.name, p.description, p.category) AGAINST(? IN BOOLEAN MODE)');
      params.push(`${search}*`);
    }

    if (category) {
      conditions.push('p.category = ?');
      params.push(category);
    }

    if (categoryId) {
      conditions.push('p.category_id = ?');
      params.push(categoryId);
    }

    if (minPrice !== undefined) {
      conditions.push('p.price >= ?');
      params.push(minPrice);
    }

    if (maxPrice !== undefined) {
      conditions.push('p.price <= ?');
      params.push(maxPrice);
    }

    if (minRating !== undefined) {
      conditions.push('p.avg_rating >= ?');
      params.push(minRating);
    }

    if (sellerId) {
      conditions.push('p.seller_id = ?');
      params.push(sellerId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [rows]: any = await (
      await import('../config/db')
    ).pool.execute(
      `SELECT p.*, u.username AS seller_username, u.full_name AS seller_name
       FROM products p
       JOIN users u ON u.id = p.seller_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]]: any = await (
      await import('../config/db')
    ).pool.execute(`SELECT COUNT(*) AS total FROM products p ${where}`, params);

    return {
      items: rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }
}

export default ProductService;
