import crypto from 'crypto';
import { config } from '../config/env.js';

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

export class MoMoClient {
  private partnerCode: string;
  private accessKey: string;
  private secretKey: string;
  private endpoint: string;
  private redirectUrl: string;
  private ipnUrl: string;

  constructor() {
    this.partnerCode = config.momo.partnerCode;
    this.accessKey = config.momo.accessKey;
    this.secretKey = config.momo.secretKey;
    this.endpoint = config.momo.endpoint;
    this.redirectUrl = config.momo.redirectUrl;
    this.ipnUrl = config.momo.ipnUrl;
  }

  /**
   * Generate HMAC SHA256 signature
   */
  generateSignature(data: Record<string, any>): string {
    // Sort keys and create raw signature string
    const sortedKeys = Object.keys(data).sort();
    const rawSignature = sortedKeys.map((key) => `${key}=${data[key]}`).join('&');

    // Generate HMAC SHA256
    const signature = crypto.createHmac('sha256', this.secretKey).update(rawSignature).digest('hex');

    return signature;
  }

  /**
   * Verify signature from MoMo callback
   */
  verifySignature(data: MoMoCallbackData, signature: string): boolean {
    const {
      partnerCode,
      orderId,
      requestId,
      amount,
      orderInfo,
      orderType,
      transId,
      resultCode,
      message,
      payType,
      responseTime,
      extraData,
    } = data;

    const rawSignature = `accessKey=${this.accessKey}&amount=${amount}&extraData=${extraData}&message=${message}&orderId=${orderId}&orderInfo=${orderInfo}&orderType=${orderType}&partnerCode=${partnerCode}&payType=${payType}&requestId=${requestId}&responseTime=${responseTime}&resultCode=${resultCode}&transId=${transId}`;

    const expectedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(rawSignature)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Create payment request to MoMo API
   */
  async createPaymentRequest(params: MoMoPaymentParams): Promise<MoMoPaymentResponse> {
    const requestId = `${params.orderId}_${Date.now()}`;
    const orderInfo = params.orderInfo || `Payment for order ${params.orderId}`;
    const redirectUrl = params.redirectUrl || this.redirectUrl;
    const ipnUrl = params.ipnUrl || this.ipnUrl;
    const requestType = 'captureWallet';
    const extraData = '';

    // Create signature data
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

    // Prepare request body
    const requestBody = {
      ...signatureData,
      signature,
      lang: 'vi',
    };

    try {
      // Call MoMo API
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`MoMo API error: ${response.statusText}`);
      }

      const result: MoMoPaymentResponse = await response.json();

      if (result.resultCode !== 0) {
        throw new Error(`MoMo payment creation failed: ${result.message}`);
      }

      return result;
    } catch (error) {
      console.error('MoMo API call failed:', error);
      throw error;
    }
  }
}
