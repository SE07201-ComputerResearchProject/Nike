// controllers/disputeController.ts
import { Request, Response } from 'express';
import { DisputeModel } from '../models/disputeModel';
import OrderModel from '../models/orderModel';
import { pool } from '../config/db';
import logger from '../utils/logger';

interface AuthRequest extends Request {
  user?: any;
}

// ─────────────────────────────────────────────
// 1. Create a dispute (Buyer)
// ─────────────────────────────────────────────
const createDispute = async (req: AuthRequest, res: Response): Promise<any> => {
  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { orderId, reason, evidenceUrl } = req.body;
    const buyerId = req.user.id;

    // Verify order exists and belongs to the buyer
    const order: any = await OrderModel.findById(orderId as string);
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.buyer_id !== buyerId) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: 'You can only dispute your own orders.' });
    }

    // Check if order is eligible for dispute (e.g., paid/shipped)
    if (order.status === 'completed' || order.status === 'cancelled') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Cannot dispute a completed or cancelled order.' });
    }

    // 1. Create the dispute record
    const disputeId = await DisputeModel.create({
      order_id: orderId as string,
      complainant_id: buyerId,
      reason: reason as string,
      evidence_url: evidenceUrl ? (evidenceUrl as string) : undefined // <-- Sửa dòng này
    }, conn);

    // 2. Freeze the funds in escrow_transactions
    await conn.execute(
      `UPDATE escrow_transactions SET status = 'frozen' WHERE order_id = ?`,
      [orderId as string]
    );

    // 3. Update order status to 'disputed'
    await conn.execute(
      `UPDATE orders SET status = 'disputed' WHERE id = ?`,
      [orderId as string]
    );

    await conn.commit();
    res.status(201).json({
      success: true,
      message: 'Dispute submitted successfully. Funds have been frozen pending admin review.',
      data: { disputeId }
    });
  } catch (error: any) {
    await conn.rollback();
    logger.error('createDispute error:', error);
    res.status(500).json({ success: false, message: 'System error while creating dispute.' });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// 2. Get my disputes (Buyer)
// ─────────────────────────────────────────────
const getMyDisputes = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    const disputes = await DisputeModel.findByUser(req.user.id, parseInt(limit as string), offset);
    res.status(200).json({ success: true, data: disputes });
  } catch (error: any) {
    logger.error('getMyDisputes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch your disputes.' });
  }
};

// ─────────────────────────────────────────────
// 3. Get all disputes (Admin)
// ─────────────────────────────────────────────
const getAllDisputes = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { status, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    const disputes = await DisputeModel.adminListAll(status as string, parseInt(limit as string), offset);
    res.status(200).json({ success: true, data: disputes });
  } catch (error: any) {
    logger.error('getAllDisputes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch disputes.' });
  }
};

// ─────────────────────────────────────────────
// 4. Resolve a dispute (Admin)
// ─────────────────────────────────────────────
const resolveDispute = async (req: AuthRequest, res: Response): Promise<any> => {
  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const disputeId = req.params.id as string;
    const { resolution } = req.body; // 'refund_buyer' or 'release_seller' or 'reject'

    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Dispute not found.' });
    }

    if (dispute.status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Dispute has already been resolved.' });
    }

    let newDisputeStatus = '';
    let newEscrowStatus = '';
    let newOrderStatus = '';

    if (resolution === 'refund_buyer') {
      newDisputeStatus = 'resolved_refunded';
      newEscrowStatus = 'refunded';
      newOrderStatus = 'cancelled'; // Order fails, buyer gets money back
    } else if (resolution === 'release_seller') {
      newDisputeStatus = 'resolved_released';
      newEscrowStatus = 'released';
      newOrderStatus = 'completed'; // Order succeeds, seller gets money
    } else if (resolution === 'reject') {
      newDisputeStatus = 'rejected';
      newEscrowStatus = 'held'; // Unfreeze, back to normal hold
      newOrderStatus = 'paid'; // Back to paid/shipped status
    } else {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Invalid resolution action.' });
    }

    // 1. Update Dispute status
    await DisputeModel.updateStatus(disputeId, newDisputeStatus, conn);

    // 2. Update Escrow status
    await conn.execute(
      `UPDATE escrow_transactions SET status = ? WHERE order_id = ?`,
      [newEscrowStatus, dispute.order_id]
    );

    // 3. Update Order status
    await conn.execute(
      `UPDATE orders SET status = ? WHERE id = ?`,
      [newOrderStatus, dispute.order_id]
    );

    await conn.commit();
    res.status(200).json({
      success: true,
      message: `Dispute resolved successfully. Action taken: ${resolution}.`
    });
  } catch (error: any) {
    await conn.rollback();
    logger.error('resolveDispute error:', error);
    res.status(500).json({ success: false, message: 'System error while resolving dispute.' });
  } finally {
    conn.release();
  }
};

export = {
  createDispute,
  getMyDisputes,
  getAllDisputes,
  resolveDispute
};