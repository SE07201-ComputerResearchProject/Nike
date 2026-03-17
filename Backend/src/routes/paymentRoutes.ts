import express, { Request, Response } from 'express';
import { PaymentService } from '../services/PaymentService.js';
import { MoMoCallbackData } from '../services/MoMoClient.js';

const router = express.Router();
const paymentService = new PaymentService();

/**
 * POST /api/payments/momo - Create MoMo payment
 */
router.post('/momo', async (req: Request, res: Response) => {
  try {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orderId and amount are required',
        },
      });
    }

    const result = await paymentService.createMoMoPayment(orderId, amount);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Create MoMo payment error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PAYMENT_GATEWAY_ERROR',
        message: error.message || 'Failed to create MoMo payment',
      },
    });
  }
});

/**
 * POST /api/payments/momo/callback - Handle MoMo callback
 */
router.post('/momo/callback', async (req: Request, res: Response) => {
  try {
    const callbackData: MoMoCallbackData = req.body;

    await paymentService.handleMoMoCallback(callbackData);

    res.json({
      success: true,
      message: 'Callback processed successfully',
    });
  } catch (error: any) {
    console.error('MoMo callback error:', error);
    res.status(401).json({
      success: false,
      error: {
        code: 'SIGNATURE_INVALID',
        message: error.message || 'Invalid callback',
      },
    });
  }
});

/**
 * POST /api/payments/qr - Create QR payment
 */
router.post('/qr', async (req: Request, res: Response) => {
  try {
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orderId and amount are required',
        },
      });
    }

    const result = await paymentService.createQRPayment(orderId, amount);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Create QR payment error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to create QR payment',
      },
    });
  }
});

/**
 * GET /api/payments/:id/status - Check payment status
 */
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const status = await paymentService.checkPaymentStatus(req.params.id);

    res.json({
      success: true,
      data: { status },
    });
  } catch (error: any) {
    console.error('Check payment status error:', error);
    res.status(404).json({
      success: false,
      error: {
        code: 'PAYMENT_NOT_FOUND',
        message: error.message || 'Payment not found',
      },
    });
  }
});

/**
 * POST /api/payments/qr/:id/confirm - Manually confirm QR payment (for testing)
 */
router.post('/qr/:id/confirm', async (req: Request, res: Response) => {
  try {
    const { success } = req.body;

    await paymentService.updateQRPaymentStatus(req.params.id, success !== false);

    res.json({
      success: true,
      message: 'Payment status updated',
    });
  } catch (error: any) {
    console.error('Update QR payment status error:', error);
    res.status(400).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to update payment status',
      },
    });
  }
});

export default router;
