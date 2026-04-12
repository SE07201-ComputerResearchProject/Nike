// controllers/disputeController.ts
import { Request, Response } from 'express';
import { DisputeModel } from '../models/disputeModel';
import OrderModel from '../models/orderModel';
import { pool } from '../config/db';
import logger from '../utils/logger';
import escrowService from '../services/escrowService';
import NotificationService from '../services/notificationService';

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

    const { orderId, reason, evidenceUrls } = req.body;
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
      evidence_urls: evidenceUrls ? (evidenceUrls as string[]) : undefined
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
  try {
    const disputeId = req.params.id as string;
    const { resolution, reason = 'Admin resolved dispute' } = req.body; 

    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) {
      return res.status(404).json({ success: false, message: 'Dispute not found.' });
    }

    if (dispute.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Dispute has already been resolved.' });
    }

    // Trường hợp 1: Admin bác bỏ khiếu nại (Không dính tới tiền bạc thực tế, chỉ đổi trạng thái DB)
    if (resolution === 'reject') {
      const conn: any = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await DisputeModel.updateStatus(disputeId, 'rejected', conn);
        // Trả escrow về trạng thái held, order về trạng thái paid (hoặc shipped)
        await conn.execute(`UPDATE escrow_transactions SET status = 'held' WHERE order_id = ?`, [dispute.order_id]);
        await conn.execute(`UPDATE orders SET status = 'shipped' WHERE id = ?`, [dispute.order_id]);
        await conn.commit();
        return res.status(200).json({ success: true, message: 'Dispute rejected. Funds returned to held status.' });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } 
    
    // Trường hợp 2: Bồi thường hoặc Giải ngân (Liên quan đến tiền bạc -> Đẩy qua EscrowService + Outbox)
    else if (resolution === 'refund_buyer' || resolution === 'release_seller') {
      const action = resolution === 'refund_buyer' ? 'refund' : 'release';
      
      const result = await escrowService.resolveDispute({
        orderId: dispute.order_id,
        disputeId: disputeId,
        adminId: req.user.id,
        resolution: action,
        reason: reason,
        ipAddress: req.ip
      });

      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.status(200).json(result);
    } 
    
    else {
      return res.status(400).json({ success: false, message: 'Invalid resolution action.' });
    }

  } catch (error: any) {
    logger.error('resolveDispute error:', error);
    res.status(500).json({ success: false, message: 'System error while resolving dispute.' });
  }
};

// ─────────────────────────────────────────────
// 5. Submit Evidence (Seller/Buyer nộp bằng chứng)
// ─────────────────────────────────────────────
const submitEvidence = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const disputeId = req.params.id as string;
    const { evidenceUrl, description } = req.body;
    const userId = req.user.id;

    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) return res.status(404).json({ success: false, message: 'Không tìm thấy khiếu nại.' });

    const order: any = await OrderModel.findById(dispute.order_id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' });

    // Xác định xem ai đang nộp bằng chứng
    let columnToUpdate = '';
    if (order.seller_id === userId) columnToUpdate = 'seller_evidence';
    else if (order.buyer_id === userId) columnToUpdate = 'buyer_evidence';
    else return res.status(403).json({ success: false, message: 'Từ chối truy cập.' });

    // Đóng gói bằng chứng thành JSON
    const evidenceData = JSON.stringify({ type: 'image', url: evidenceUrl, text: description });

    await pool.execute(
      `UPDATE disputes SET ${columnToUpdate} = ? WHERE id = ?`,
      [evidenceData, disputeId]
    );

    res.status(200).json({ success: true, message: 'Nộp bằng chứng thành công.' });
  } catch (error: any) {
    logger.error('submitEvidence error:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi nộp bằng chứng.' });
  }
};

// ─────────────────────────────────────────────
// 6. Send chat message in dispute
// ─────────────────────────────────────────────
const sendChatMessage = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const disputeId = req.params.disputeId as string;
    const { message, attachments } = req.body;
    const userId = req.user.id;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty.' });
    }

    const DisputeChatService = (await import('../services/disputeChatService')).default;
    const result = await DisputeChatService.sendMessage(disputeId, userId, message, attachments);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Notify the other party in the dispute
    try {
      const dispute: any = await DisputeModel.findById(disputeId);
      if (dispute) {
        const otherUserId = userId === dispute.complainant_id ? dispute.seller_id : dispute.complainant_id;
        
        if (otherUserId) {
          NotificationService.notifyChatMessage({
            disputeId,
            otherUserId,
            senderId: userId,
            senderName: req.user?.username || 'User',
            message: message.substring(0, 100), // Preview
            orderId: dispute.order_id
          }).catch(err => logger.error('Notification error:', err));
        }
      }
    } catch (notifyErr) {
      logger.error('Failed to send chat notification:', notifyErr);
    }

    res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      data: { messageId: result.id }
    });
  } catch (error: any) {
    logger.error('sendChatMessage error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
};

// ─────────────────────────────────────────────
// 7. Get dispute chat history
// ─────────────────────────────────────────────
const getDisputeChat = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const disputeId = req.params.disputeId as string;
    const { page = '1', limit = '20' } = req.query;

    const DisputeChatService = (await import('../services/disputeChatService')).default;
    const messages = await DisputeChatService.getDisputeChat(
      disputeId,
      parseInt(page as string),
      parseInt(limit as string)
    );

    res.status(200).json({ success: true, data: messages });
  } catch (error: any) {
    logger.error('getDisputeChat error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch chat history.' });
  }
};

// ─────────────────────────────────────────────
// 8. Mark chat as read
// ─────────────────────────────────────────────
const markChatAsRead = async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const disputeId = req.params.disputeId as string;
    const userId = req.user.id;

    const DisputeChatService = (await import('../services/disputeChatService')).default;
    await DisputeChatService.markMessagesAsRead(disputeId, userId);

    res.status(200).json({ success: true, message: 'Messages marked as read.' });
  } catch (error: any) {
    logger.error('markChatAsRead error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark messages as read.' });
  }
};

export = {
  createDispute,
  getMyDisputes,
  getAllDisputes,
  resolveDispute,
  submitEvidence,
  sendChatMessage,
  getDisputeChat,
  markChatAsRead
};