// services/paymentService.ts
// ─────────────────────────────────────────────
// Payment gateway abstraction layer.
//
// 1. CHỨA LOGIC CŨ: Simulated methods (chargeCard, refundCharge, transferToSeller)
//    để đảm bảo tương thích 100% với escrowService hiện tại.
// 2. CHỨA LOGIC MỚI: Tích hợp MoMo & VietQR với MySQL Transaction.
// ─────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { pool } from '../config/db';
import PaymentModel from '../models/paymentModel';
import MoMoClient, { MoMoCallbackData } from './MoMoClient';
import QRCodeGenerator from './QRCodeGenerator';

// ═════════════════════════════════════════════
// PHẦN 1: LOGIC GIẢ LẬP (CŨ) - DÀNH CHO ESCROW
// ═════════════════════════════════════════════

const FAIL_PREFIXES = ['0000', '9999'];

interface ChargeCardParams {
  orderId: string;
  amount: number | string;
  currency?: string;
  paymentMethod?: any;
}

interface RefundChargeParams {
  chargeId: string | null;
  amount: number | string;
  reason?: string;
}

interface TransferToSellerParams {
  sellerId: string;
  amount: number | string;
  currency?: string;
  orderId: string;
}

const _delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const chargeCard = async ({ orderId, amount, currency = 'USD', paymentMethod = {} }: ChargeCardParams) => {
  logger.info(`[PaymentService] Charging ${amount} ${currency} for order ${orderId}`);
  await _delay(120);

  const cardPrefix = (paymentMethod.cardNumber ?? '').replace(/\s/g, '').slice(0, 4);
  if (FAIL_PREFIXES.includes(cardPrefix)) {
    logger.warn(`[PaymentService] Card declined for order ${orderId}`);
    return {
      success : false,
      chargeId: null,
      message : 'Card declined by issuing bank.',
      code    : 'CARD_DECLINED',
    };
  }

  const chargeId = `ch_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  logger.info(`[PaymentService] Charge successful: chargeId=${chargeId}`);

  return {
    success  : true,
    chargeId,
    amount,
    currency,
    message  : 'Payment captured successfully.',
    gateway  : 'simulated',
    timestamp: new Date().toISOString(),
  };
};

const refundCharge = async ({ chargeId, amount, reason = 'requested_by_customer' }: RefundChargeParams) => {
  logger.info(`[PaymentService] Refunding ${amount} for chargeId=${chargeId}`);
  await _delay(80);

  if (!chargeId) {
    return { success: false, refundId: null, message: 'No charge ID provided for refund.' };
  }

  const refundId = `re_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  logger.info(`[PaymentService] Refund successful: refundId=${refundId}`);

  return {
    success  : true,
    refundId,
    amount,
    reason,
    message  : 'Refund processed successfully.',
    gateway  : 'simulated',
    timestamp: new Date().toISOString(),
  };
};

