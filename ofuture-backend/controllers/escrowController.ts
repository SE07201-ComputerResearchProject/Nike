// controllers/escrowController.ts
// ─────────────────────────────────────────────
// Thin HTTP adapter over escrowService.
// Handles req/res plumbing; all business logic
// lives in services/escrowService.js.
// ─────────────────────────────────────────────

import { Request, Response } from 'express';
import escrowService from '../services/escrowService';
import logger from '../utils/logger';
import { pool } from '../config/db';

interface EscrowRequest extends Request {
  user?: any;
  meta?: any;
}

// ── Shared context helper ─────────────────────
const ctx = (req: EscrowRequest) => ({
  requesterId   : req.user.id,
  requesterRole : req.user.role,
  ipAddress     : req.meta?.ip,
});

// ─────────────────────────────────────────────
// POST /api/escrow/pay
// ─────────────────────────────────────────────
const pay = async (req: EscrowRequest, res: Response): Promise<any> => {
  try {
    const { orderId, paymentMethod = {} } = req.body;

    const result = await escrowService.payAndHold({
      orderId,
      buyerId       : req.user.id,
      paymentMethod,
      ipAddress     : req.meta?.ip,
    });

    if (!result.success) {
      const statusMap: Record<string, number> = {
        ORDER_NOT_FOUND          : 404,
        INVALID_ORDER_STATUS     : 409,
        ESCROW_NOT_FOUND         : 404,
        ESCROW_ALREADY_PROCESSED : 409,
        PAYMENT_FAILED           : 402,
      };
      return res.status(statusMap[result.code as string] ?? 400).json({
        success : false,
        code    : result.code,
        message : result.message,
      });
    }

    res.status(200).json({ success: true, data: result });

  } catch (err) {
    logger.error('escrow pay error:', err);
    res.status(500).json({ success: false, message: 'Payment processing failed.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/escrow/release
// ─────────────────────────────────────────────
const release = async (req: EscrowRequest, res: Response): Promise<any> => {
  try {
    const { orderId } = req.body;

    const result = await escrowService.releaseToSeller({
      orderId,
      buyerId   : req.user.id,
      ipAddress : req.meta?.ip,
    });

    if (!result.success) {
      const statusMap: Record<string, number> = {
        ORDER_NOT_FOUND     : 404,
        FORBIDDEN           : 403,
        INVALID_ORDER_STATUS: 409,
        ESCROW_NOT_HELD     : 409,
        TRANSFER_FAILED     : 502,
      };
      return res.status(statusMap[result.code as string] ?? 400).json({
        success : false,
        code    : result.code,
        message : result.message,
      });
    }

    res.status(200).json({ success: true, data: result });

  } catch (err) {
    logger.error('escrow release error:', err);
    res.status(500).json({ success: false, message: 'Release failed.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/escrow/refund
// ─────────────────────────────────────────────
const refund = async (req: EscrowRequest, res: Response): Promise<any> => {
  try {
    const { orderId, reason } = req.body;

    const result = await escrowService.refundToBuyer({
      orderId,
      requesterId   : req.user.id,
      requesterRole : req.user.role,
      reason,
      ipAddress     : req.meta?.ip,
    });

    if (!result.success) {
      const statusMap: Record<string, number> = {
        ORDER_NOT_FOUND        : 404,
        FORBIDDEN              : 403,
        NOT_REFUNDABLE         : 409,
        ESCROW_NOT_FOUND       : 404,
        REFUND_GATEWAY_FAILED  : 502,
      };
      return res.status(statusMap[result.code as string] ?? 400).json({
        success : false,
        code    : result.code,
        message : result.message,
      });
    }

    res.status(200).json({ success: true, data: result });

  } catch (err) {
    logger.error('escrow refund error:', err);
    res.status(500).json({ success: false, message: 'Refund failed.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/escrow/dispute
// ─────────────────────────────────────────────
const dispute = async (req: EscrowRequest, res: Response): Promise<any> => {
  try {
    const { orderId, reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success : false,
        message : 'Please provide a dispute reason of at least 10 characters.',
      });
    }

    const result = await escrowService.openDispute({
      orderId,
      buyerId   : req.user.id,
      reason    : reason.trim(),
      ipAddress : req.meta?.ip,
    });

    if (!result.success) {
      const statusMap: Record<string, number> = {
        ORDER_NOT_FOUND : 404,
        FORBIDDEN       : 403,
        INVALID_STATUS  : 409,
        ESCROW_NOT_HELD : 409,
      };
      return res.status(statusMap[result.code as string] ?? 400).json({
        success : false,
        code    : result.code,
        message : result.message,
      });
    }

    res.status(200).json({ success: true, data: result });

  } catch (err) {
    logger.error('escrow dispute error:', err);
    res.status(500).json({ success: false, message: 'Failed to open dispute.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/escrow/resolve  (Admin only)
// ─────────────────────────────────────────────
const resolve = async (req: EscrowRequest, res: Response): Promise<any> => {
  try {
    // SỬA DÒNG NÀY: Lấy thêm disputeId từ req.body
    const { orderId, disputeId, resolution, reason } = req.body; 

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({
        success : false,
        message : 'Please provide a resolution reason.',
      });
    }

    const result = await escrowService.resolveDispute({
      orderId,
      disputeId, // <--- SỬA DÒNG NÀY: Truyền thêm disputeId vào service
      adminId    : req.user.id,
      resolution,
      reason     : reason.trim(),
      ipAddress  : req.meta?.ip,
    });

    if (!result.success) {
      const statusMap: Record<string, number> = {
        INVALID_RESOLUTION : 400,
        NOT_DISPUTED       : 409,
      };
      return res.status(statusMap[result.code as string] ?? 400).json({
        success : false,
        code    : result.code,
        message : result.message,
      });
    }

    res.status(200).json({ success: true, data: result });

  } catch (err) {
    logger.error('escrow resolve error:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve dispute.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/escrow/:orderId
// ─────────────────────────────────────────────
const getStatus = async (req: EscrowRequest, res: Response): Promise<any> => {
  try {
    const result = await escrowService.getEscrowStatus({
      orderId       : req.params.orderId as string,
      requesterId   : req.user.id,
      requesterRole : req.user.role,
    });

    if (!result.success) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, FORBIDDEN: 403 };
      return res.status(statusMap[result.code as string] ?? 400).json({
        success : false,
        code    : result.code,
        message : result.message,
      });
    }

    res.status(200).json({ success: true, data: result.data });

  } catch (err) {
    logger.error('escrow getStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch escrow status.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/escrow/admin/all  (Admin only)
// ─────────────────────────────────────────────
const adminListAll = async (req: EscrowRequest, res: Response): Promise<any> => {
  try {
    const status = req.query.status as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    
    const offset = (Math.max(1, page) - 1) * Math.min(100, limit);

    const conditions: string[] = [];
    const params: any[] = [];

    if (status) { conditions.push('e.status = ?'); params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows]: any = await pool.execute(
      `SELECT
         e.id, e.order_id, e.amount, e.platform_fee, e.net_amount,
         e.status, e.held_at, e.released_at, e.refunded_at,
         e.release_reason, e.refund_reason, e.created_at,
         b.username AS buyer,
         s.username AS seller,
         o.status   AS order_status
       FROM escrow_transactions e
       JOIN orders o ON o.id = e.order_id
       JOIN users  b ON b.id = e.buyer_id
       JOIN users  s ON s.id = e.seller_id
       ${where}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Math.min(100, limit), offset]
    );

    res.status(200).json({ success: true, data: rows });

  } catch (err) {
    logger.error('adminListAll escrow error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch escrow records.' });
  }
};

export = { pay, release, refund, dispute, resolve, getStatus, adminListAll };