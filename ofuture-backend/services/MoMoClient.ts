import crypto from 'crypto';

export interface MoMoPaymentParams {
  orderId: string;
  amount: number;
  orderInfo: string;
  redirectUrl?: string;
  ipnUrl?: string;
}

export interface MoMoPaymentResponse {
  partnerCode: string;
  orderId: string;
  requestId: string;
  amount: number;
  responseTime: number;
  message: string;
  resultCode: number;
  payUrl: string;
  deeplink?: string;
  qrCodeUrl?: string;
}

export interface MoMoCallbackData {
  partnerCode: string;
  orderId: string;
  requestId: string;
  amount: number;
  orderInfo: string;
  orderType: string;
  transId: string;
  resultCode: number;
  message: string;
  payType: string;
  responseTime: number;
  extraData: string;
  signature: string;
}

class MoMoClient {
  private partnerCode: string;
  private accessKey: string;
  private secretKey: string;
  private endpoint: string;
  private redirectUrl: string;
  private ipnUrl: string;

  constructor() {
    this.partnerCode = process.env.MOMO_PARTNER_CODE || 'MOMO';
    this.accessKey   = process.env.MOMO_ACCESS_KEY || 'F8BBA842ECF85';
    this.secretKey   = process.env.MOMO_SECRET_KEY || 'K951B6PE1waDMi640xX08PD3vg6EkVlz';
    this.endpoint    = process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create';
    this.redirectUrl = process.env.MOMO_REDIRECT_URL || 'http://localhost:3000/payment/momo/callback';
    this.ipnUrl      = process.env.MOMO_IPN_URL || 'http://localhost:5000/api/payments/momo/callback';
  }

  generateSignature(data: Record<string, any>): string {
    const sortedKeys = Object.keys(data).sort();
    const rawSignature = sortedKeys.map((key) => `${key}=${data[key]}`).join('&');
    return crypto.createHmac('sha256', this.secretKey).update(rawSignature).digest('hex');
  }

  verifySignature(data: MoMoCallbackData, signature: string): boolean {
    const {
      partnerCode, orderId, requestId, amount, orderInfo,
      orderType, transId, resultCode, message, payType,
      responseTime, extraData,
    } = data;

    const rawSignature = `accessKey=${this.accessKey}&amount=${amount}&extraData=${extraData}&message=${message}&orderId=${orderId}&orderInfo=${orderInfo}&orderType=${orderType}&partnerCode=${partnerCode}&payType=${payType}&requestId=${requestId}&responseTime=${responseTime}&resultCode=${resultCode}&transId=${transId}`;
    
    const expectedSignature = crypto.createHmac('sha256', this.secretKey).update(rawSignature).digest('hex');
    return signature === expectedSignature;
  }

  async createPaymentRequest(params: MoMoPaymentParams): Promise<MoMoPaymentResponse> {
    const requestId = `${params.orderId}_${Date.now()}`;
    const orderInfo = params.orderInfo || `Payment for order ${params.orderId}`;
    const redirectUrl = params.redirectUrl || this.redirectUrl;
    const ipnUrl = params.ipnUrl || this.ipnUrl;
    const requestType = 'captureWallet';
    const extraData = '';

    const signatureData = {
      accessKey: this.accessKey,
      amount: params.amount,
      extraData,
      ipnUrl,
      orderId: params.orderId,
      orderInfo,
      partnerCode: this.partnerCode,
      redirectUrl,
      requestId,
      requestType,
    };

    const signature = this.generateSignature(signatureData);

    const requestBody = {
      ...signatureData,
      signature,
      lang: 'vi',
    };

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // Đọc chi tiết lỗi từ MoMo thay vì chỉ lấy statusText
        const errorDetail = await response.text(); 
        console.error('Chi tiết lỗi từ MoMo:', errorDetail);
        throw new Error(`MoMo API error [${response.status}]: ${errorDetail}`);
      }
      
      const result: MoMoPaymentResponse = await response.json();
      if (result.resultCode !== 0) throw new Error(`MoMo payment creation failed: ${result.message}`);
      
      return result;
    } catch (error) {
      console.error('MoMo API call failed:', error);
      throw error;
    }
  }
}

export default new MoMoClient();