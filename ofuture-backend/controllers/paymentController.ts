// controllers/paymentController.ts
import { Request, Response } from 'express';
import PaymentService from '../services/paymentService';
import logger from '../utils/logger';
import WalletService from '../services/walletService';
import { pool } from '../config/db';
import { v4 as uuidv4 } from 'uuid';

const createMoMo = async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId, amount } = req.body;
    const result = await PaymentService.createMoMoPayment(orderId, amount);
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    logger.error('createMoMo error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const momoCallback = async (req: Request, res: Response): Promise<any> => {
  try {
    // Webhook từ MoMo gọi về hệ thống
    await PaymentService.handleMoMoCallback(req.body);
    // Trả về 204 No Content theo đúng chuẩn yêu cầu của MoMo IPN
    res.status(204).send(); 
  } catch (err: any) {
    logger.error('momoCallback error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const createQR = async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId, amount } = req.body;
    const result = await PaymentService.createQRPayment(orderId, amount);
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    logger.error('createQR error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const updateQRStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const paymentId = req.params.paymentId as string;
    const { success } = req.body;
    await PaymentService.updateQRPaymentStatus(paymentId, success);
    res.status(200).json({ success: true, message: 'QR payment status updated successfully.' });
  } catch (err: any) {
    logger.error('updateQRStatus error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const getStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const paymentId = req.params.paymentId as string;
    const status = await PaymentService.checkPaymentStatus(paymentId);
    res.status(200).json({ success: true, data: { status } });
  } catch (err: any) {
    logger.error('getPaymentStatus error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const payWithWallet = async (req: Request, res: Response): Promise<any> => {
  const { orderId, amount } = req.body;
  const userId = (req as any).user.id; // Lấy từ middleware authenticate

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Kiểm tra đơn hàng (Hỗ trợ cả đơn lẻ và đơn Batch)
    const [orders]: any = await conn.execute(
      'SELECT id, buyer_id, total_amount, status FROM orders WHERE id = ? OR notes LIKE ? FOR UPDATE',
      [orderId, `%BATCH:${orderId}%`]
    );

    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    if (orders.some((o: any) => o.status !== 'pending')) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Có đơn hàng không ở trạng thái chờ thanh toán' });
    }

    if (orders.some((o: any) => o.buyer_id !== userId)) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: 'Bạn không có quyền thanh toán đơn hàng này' });
    }

    // 2. Kiểm tra số dư ví Buyer
    const hasEnough = await WalletService.hasSufficientBalance(userId, amount);
    if (!hasEnough) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Số dư ví không đủ để thanh toán. Vui lòng nạp thêm!' });
    }

    // 3. Trừ tiền ví (Ghi nhận Ký quỹ cho đơn hàng)
    await WalletService.deductFromWallet(
      userId,
      amount,
      orderId,
      `Thanh toán bằng ví cho đơn hàng ${orderId.split('_')[0]}` // Cắt mã lấy phần đầu cho ngắn gọn
    );

    // 4. Cập nhật trạng thái Order và Escrow
    for (const o of orders) {
      await conn.execute(`UPDATE orders SET status = 'paid' WHERE id = ?`, [o.id]);
      await conn.execute(
        `UPDATE escrow_transactions SET status = 'held', held_at = NOW() WHERE order_id = ? AND status = 'pending'`,
        [o.id]
      );
    }

    // 5. Ghi nhận giao dịch vào bảng payments (Để đồng bộ lịch sử hệ thống)
    const paymentId = uuidv4();
    await conn.execute(
      `INSERT INTO payments (id, user_id, order_id, method, amount, status, transaction_id)
       VALUES (?, ?, ?, 'wallet', ?, 'success', ?)`,
      [paymentId, userId, orderId, amount, `WALLET_${Date.now()}`]
    );

    await conn.commit();
    logger.info(`[Wallet Payment] Thành công. User ${userId} thanh toán ${amount} cho đơn ${orderId}`);
    
    res.status(200).json({ success: true, message: 'Thanh toán bằng ví thành công' });

  } catch (err: any) {
    await conn.rollback();
    logger.error('payWithWallet error:', err);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi thanh toán bằng ví' });
  } finally {
    conn.release();
  }
};

export = { createMoMo, momoCallback, createQR, updateQRStatus, getStatus, payWithWallet };