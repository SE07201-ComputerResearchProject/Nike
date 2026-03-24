// routes/adminOutboxRoutes.ts
import express, { Request, Response, NextFunction } from 'express';
import { query, param, validationResult } from 'express-validator';
const { listOutbox, retryOutbox } = require('../controllers/adminOutboxController');
const { adminOnly } = require('../middleware/role');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const validate = (req: Request, res: Response, next: NextFunction): any => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

// Blanket auth + admin
router.use(authenticate, adminOnly);

router.get('/', [
  query('status').optional().isIn(['pending','in_progress','succeeded','failed']), 
  query('aggregateType').optional().isString(), 
  validate
], listOutbox);

router.post('/:id/retry', [
  param('id').isUUID(), 
  validate
], retryOutbox);

export = router;