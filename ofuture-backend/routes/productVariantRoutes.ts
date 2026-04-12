import { Router } from 'express';
import ProductVariantController from '../controllers/productVariantController';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * Public routes
 */
// Get all variants for a product
router.get('/product/:productId', ProductVariantController.getByProduct);

// Get variants grouped by attribute
router.get('/product/:productId/grouped', ProductVariantController.getGroupedByProduct);

// Get available variants (stock > 0)
router.get('/product/:productId/available', ProductVariantController.getAvailableByProduct);

// Get variant by ID
router.get('/:id', ProductVariantController.getById);

// Get variant by SKU
router.get('/sku/:sku', ProductVariantController.getBySku);

/**
 * Seller routes (authenticated)
 */
// Create variant for a product
router.post('/product/:productId', authenticate, ProductVariantController.create);

// Update variant
router.put('/:id', authenticate, ProductVariantController.update);

// Delete variant
router.delete('/:id', authenticate, ProductVariantController.delete);

export default router;
