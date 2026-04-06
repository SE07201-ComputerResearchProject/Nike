// controllers/productController.ts
// ─────────────────────────────────────────────
// Product system controller.
//
// Seller actions:  create, update, softDelete, myProducts
// Buyer  actions:  list, search, getById
// Admin  actions:  all of the above + forceDelete, setStatus
// ─────────────────────────────────────────────

import { Request, Response } from 'express';
import ProductModel from '../models/productModel';
import { LogModel, LOG_EVENTS } from '../models/logModel';
const { generateSlug } = require('../utils/securityUtils');
import logger from '../utils/logger';
import { pool } from '../config/db';
import crypto from 'crypto';

interface ProductRequest extends Request {
  user?: any;
  meta?: any;
}

// ── Shared log context helper ─────────────────
const ctx = (req: ProductRequest) => ({
  userId    : req.user?.id ?? null,
  ipAddress : req.meta?.ip,
  userAgent : req.meta?.userAgent,
  endpoint  : req.originalUrl,
  method    : req.method,
});

// ─────────────────────────────────────────────
// POST /api/products
// Seller creates a new product listing.
// ─────────────────────────────────────────────
const createProduct = async (req: ProductRequest, res: Response): Promise<any> => {
  try {
    const {
      name, description, category,
      price, stockQuantity,
    } = req.body;

    // FIX: Read uploaded files from req.files (multer populates this)
    // Fall back to req.body.imageUrls for JSON requests (backward compat)
    let imageUrls: string[] = [];

    const uploadedFiles = req.files as Express.Multer.File[] | undefined;
    if (uploadedFiles && uploadedFiles.length > 0) {
      // Convert disk paths to URL paths served by /uploads static route
      imageUrls = uploadedFiles.map(f => `/uploads/${f.filename}`);
    } else if (req.body.imageUrls) {
      imageUrls = Array.isArray(req.body.imageUrls)
        ? req.body.imageUrls
        : [req.body.imageUrls];
    }

    const randomHex = crypto.randomBytes(3).toString('hex');
    const slug = `${generateSlug(name)}-${randomHex}`;

    await ProductModel.create({
      sellerId     : req.user.id,
      name,
      slug,
      description,
      category,
      price        : parseFloat(price),
      stockQuantity: stockQuantity ? parseInt(stockQuantity) : 0,
      imageUrls,
    });

    const product: any = await ProductModel.findBySlug(slug);

    await LogModel.write({
      ...ctx(req),
      eventType : LOG_EVENTS.PRODUCT_CREATED,
      severity  : 'info',
      message   : `Product created: "${name}" by seller ${req.user.id}`,
    });

    logger.info(`Product created: "${name}" id=${product.id}`);

    res.status(201).json({
      success : true,
      message : 'Product listed successfully.',
      data    : formatProduct(product),
    });

  } catch (err) {
    logger.error('createProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to create product.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/products
// Public — paginated product listing with filters.
// Query params: page, limit, category, minPrice,
//               maxPrice, search, sellerId
// ─────────────────────────────────────────────
const listProducts = async (req: ProductRequest, res: Response): Promise<any> => {
  try {
    const {
      page       = '1',
      limit      = '20',
      category,
      minPrice,
      maxPrice,
      search,
      sellerId,
    } = req.query;

    // Sanitise numeric params
    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const parsedMin   = minPrice ? parseFloat(minPrice as string) : undefined;
    const parsedMax   = maxPrice ? parseFloat(maxPrice as string) : undefined;

    const result = await ProductModel.list({
      page     : parsedPage,
      limit    : parsedLimit,
      category : category as string,
      minPrice : parsedMin,
      maxPrice : parsedMax,
      search   : search as string,
      sellerId : sellerId as string,
      status   : 'active',
    });

    res.status(200).json({
      success    : true,
      data       : result.rows.map(formatProductSummary),
      pagination : {
        page       : parsedPage,
        limit      : parsedLimit,
        total      : result.total,
        totalPages : Math.ceil(result.total / parsedLimit),
      },
    });

  } catch (err) {
    logger.error('listProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/products/:id
// Public — full product detail including seller info.
// ─────────────────────────────────────────────
const getProductById = async (req: ProductRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const product = await ProductModel.findById(id);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    res.status(200).json({
      success : true,
      data    : formatProduct(product),
    });

  } catch (err) {
    logger.error('getProductById error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch product.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/products/my
// Seller — lists their own products (all statuses).
// ─────────────────────────────────────────────
const getMyProducts = async (req: ProductRequest, res: Response): Promise<any> => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

    const result = await ProductModel.list({
      page     : parsedPage,
      limit    : parsedLimit,
      sellerId : req.user.id,
      status   : (status as string) ?? 'active',
    });

    res.status(200).json({
      success    : true,
      data       : result.rows.map(formatProductSummary),
      pagination : {
        page       : parsedPage,
        limit      : parsedLimit,
        total      : result.total,
        totalPages : Math.ceil(result.total / parsedLimit),
      },
    });

  } catch (err) {
    logger.error('getMyProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch your products.' });
  }
};

// ─────────────────────────────────────────────
// PUT /api/products/:id
// Seller updates their own product.
// requireOwnerOrAdmin guard runs before this handler,
// so by the time we arrive here ownership is confirmed.
// ─────────────────────────────────────────────
const updateProduct = async (req: ProductRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const {
      name, description, category,
      price, stockQuantity, status, // Bỏ imageUrls ra khỏi req.body trực tiếp
    } = req.body;

    // --- BẮT ĐẦU ĐOẠN CODE THÊM MỚI ĐỂ XỬ LÝ ẢNH ---
    let imageUrls: string[] | undefined = undefined; // Mặc định là undefined để DB không ghi đè nếu khách không upload ảnh mới

    const uploadedFiles = req.files as Express.Multer.File[] | undefined;
    if (uploadedFiles && uploadedFiles.length > 0) {
      imageUrls = uploadedFiles.map(f => `/uploads/${f.filename}`);
    } else if (req.body.imageUrls) {
      imageUrls = Array.isArray(req.body.imageUrls)
        ? req.body.imageUrls
        : [req.body.imageUrls];
    }
    // --- KẾT THÚC ĐOẠN XỬ LÝ ẢNH ---

    // Admin can set any status; seller can only toggle active/inactive
    const allowedStatuses = req.user.role === 'admin'
      ? ['active', 'inactive', 'deleted']
      : ['active', 'inactive'];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success : false,
        message : `Invalid status. Allowed: ${allowedStatuses.join(', ')}.`,
      });
    }

    const sellerIdFilter = req.user.role === 'admin' ? undefined : req.user.id;

    const result: any = await ProductModel.update(
      id,
      sellerIdFilter,
      { 
        name, 
        description, 
        category, 
        price,
        stock_quantity: stockQuantity, 
        image_urls: imageUrls, // Sẽ update ảnh mới nếu có
        status 
      }
    );

    // FIX LOGIC DB: Nếu affectedRows = 0 có thể do người dùng không sửa gì cả, không hẳn là lỗi
    // Ta lấy product ra kiểm tra luôn xem nó có tồn tại không
    const updated = await ProductModel.findById(id);
    
    if (!updated) {
      return res.status(404).json({
        success : false,
        message : 'Product not found or you do not own it.',
      });
    }

    res.status(200).json({
      success : true,
      message : 'Product updated successfully.',
      data    : formatProduct(updated),
    });

  } catch (err) {
    logger.error('updateProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
};

// ─────────────────────────────────────────────
// DELETE /api/products/:id
// Seller soft-deletes their own product.
// Admin can hard-delete (status = 'deleted').
// ─────────────────────────────────────────────
const deleteProduct = async (req: ProductRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;

    const product: any = await ProductModel.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const result: any = await ProductModel.softDelete(
      id,
      req.user.role === 'admin' ? product.seller_id : req.user.id
    );

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({
        success : false,
        message : 'Product not found or you do not own it.',
      });
    }

    await LogModel.write({
      ...ctx(req),
      eventType : LOG_EVENTS.PRODUCT_DELETED,
      severity  : 'warn',
      message   : `Product soft-deleted: id=${id} name="${product.name}"`,
    });

    res.status(200).json({
      success : true,
      message : 'Product removed from listing.',
    });

  } catch (err) {
    logger.error('deleteProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/products/search?q=...
// Public full-text search using MySQL FULLTEXT index.
// ─────────────────────────────────────────────
const searchProducts = async (req: ProductRequest, res: Response): Promise<any> => {
  try {
    const { q, page = '1', limit = '20', category, minPrice, maxPrice } = req.query;
    
    const qStr = q as string;
    if (!qStr || qStr.trim().length < 2) {
      return res.status(400).json({
        success : false,
        message : 'Search query must be at least 2 characters.',
      });
    }

    const parsedPage  = Math.max(1, parseInt(page as string)  || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

    const result = await ProductModel.list({
      page     : parsedPage,
      limit    : parsedLimit,
      search   : qStr.trim(),
      category : category as string,
      minPrice : minPrice ? parseFloat(minPrice as string) : undefined,
      maxPrice : maxPrice ? parseFloat(maxPrice as string) : undefined,
      status   : 'active',
    });

    res.status(200).json({
      success    : true,
      query      : qStr.trim(),
      data       : result.rows.map(formatProductSummary),
      pagination : {
        page       : parsedPage,
        limit      : parsedLimit,
        total      : result.total,
        totalPages : Math.ceil(result.total / parsedLimit),
      },
    });

  } catch (err) {
    logger.error('searchProducts error:', err);
    res.status(500).json({ success: false, message: 'Search failed.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/products/categories
// Public — returns distinct categories currently
// in use, for building filter UIs.
// ─────────────────────────────────────────────
const getCategories = async (_req: Request, res: Response): Promise<any> => {
  try {
    const [rows]: any = await pool.execute(
      `SELECT category, COUNT(*) AS product_count
       FROM products
       WHERE status = 'active'
       GROUP BY category
       ORDER BY product_count DESC`
    );

    res.status(200).json({
      success : true,
      data    : rows,
    });

  } catch (err) {
    logger.error('getCategories error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch categories.' });
  }
};

// ─────────────────────────────────────────────
// Admin: PUT /api/products/:id/status
// Admin-only status override (e.g. suspend a listing).
// ─────────────────────────────────────────────
const adminSetStatus = async (req: ProductRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    if (!['active', 'inactive', 'deleted'].includes(status)) {
      return res.status(400).json({
        success : false,
        message : 'status must be one of: active, inactive, deleted.',
      });
    }

    const product: any = await ProductModel.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    await ProductModel.update(id, product.seller_id, { status });

    await LogModel.write({
      ...ctx(req),
      eventType : LOG_EVENTS.PRODUCT_DELETED,
      severity  : 'warn',
      message   : `Admin set product id=${id} status → "${status}"`,
    });

    res.status(200).json({
      success : true,
      message : `Product status updated to "${status}".`,
    });

  } catch (err) {
    logger.error('adminSetStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update product status.' });
  }
};

// ─────────────────────────────────────────────
// Private helpers — shape DB rows into clean API objects
// ─────────────────────────────────────────────

/** Full detail response (single product view) */
const formatProduct = (p: any) => ({
  id            : p.id,
  name          : p.name,
  slug          : p.slug,
  description   : p.description,
  category      : p.category,
  price         : parseFloat(p.price),
  stockQuantity : p.stock_quantity,
  imageUrls     : safeParseJson(p.image_urls, []),
  status        : p.status,
  avgRating     : parseFloat(p.avg_rating ?? 0),
  reviewCount   : p.review_count ?? 0,
  seller        : {
    id       : p.seller_id,
    username : p.seller_username,
    name     : p.seller_name,
  },
  createdAt : p.created_at,
  updatedAt : p.updated_at,
});

/** Compact summary response (listing / search results) */
const formatProductSummary = (p: any) => ({
  id            : p.id,
  name          : p.name,
  slug          : p.slug,
  category      : p.category,
  price         : parseFloat(p.price),
  stockQuantity : p.stock_quantity,
  imageUrls     : safeParseJson(p.image_urls, []),
  avgRating     : parseFloat(p.avg_rating ?? 0),
  reviewCount   : p.review_count ?? 0,
  sellerUsername: p.seller_username,
  createdAt     : p.created_at,
});

/** Safely parse JSON stored as string in MySQL */
const safeParseJson = (value: any, fallback: any = null) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); }
  catch { return fallback; }
};

export = {
  createProduct,
  listProducts,
  getProductById,
  getMyProducts,
  updateProduct,
  deleteProduct,
  searchProducts,
  getCategories,
  adminSetStatus,
};