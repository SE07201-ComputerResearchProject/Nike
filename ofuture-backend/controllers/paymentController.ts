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

export = { createMoMo, momoCallback, createQR, updateQRStatus, getStatus };