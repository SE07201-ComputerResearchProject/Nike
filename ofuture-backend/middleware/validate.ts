// middleware/validate.ts
// ─────────────────────────────────────────────
// Input validation using express-validator.
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';

// ── Validation result handler ─────────────────
const handleValidation = (req: Request, res: Response, next: NextFunction): any => {
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

// ── Auth validators ───────────────────────────
const validateRegister = [
  body('email')
    .trim()
    .isEmail().withMessage('Must be a valid email address.')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email must not exceed 255 characters.'),

  body('username')
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('Username must be 3–30 characters.')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username may only contain letters, numbers, and underscores.'),

  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter.')
    .matches(/\d/).withMessage('Password must contain at least one number.')
    .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Password must contain at least one special character.'),

  body('fullName')
    .trim()
    .isLength({ min: 2, max: 150 }).withMessage('Full name must be 2–150 characters.')
    .escape(),

  body('role')
    .optional()
    .isIn(['buyer', 'seller']).withMessage('Role must be buyer or seller.'),

  body('phone')
    .optional()
    .isMobilePhone('any').withMessage('Must be a valid phone number.'),

  handleValidation,
];

const validateLogin = [
  body('email')
    .trim()
    .isEmail().withMessage('Must be a valid email address.')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required.'),

  handleValidation,
];

const validateRefreshToken = [
  body('refreshToken')
    .notEmpty().withMessage('Refresh token is required.'),
  handleValidation,
];

// ── Product validators ─────────────────────────
const validateCreateProduct = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 255 }).withMessage('Product name must be 3–255 characters.')
    .escape(),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 }).withMessage('Description must not exceed 5000 characters.'),

  body('category')
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Category must be 2–100 characters.')
    .escape(),

  body('price')
    .isFloat({ min: 0.01 }).withMessage('Price must be a positive number.')
    .toFloat(),

  body('stockQuantity')
    .optional()
    .isInt({ min: 0 }).withMessage('Stock must be a non-negative integer.')
    .toInt(),

  handleValidation,
];

// ── Order validators ───────────────────────────
const validateCreateOrder = [
  body('productId')
    .trim()
    .isUUID().withMessage('Must be a valid product ID.'),

  body('quantity')
    .isInt({ min: 1, max: 999 }).withMessage('Quantity must be between 1 and 999.')
    .toInt(),

  body('shippingAddress')
    .notEmpty().withMessage('Shipping address is required.'),

  body('shippingAddress.street')
    .trim()
    .notEmpty().withMessage('Street address is required.')
    .isLength({ max: 200 }).escape(),

  body('shippingAddress.city')
    .trim()
    .notEmpty().withMessage('City is required.')
    .isLength({ max: 100 }).escape(),

  body('shippingAddress.country')
    .trim()
    .notEmpty().withMessage('Country is required.')
    .isLength({ max: 100 }).escape(),

  body('shippingAddress.zip')
    .trim()
    .notEmpty().withMessage('ZIP / postal code is required.')
    .isLength({ max: 20 }).escape(),

  handleValidation,
];

// ── Review validators ──────────────────────────
const validateCreateReview = [
  body('orderId')
    .trim()
    .isUUID().withMessage('Must be a valid order ID.'),

  body('rating')
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5.')
    .toInt(),

  body('title')
    .optional()
    .trim()
    .isLength({ max: 150 }).escape(),

  body('body')
    .optional()
    .trim()
    .isLength({ max: 2000 }).escape(),

  handleValidation,
];

// ── MFA validators ─────────────────────────────

const validateMfaCode = [
  body('code')
    .trim()
    .notEmpty().withMessage('code is required.')
    .isLength({ min: 6, max: 10 }).withMessage('code must be 6–10 characters.'),
  handleValidation,
];

const validateMfaVerify = [
  body('mfaToken')
    .notEmpty().withMessage('mfaToken is required.'),
  body('code')
    .trim()
    .notEmpty().withMessage('code is required.')
    .isLength({ min: 6, max: 10 }).withMessage('code must be 6–10 characters.'),
  body('codeType')
    .optional()
    .isIn(['totp', 'backup']).withMessage('codeType must be "totp" or "backup".'),
  handleValidation,
];

const validateMfaDisable = [
  body('password')
    .notEmpty().withMessage('Current password is required.'),
  body('code')
    .trim()
    .notEmpty().withMessage('TOTP code is required.')
    .isLength({ min: 6, max: 6 }).withMessage('TOTP code must be exactly 6 digits.'),
  handleValidation,
];

// ── Param & Query validators ────────────────────
const validateUUIDParam = (paramName = 'id') => [
  param(paramName).isUUID().withMessage(`${paramName} must be a valid UUID.`),
  handleValidation,
];

const validatePaginationQuery = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  handleValidation,
];

export = {
  handleValidation,
  validateRegister,
  validateLogin,
  validateRefreshToken,
  validateCreateProduct,
  validateCreateOrder,
  validateCreateReview,
  validateMfaCode,
  validateMfaVerify,
  validateMfaDisable,
  validateUUIDParam,
  validatePaginationQuery,
};