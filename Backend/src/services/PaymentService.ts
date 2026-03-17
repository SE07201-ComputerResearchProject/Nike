import { PaymentModel } from '../models/Payment.js';
import { Payment, PaymentMethod, PaymentStatus, OrderStatus } from '../models/types.js';
import { MoMoClient, MoMoCallbackData } from './MoMoClient.js';
import { QRCodeGenerator } from './QRCodeGenerator.js';
import { OrderService } from './OrderService.js';

export interface QRPaymentResponse {
  paymentId: string;
  qrCodeImage: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  content: string;
}

export class PaymentService {
  private momoClient: MoMoClient;
  private qrGenerator: QRCodeGenerator;
  private orderService: OrderService;

  constructor() {
    this.momoClient = new MoMoClient();
    this.qrGenerator = new QRCodeGenerator();
    this.orderService = new OrderService();
  }

  /**
   * Create COD payment
   */
  async createCODPayment(orderId: string): Promise<Payment> {
    // Get order to verify it exists and get amount
    const order = await this.orderService.getOrderById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // Create payment record
    const payment = new PaymentModel({
      orderId,
      method: PaymentMethod.COD,
      amount: order.total,
      status: PaymentStatus.SUCCESS,
    });

    await payment.save();

    // Update order status to pending (waiting for delivery)
    await this.orderService.updateOrderStatus(orderId, OrderStatus.PENDING);
    await this.orderService.updateOrderPaymentId(orderId, payment._id.toString());

    return payment.toObject() as Payment;
  }

  /**
   * Create MoMo payment
   */
  async createMoMoPayment(orderId: string, amount: number) {
    // Get order to verify it exists
    const order = await this.orderService.getOrderById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // Call MoMo API to create payment request
    const momoResponse = await this.momoClient.createPaymentRequest({
      orderId,
      amount,
      orderInfo: `Thanh toan don hang ${order.orderNumber}`,
    });

    // Create payment record
    const payment = new PaymentModel({
      orderId,
      method: PaymentMethod.MOMO,
      amount,
      status: PaymentStatus.PENDING,
      momoData: {
        requestId: momoResponse.requestId,
        orderId: momoResponse.orderId,
        payUrl: momoResponse.payUrl,
        deeplink: momoResponse.deeplink || '',
        qrCodeUrl: momoResponse.qrCodeUrl || '',
      },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    });

    await payment.save();

    // Update order status
    await this.orderService.updateOrderStatus(orderId, OrderStatus.AWAITING_PAYMENT);
    await this.orderService.updateOrderPaymentId(orderId, payment._id.toString());

    return {
      paymentId: payment._id.toString(),
      payUrl: momoResponse.payUrl,
      deeplink: momoResponse.deeplink,
      qrCodeUrl: momoResponse.qrCodeUrl,
    };
  }

  /**
   * Handle MoMo callback
   */
  async handleMoMoCallback(callbackData: MoMoCallbackData): Promise<void> {
    // Verify signature
    const isValid = this.momoClient.verifySignature(callbackData, callbackData.signature);
    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // Find payment by orderId
    const payment = await PaymentModel.findOne({
      orderId: callbackData.orderId,
      method: PaymentMethod.MOMO,
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Update payment status based on result code
    if (callbackData.resultCode === 0) {
      // Success
      payment.status = PaymentStatus.SUCCESS;
      payment.transactionId = callbackData.transId;
      await payment.save();

      // Update order status
      await this.orderService.updateOrderStatus(payment.orderId, OrderStatus.PAID);
    } else {
      // Failed
      payment.status = PaymentStatus.FAILED;
      await payment.save();

      // Update order status
      await this.orderService.updateOrderStatus(payment.orderId, OrderStatus.PAYMENT_FAILED);
    }
  }

  /**
   * Create QR payment
   */
  async createQRPayment(orderId: string, amount: number): Promise<QRPaymentResponse> {
    // Get order to verify it exists
    const order = await this.orderService.getOrderById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // Generate QR code
    const qrCodeImage = await this.qrGenerator.generateQRCode({
      orderId,
      amount,
    });

    const paymentInfo = this.qrGenerator.getPaymentInfo({
      orderId,
      amount,
    });

    // Create payment record
    const payment = new PaymentModel({
      orderId,
      method: PaymentMethod.QR,
      amount,
      status: PaymentStatus.PENDING,
      qrData: {
        qrCodeImage,
        bankName: paymentInfo.bankName,
        accountNumber: paymentInfo.accountNumber,
        accountName: paymentInfo.accountName,
        content: paymentInfo.content,
      },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    });

    await payment.save();

    // Update order status
    await this.orderService.updateOrderStatus(orderId, OrderStatus.AWAITING_PAYMENT);
    await this.orderService.updateOrderPaymentId(orderId, payment._id.toString());

    return {
      paymentId: payment._id.toString(),
      qrCodeImage,
      bankName: paymentInfo.bankName,
      accountNumber: paymentInfo.accountNumber,
      accountName: paymentInfo.accountName,
      amount: paymentInfo.amount,
      content: paymentInfo.content,
    };
  }

  /**
   * Check payment status
   */
  async checkPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    const payment = await PaymentModel.findById(paymentId);

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Check if payment has expired
    if (payment.expiresAt && payment.expiresAt < new Date() && payment.status === PaymentStatus.PENDING) {
      payment.status = PaymentStatus.EXPIRED;
      await payment.save();

      // Update order status
      await this.orderService.updateOrderStatus(payment.orderId, OrderStatus.PAYMENT_FAILED);
    }

    return payment.status;
  }

  /**
   * Manually update QR payment status (for testing/simulation)
   */
  async updateQRPaymentStatus(paymentId: string, success: boolean): Promise<void> {
    const payment = await PaymentModel.findById(paymentId);

    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.method !== PaymentMethod.QR) {
      throw new Error('Payment is not a QR payment');
    }

    if (success) {
      payment.status = PaymentStatus.SUCCESS;
      payment.transactionId = `QR_${Date.now()}`;
      await payment.save();

      // Update order status
      await this.orderService.updateOrderStatus(payment.orderId, OrderStatus.PAID);
    } else {
      payment.status = PaymentStatus.FAILED;
      await payment.save();

      // Update order status
      await this.orderService.updateOrderStatus(payment.orderId, OrderStatus.PAYMENT_FAILED);
    }
  }
}
