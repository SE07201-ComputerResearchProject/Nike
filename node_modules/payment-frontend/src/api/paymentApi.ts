import { apiClient, retryRequest } from './client';
import { PaymentStatus } from '../types';

export interface MoMoPaymentResponse {
  paymentId: string;
  payUrl: string;
  deeplink?: string;
  qrCodeUrl?: string;
}

export interface QRPaymentResponse {
  paymentId: string;
  qrCodeImage: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  content: string;
}

/**
 * Create MoMo payment
 */
export const createMoMoPayment = async (
  orderId: string,
  amount: number
): Promise<MoMoPaymentResponse> => {
  return retryRequest(async () => {
    const response = await apiClient.post('/payments/momo', {
      orderId,
      amount,
    });
    return response.data.data;
  });
};

/**
 * Create QR payment
 */
export const createQRPayment = async (
  orderId: string,
  amount: number
): Promise<QRPaymentResponse> => {
  return retryRequest(async () => {
    const response = await apiClient.post('/payments/qr', {
      orderId,
      amount,
    });
    return response.data.data;
  });
};

/**
 * Check payment status
 */
export const checkPaymentStatus = async (paymentId: string): Promise<PaymentStatus> => {
  const response = await apiClient.get(`/payments/${paymentId}/status`);
  return response.data.data.status;
};

/**
 * Manually confirm QR payment (for testing)
 */
export const confirmQRPayment = async (paymentId: string, success: boolean = true): Promise<void> => {
  await apiClient.post(`/payments/qr/${paymentId}/confirm`, { success });
};
