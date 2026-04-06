import QRCode from 'qrcode';

export interface QRPaymentInfo {
  orderId: string;
  amount: number;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
}

class QRCodeGenerator {
  private bankName: string;
  private accountNumber: string;
  private accountName: string;

  constructor() {
    this.bankName      = process.env.QR_BANK_NAME || 'MOMO';
    this.accountNumber = process.env.QR_ACCOUNT_NUMBER || '0857494918';
    this.accountName   = process.env.QR_ACCOUNT_NAME || 'NGUYEN TRUNG KHOA';
  }

  generatePaymentContent(orderId: string, amount: number): string {
    return `Thanh toan don hang ${orderId}`;
  }

  private formatPaymentInfo(paymentInfo: QRPaymentInfo): string {
    const bankName = paymentInfo.bankName || this.bankName;
    const accountNumber = paymentInfo.accountNumber || this.accountNumber;
    const accountName = paymentInfo.accountName || this.accountName;
    const content = this.generatePaymentContent(paymentInfo.orderId, paymentInfo.amount);
    return `${bankName}|${accountNumber}|${accountName}|${paymentInfo.amount}|${content}`;
  }

  async generateQRCode(paymentInfo: QRPaymentInfo): Promise<string> {
    try {
      // BƯỚC THÊM MỚI: Nếu có link QR tĩnh trong file .env, ưu tiên trả về luôn!
      if (process.env.STATIC_QR_URL) {
        return process.env.STATIC_QR_URL;
      }

      // Nếu không có link tĩnh, mới dùng thư viện tự vẽ (Fallback)
      const paymentText = this.formatPaymentInfo(paymentInfo);
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

const qrCodeGenerator = new QRCodeGenerator();
export default qrCodeGenerator;