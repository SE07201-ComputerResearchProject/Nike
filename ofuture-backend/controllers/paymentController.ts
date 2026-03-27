// controllers/paymentController.ts
import { Request, Response } from 'express';
import PaymentService from '../services/paymentService';
import logger from '../utils/logger';

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

// ─────────────────────────────────────────────
// GET /api/payments/:paymentId/stream
// Mở luồng SSE (Server-Sent Events) để Frontend lắng nghe real-time
// ─────────────────────────────────────────────
const streamPaymentStatus = async (req: Request, res: Response) => {
  const paymentId = req.params.paymentId;

  // 1. Cấu hình Header đặc biệt cho kết nối SSE (Không bao giờ đóng)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Gửi header ngay lập tức

  // 2. Gửi một tin nhắn "Chào hỏi" để giữ kết nối không bị timeout
  res.write(`data: ${JSON.stringify({ message: 'Connected to payment stream', status: 'listening' })}\n\n`);

  // 3. Định nghĩa hàm lắng nghe sự kiện
  const eventName = `payment_update_${paymentId}`;
  const listener = (data: any) => {
    // Bắn data về cho Frontend
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    
    // Nếu thanh toán thành công hoặc thất bại thì đóng kết nối luôn cho nhẹ server
    if (data.status === 'success' || data.status === 'failed') {
      res.end();
    }
  };

  // 4. Đăng ký lắng nghe sự kiện từ paymentService
  PaymentService.paymentEventEmitter.on(eventName, listener);

  // 5. Dọn dẹp (Xóa listener) nếu Frontend đột ngột tắt trình duyệt (đổi tab, tắt app)
  req.on('close', () => {
    PaymentService.paymentEventEmitter.off(eventName, listener);
  });
};

export = { createMoMo, momoCallback, createQR, updateQRStatus, getStatus, streamPaymentStatus };