const transferToSeller = async ({ sellerId, amount, currency = 'USD', orderId }: TransferToSellerParams) => {
  logger.info(`[PaymentService] Transferring ${amount} ${currency} to seller ${sellerId} for order ${orderId}`);
  await _delay(100);

  const transferId = `tr_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  logger.info(`[PaymentService] Transfer successful: transferId=${transferId}`);

  return {
    success   : true,
    transferId,
    amount,
    currency,
    sellerId,
    message   : 'Funds transferred to seller.',
    gateway   : 'simulated',
    timestamp : new Date().toISOString(),
  };
};

// ═════════════════════════════════════════════
// PHẦN 2: LOGIC THỰC TẾ (MỚI) - MOMO & VIETQR
// ═════════════════════════════════════════════

const createMoMoPayment = async (orderId: string, amount: number) => {
  const [[order]]: any = await pool.execute('SELECT id, status FROM orders WHERE id = ? LIMIT 1', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error(`Cannot pay for order with status: ${order.status}`);

  const momoResponse = await MoMoClient.createPaymentRequest({
    orderId,
    amount,
    orderInfo: `Thanh toan don hang ${orderId}`,
  });

  const paymentId = await PaymentModel.create({
    orderId,
    method: 'momo',
    amount,
    status: 'pending',
    paymentData: {
      requestId: momoResponse.requestId,
      payUrl: momoResponse.payUrl,
      deeplink: momoResponse.deeplink,
      qrCodeUrl: momoResponse.qrCodeUrl,
    },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  return {
    paymentId,
    payUrl: momoResponse.payUrl,
    deeplink: momoResponse.deeplink,
    qrCodeUrl: momoResponse.qrCodeUrl,
  };
};

const handleMoMoCallback = async (callbackData: MoMoCallbackData): Promise<void> => {
  const isValid = MoMoClient.verifySignature(callbackData, callbackData.signature);
  if (!isValid) throw new Error('Invalid signature');

  const payment = await PaymentModel.findByOrderIdAndMethod(callbackData.orderId, 'momo');
  if (!payment) throw new Error('Payment record not found');
  if (payment.status !== 'pending') return;

  const isSuccess = callbackData.resultCode === 0;
  const newStatus = isSuccess ? 'success' : 'failed';

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE payments SET status = ?, transaction_id = ? WHERE id = ?`,
      [newStatus, callbackData.transId || null, payment.id]
    );

    if (isSuccess) {
      await conn.execute(`UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'`, [callbackData.orderId]);
      await conn.execute(
        `UPDATE escrow_transactions SET status = 'held', held_at = NOW() WHERE order_id = ? AND status = 'pending'`,
        [callbackData.orderId]
      );
      logger.info(`[MoMo] Payment Success. Order ${callbackData.orderId} paid & funds held in escrow.`);
    } else {
      logger.warn(`[MoMo] Payment Failed for Order ${callbackData.orderId}: ${callbackData.message}`);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    logger.error('handleMoMoCallback transaction error:', err);
    throw err;
  } finally {
    conn.release();
  }
};

const createQRPayment = async (orderId: string, amount: number) => {
  const [[order]]: any = await pool.execute('SELECT id, status FROM orders WHERE id = ? LIMIT 1', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error(`Cannot pay for order with status: ${order.status}`);

  const qrCodeImage = await QRCodeGenerator.generateQRCode({ orderId, amount });
  const paymentInfo = QRCodeGenerator.getPaymentInfo({ orderId, amount });

  const paymentId = await PaymentModel.create({
    orderId,
    method: 'qr',
    amount,
    status: 'pending',
    paymentData: {
      bankName: paymentInfo.bankName,
      accountNumber: paymentInfo.accountNumber,
      accountName: paymentInfo.accountName,
      content: paymentInfo.content,
    },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });

  return { paymentId, qrCodeImage, ...paymentInfo };
};

const updateQRPaymentStatus = async (paymentId: string, success: boolean): Promise<void> => {
  const payment = await PaymentModel.findById(paymentId);
  if (!payment) throw new Error('Payment not found');
  if (payment.method !== 'qr') throw new Error('Not a QR payment');
  if (payment.status !== 'pending') throw new Error(`Payment already processed (${payment.status})`);

  const newStatus = success ? 'success' : 'failed';
  const conn: any = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE payments SET status = ?, transaction_id = ? WHERE id = ?`,
      [newStatus, success ? `QR_MANUAL_${Date.now()}` : null, paymentId]
    );

    if (success) {
      await conn.execute(`UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'`, [payment.order_id]);
      await conn.execute(`UPDATE escrow_transactions SET status = 'held', held_at = NOW() WHERE order_id = ? AND status = 'pending'`, [payment.order_id]);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const checkPaymentStatus = async (paymentId: string): Promise<string> => {
  const payment = await PaymentModel.findById(paymentId);
  if (!payment) throw new Error('Payment not found');

  if (payment.status === 'pending' && new Date(payment.expires_at) < new Date()) {
    await pool.execute(`UPDATE payments SET status = 'expired' WHERE id = ?`, [paymentId]);
    return 'expired';
  }
  return payment.status;
};

export = {
  // Cũ
  chargeCard,
  refundCharge,
  transferToSeller,
  // Mới
  createMoMoPayment,
  handleMoMoCallback,
  createQRPayment,
  updateQRPaymentStatus,
  checkPaymentStatus
};