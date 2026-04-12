import { Router } from 'express';
const _catModule = require('../controllers/categoryController');
const CategoryController = (_catModule && _catModule.default) ? _catModule.default : _catModule;
console.log('CategoryController in categoryRoutes:', CategoryController && typeof CategoryController === 'object' ? Object.keys(CategoryController) : typeof CategoryController);
import { authenticate } from '../middleware/auth';

// Simple admin guard (inlined to avoid missing export issues)
const requireAdmin = (req, res, next) => {
  const user = (req as any).user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

const router = Router();

/**
 * Public routes
 */
// Get all categories (tree structure)
const getAllHandler = typeof CategoryController.getAll === 'function' ? CategoryController.getAll : (_req, res) => res.status(501).json({ success: false, message: 'getAll not implemented' });
router.get('/', getAllHandler);

// Get all categories (flat list)
const getAllFlatHandler = typeof CategoryController.getAllFlat === 'function' ? CategoryController.getAllFlat : (_req, res) => res.status(501).json({ success: false, message: 'getAllFlat not implemented' });
router.get('/flat', getAllFlatHandler);

// Get category by ID
const getByIdHandler = typeof CategoryController.getById === 'function' ? CategoryController.getById : (_req, res) => res.status(501).json({ success: false, message: 'getById not implemented' });
router.get('/:id', getByIdHandler);

// Get category by slug
const getBySlugHandler = typeof CategoryController.getBySlug === 'function' ? CategoryController.getBySlug : (_req, res) => res.status(501).json({ success: false, message: 'getBySlug not implemented' });
router.get('/slug/:slug', getBySlugHandler);

// Get subcategories
const getChildrenHandler = typeof CategoryController.getChildren === 'function' ? CategoryController.getChildren : (_req, res) => res.status(501).json({ success: false, message: 'getChildren not implemented' });
router.get('/:id/children', getChildrenHandler);

/**
 * Admin routes
 */
// Create category
const createHandler = typeof CategoryController.create === 'function' ? CategoryController.create : (req, res) => res.status(501).json({ success: false, message: 'create not implemented' });
router.post('/', authenticate, requireAdmin, createHandler);

// Update category
const updateHandler = typeof CategoryController.update === 'function' ? CategoryController.update : (req, res) => res.status(501).json({ success: false, message: 'update not implemented' });
router.put('/:id', authenticate, requireAdmin, updateHandler);

// Delete category
const deleteHandler = typeof CategoryController.delete === 'function' ? CategoryController.delete : (req, res) => res.status(501).json({ success: false, message: 'delete not implemented' });
router.delete('/:id', authenticate, requireAdmin, deleteHandler);

export default router;
