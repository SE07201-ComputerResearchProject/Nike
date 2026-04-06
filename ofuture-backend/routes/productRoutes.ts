// routes/productRoutes.ts
// ─────────────────────────────────────────────
// Product routes with full RBAC enforcement.
// ─────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { body, query, param, validationResult } from 'express-validator';
import ProductModel from '../models/productModel';
import { uploadImages } from '../middleware/upload';

const {
  createProduct,
  listProducts,
  getProductById,
  getMyProducts,
  updateProduct,
  deleteProduct,
  searchProducts,
  getCategories,
  adminSetStatus,
} = require('../controllers/productController');

const { authenticate } = require('../middleware/auth');
const { authorizeRoles, requireOwnerOrAdmin, adminOnly } = require('../middleware/role');
const { detectSuspiciousPayload } = require('../middleware/security');
const {
  validateCreateProduct,
  validateUUIDParam,
  validatePaginationQuery,
} = require('../middleware/validate');

const { getProductReviews } = require('../controllers/reviewController');

const router = express.Router();

// ── Rate limiter for write operations ─────────
const writeLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,  // 15 min
  max      : 30,
  message  : { success: false, message: 'Too many write requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

// ── Inline update validator ────────────────────
const validateUpdateProduct = [
  body('name').optional().trim().isLength({ min: 3, max: 255 }).escape(),
  body('description').optional().trim().isLength({ max: 5000 }),
  body('category').optional().trim().isLength({ min: 2, max: 100 }).escape(),
  body('price').optional().isFloat({ min: 0.01 }).toFloat(),
  body('stockQuantity').optional().isInt({ min: 0 }).toInt(),
  body('status').optional().isIn(['active', 'inactive']),
  (req: Request, res: Response, next: NextFunction): any => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success : false,
        message : 'Validation failed.',
        errors  : errors.array().map((e: any) => ({ field: e.path, message: e.msg })),
      });
    }
    next();
  },
];

// ── Search query validator ─────────────────────
const validateSearchQuery = [
  query('q').trim().isLength({ min: 2, max: 100 }).withMessage('Query must be 2–100 characters.'),
  query('minPrice').optional().isFloat({ min: 0 }).toFloat(),
  query('maxPrice').optional().isFloat({ min: 0 }).toFloat(),
  (req: Request, res: Response, next: NextFunction): any => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        errors : errors.array().map((e: any) => ({ field: e.path, message: e.msg })),
      });
    }
    next();
  },
];

// ─────────────────────────────────────────────
// PUBLIC ROUTES  (no authentication required)
// ─────────────────────────────────────────────

router.get('/', validatePaginationQuery, listProducts);

router.get('/search', validateSearchQuery, searchProducts);

router.get('/categories', getCategories);

router.get('/:id', validateUUIDParam('id'), getProductById);

// ─────────────────────────────────────────────
// SELLER ROUTES  (authenticate + seller role)
// ─────────────────────────────────────────────

router.get(
  '/seller/my',
  authenticate,
  authorizeRoles('seller', 'admin'),
  validatePaginationQuery,
  getMyProducts
);

router.post(
  '/',
  authenticate,
  authorizeRoles('seller', 'admin'),
  writeLimiter,
  uploadImages.array('images', 5),
  detectSuspiciousPayload,
  validateCreateProduct,
  createProduct
);

router.put(
  '/:id',
  authenticate,
  authorizeRoles('seller', 'admin'),
  validateUUIDParam('id'),
  requireOwnerOrAdmin(async (req: any) => {
    const product: any = await ProductModel.findById(req.params.id);
    return product?.seller_id ?? null;
  }),
  writeLimiter,
  uploadImages.array('images', 5),
  detectSuspiciousPayload,
  validateUpdateProduct,
  updateProduct
);

router.delete(
  '/:id',
  authenticate,
  authorizeRoles('seller', 'admin'),
  validateUUIDParam('id'),
  requireOwnerOrAdmin(async (req: any) => {
    const product: any = await ProductModel.findById(req.params.id);
    return product?.seller_id ?? null;
  }),
  writeLimiter,
  deleteProduct
);

// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────

router.put(
  '/:id/status',
  authenticate,
  adminOnly,
  validateUUIDParam('id'),
  body('status').isIn(['active', 'inactive', 'deleted'])
    .withMessage('status must be active, inactive, or deleted.'),
  adminSetStatus
);

// ─────────────────────────────────────────────
// GET /api/products/:productId/reviews
// ─────────────────────────────────────────────

const validateProdReviewsQuery = [
  param('productId').isUUID().withMessage('productId must be a valid UUID.'),
  query('sort').optional().isIn(['newest','oldest','highest','lowest']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  (req: Request, res: Response, next: NextFunction): any => {
    const e = validationResult(req);
    if (!e.isEmpty()) return res.status(422).json({ success: false,
      errors: e.array().map((x: any) => ({ field: x.path, message: x.msg })) });
    next();
  },
];

export = router;