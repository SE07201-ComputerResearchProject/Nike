import express, { Request, Response } from 'express';
import { OrderService } from '../services/OrderService.js';

const router = express.Router();
const orderService = new OrderService();

/**
 * POST /api/orders - Create new order
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json({
      success: true,
      data: order,
    });
  } catch (error: any) {
    console.error('Create order error:', error);
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message || 'Failed to create order',
      },
    });
  }
});

/**
 * GET /api/orders/:id - Get order by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const order = await orderService.getOrderById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Order not found',
        },
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error: any) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get order',
      },
    });
  }
});

export default router;
