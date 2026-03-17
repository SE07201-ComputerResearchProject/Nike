import QRCode from 'qrcode';
import { config } from '../config/env.js';

export interface QRPaymentInfo {
  orderId: string;
  amount: number;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
}

export class QRCodeGenerator {
  private bankName: string;
  private accountNumber: string;
  private accountName: string;

  constructor() {
    this.bankName = config.qr.bankName;
    this.accountNumber = config.qr.accountNumber;
    this.accountName = config.qr.accountName;
  }

  /**
   * Generate payment content string
   */
  generatePaymentContent(orderId: string, amount: number): string {
    const content = `Thanh toan don hang ${orderId}`;
    return content;
  }

  /**
   * Format payment info as text
   */
  private formatPaymentInfo(paymentInfo: QRPaymentInfo): string {
    const bankName = paymentInfo.bankName || this.bankName;
    const accountNumber = paymentInfo.accountNumber || this.accountNumber;
    const accountName = paymentInfo.accountName || this.accountName;
    const content = this.generatePaymentContent(paymentInfo.orderId, paymentInfo.amount);

    // Format: Bank|Account|Name|Amount|Content
    const paymentText = `${bankName}|${accountNumber}|${accountName}|${paymentInfo.amount}|${content}`;

    return paymentText;
  }

  /**
   * Generate QR code image from payment info
   */
  async generateQRCode(paymentInfo: QRPaymentInfo): Promise<string> {
    try {
      const paymentText = this.formatPaymentInfo(paymentInfo);

      // Generate QR code as base64 data URL
      const qrCodeDataUrl = await QRCode.toDataURL(paymentText, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 2,
      });

      return qrCodeDataUrl;
    } catch (error) {
      console.error('QR code generation failed:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Get payment info for display
   */
  getPaymentInfo(paymentInfo: QRPaymentInfo) {
    return {
      bankName: paymentInfo.bankName || this.bankName,
      accountNumber: paymentInfo.accountNumber || this.accountNumber,
      accountName: paymentInfo.accountName || this.accountName,
      amount: paymentInfo.amount,
      content: this.generatePaymentContent(paymentInfo.orderId, paymentInfo.amount),
    };
  }
}
