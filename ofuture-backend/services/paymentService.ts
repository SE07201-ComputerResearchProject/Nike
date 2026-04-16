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
import WalletService from './walletService';

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
  let actualUserId = null;
  let isTopup = false;

  // 1. Kiểm tra xem orderId gửi lên có phải là ID của User không (Trường hợp nạp ví)
  const [users]: any = await pool.execute('SELECT id FROM users WHERE id = ?', [orderId]);
  if (users.length > 0) {
    isTopup = true;
    actualUserId = users[0].id;
  } else {
    // 2. Nếu không phải ID user thì đây là đơn hàng
    const [orders]: any = await pool.execute('SELECT id, buyer_id, status FROM orders WHERE id = ? OR notes LIKE ?', [orderId, `%BATCH:${orderId}%`]);
    if (orders.length === 0) throw new Error('Order not found');
    if (orders.some((o: any) => o.status !== 'pending')) throw new Error('Có đơn hàng không ở trạng thái pending.');
    actualUserId = orders[0].buyer_id;
  }

  const momoResponse = await MoMoClient.createPaymentRequest({
    orderId, // Truyền nguyên gốc (MoMoClient sẽ tự nối thêm _timestamp)
    amount,
    orderInfo: isTopup ? `Nap tien vao vi` : `Thanh toan don hang ${orderId}`,
  });

  // 3. Insert trực tiếp vào DB để đảm bảo lưu đúng user_id và isTopup flag
  const paymentId = uuidv4();
  await pool.execute(
    `INSERT INTO payments (id, user_id, order_id, method, amount, status, payment_data, expires_at)
     VALUES (?, ?, ?, 'momo', ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
    [
      paymentId,
      actualUserId,
      orderId, // Chứa userId nếu là nạp tiền, hoặc orderId nếu là mua hàng
      amount,
      JSON.stringify({
        isTopup, // Đánh dấu là lệnh nạp tiền
        requestId: momoResponse.requestId,
        payUrl: momoResponse.payUrl,
        deeplink: momoResponse.deeplink,
        qrCodeUrl: momoResponse.qrCodeUrl,
      })
    ]
  );

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

  // Lấy UUID gốc trước khi MoMoClient nối timestamp
  const actualOrderId = callbackData.orderId.split('_')[0]; 

  // Truy vấn DB để lấy thông tin payment
  const [payments]: any = await pool.execute(
    'SELECT * FROM payments WHERE order_id = ? AND method = ? ORDER BY created_at DESC LIMIT 1',
    [actualOrderId, 'momo']
  );
  if (payments.length === 0) throw new Error('Payment record not found');
  
  const payment = payments[0];
  if (payment.status !== 'pending') return;

  const isSuccess = callbackData.resultCode === 0;
  const newStatus = isSuccess ? 'success' : 'failed';
  
  // Đọc cờ isTopup từ DB
  const paymentDataObj = typeof payment.payment_data === 'string' ? JSON.parse(payment.payment_data) : payment.payment_data;
  const isTopup = paymentDataObj?.isTopup === true;

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE payments SET status = ?, transaction_id = ? WHERE id = ?`,
      [newStatus, callbackData.transId || null, payment.id]
    );

    if (isTopup) {
      // ──────────────────────────────────────────
      // NHÁNH 1: XỬ LÝ NẠP VÍ
      // ──────────────────────────────────────────
      if (isSuccess) {
        try {
          await WalletService.depositFromPayment(
            payment.user_id, // Lấy chuẩn xác userId từ bảng payments
            callbackData.amount,
            payment.id,
            'momo',
            `Nạp tiền vào ví từ MoMo`
          );
          logger.info(`[MoMo] Nạp ví thành công cho user: ${payment.user_id}`);
        } catch (walletErr) {
          logger.error('Lỗi nạp tiền vào ví:', walletErr);
        }
      }
    } else {
      // ──────────────────────────────────────────
      // NHÁNH 2: XỬ LÝ THANH TOÁN ĐƠN HÀNG
      // ──────────────────────────────────────────
      const [orders]: any = await conn.execute(
        'SELECT id, buyer_id, total_amount FROM orders WHERE id = ? OR notes LIKE ?',
        [actualOrderId, `%BATCH:${actualOrderId}%`]
      );

      if (isSuccess && orders.length > 0) {
        for (const o of orders) {
          await conn.execute(`UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'`, [o.id]);
          await conn.execute(
            `UPDATE escrow_transactions SET status = 'held', held_at = NOW() WHERE order_id = ? AND status = 'pending'`,
            [o.id]
          );
        }

        try {
          await WalletService.depositFromPayment(
            orders[0].buyer_id,
            callbackData.amount,
            payment.id,
            'momo',
            `Nạp tiền từ MoMo cho đơn hàng ${actualOrderId}`
          );
          await WalletService.deductFromWallet(
            orders[0].buyer_id,
            callbackData.amount,
            actualOrderId,
            `Thanh toán ký quỹ cho đơn hàng ${actualOrderId}`
          );
        } catch (walletErr) {
          logger.error('Wallet sync failed:', walletErr);
        }
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const createQRPayment = async (orderId: string, amount: number) => {
  const [orders]: any = await pool.execute('SELECT id, status FROM orders WHERE id = ? OR notes LIKE ?', [orderId, `%BATCH:${orderId}%`]);
  if (orders.length === 0) throw new Error('Order not found');
  if (orders.some((o: any) => o.status !== 'pending')) throw new Error('Có đơn hàng không ở trạng thái pending.');

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
      const [orders]: any = await conn.execute(
        'SELECT id, buyer_id FROM orders WHERE id = ? OR notes LIKE ?',
        [payment.order_id, `%BATCH:${payment.order_id}%`]
      );

      if (orders.length > 0) {
        for (const o of orders) {
          await conn.execute(`UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'`, [o.id]);
          await conn.execute(`UPDATE escrow_transactions SET status = 'held', held_at = NOW() WHERE order_id = ? AND status = 'pending'`, [o.id]);
        }

        // Bổ sung đồng bộ Ví cho QR
        try {
          await WalletService.depositFromPayment(
            orders[0].buyer_id,
            payment.amount,
            paymentId,
            'qr',
            `Nạp tiền từ VietQR cho đơn hàng ${payment.order_id}`
          );
          await WalletService.deductFromWallet(
            orders[0].buyer_id,
            payment.amount,
            payment.order_id,
            `Thanh toán ký quỹ cho đơn hàng ${payment.order_id}`
          );
        } catch (walletErr) {
          logger.error('Wallet sync failed in QR Update:', walletErr);
        }
      } else {
        // No orders found for this payment.order_id
        logger.warn(`[QR] Payment success but no orders found for ${payment.order_id}`);
      }
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