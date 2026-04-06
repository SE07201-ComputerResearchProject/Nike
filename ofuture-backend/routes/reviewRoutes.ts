// routes/reviewRoutes.ts
// ─────────────────────────────────────────────
// Review routes — full RBAC on every write.
// ─────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';

const {
  createReview,
  getProductReviews,
  getReviewById,
  getMyReviews,
  editReview,
  deleteReview,
  hideReview,
  unhideReview,
  adminListAll,
} = require('../controllers/reviewController');

const { authenticate } = require('../middleware/auth');
const { authorizeRoles, adminOnly } = require('../middleware/role');
const { detectSuspiciousPayload } = require('../middleware/security');
const { validateCreateReview, validateUUIDParam, validatePaginationQuery } = require('../middleware/validate');

const router = express.Router();

// ── Rate limiter: 10 reviews per hour per IP ──
const reviewWriteLimiter = rateLimit({
  windowMs : 60 * 60 * 1000,
  max      : 10,
  message  : { success: false, message: 'Too many review submissions. Try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

// ── Reusable validation runner ────────────────
const validate = (req: Request, res: Response, next: NextFunction): any => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success : false,
      message : 'Validation failed.',
      errors  : errors.array().map((e: any) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

// ── Inline validators ──────────────────────────

const validateEditReview = [
  param('id').isUUID().withMessage('Review ID must be a valid UUID.'),
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5.')
    .toInt(),
  body('title')
    .optional()
    .trim()
    .isLength({ max: 150 }).withMessage('Title must not exceed 150 characters.')
    .escape(),
  body('body')
    .optional()
    .trim()
    .isLength({ max: 2000 }).withMessage('Review body must not exceed 2000 characters.')
    .escape(),
  validate,
];

const validateProductReviewsQuery = [
  param('productId').isUUID().withMessage('productId must be a valid UUID.'),
  query('sort')
    .optional()
    .isIn(['newest', 'oldest', 'highest', 'lowest'])
    .withMessage('sort must be one of: newest, oldest, highest, lowest.'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  validate,
];

const validateAdminListQuery = [
  query('isHidden').optional().isBoolean().withMessage('isHidden must be true or false.'),
  query('productId').optional().isUUID(),
  query('minRating').optional().isInt({ min: 1, max: 5 }).toInt(),
  query('maxRating').optional().isInt({ min: 1, max: 5 }).toInt(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  validate,
];

// ─────────────────────────────────────────────
// ADMIN ROUTES (declared first — before /:id)
// ─────────────────────────────────────────────

router.get(
  '/admin/all',
  authenticate,
  adminOnly,
  validateAdminListQuery,
  adminListAll
);

router.put(
  '/:id/hide',
  authenticate,
  adminOnly,
  validateUUIDParam('id'),
  hideReview
);

router.put(
  '/:id/unhide',
  authenticate,
  adminOnly,
  validateUUIDParam('id'),
  unhideReview
);

// ─────────────────────────────────────────────
// BUYER ROUTES
// ─────────────────────────────────────────────

router.post(
  '/',
  authenticate,
  authorizeRoles('buyer'),
  reviewWriteLimiter,
  detectSuspiciousPayload,
  validateCreateReview,
  createReview
);

router.get(
  '/my',
  authenticate,
  authorizeRoles('buyer', 'admin'),
  validatePaginationQuery,
  getMyReviews
);

router.put(
  '/:id',
  authenticate,
  authorizeRoles('buyer', 'admin'),
  reviewWriteLimiter,
  detectSuspiciousPayload,
  validateEditReview,
  editReview
);

router.delete(
  '/:id',
  authenticate,
  authorizeRoles('buyer', 'admin'),
  validateUUIDParam('id'),
  deleteReview
);

// ─────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────

router.get(
  '/:id',
  validateUUIDParam('id'),
  getReviewById
);

export = router;