import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/payment-page',
  momo: {
    partnerCode: process.env.MOMO_PARTNER_CODE || '',
    accessKey: process.env.MOMO_ACCESS_KEY || '',
    secretKey: process.env.MOMO_SECRET_KEY || '',
    endpoint: process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create',
    redirectUrl: process.env.MOMO_REDIRECT_URL || 'http://localhost:3000/payment/momo/callback',
    ipnUrl: process.env.MOMO_IPN_URL || 'http://localhost:5000/api/payments/momo/callback',
  },
  qr: {
    bankName: process.env.QR_BANK_NAME || 'Vietcombank',
    accountNumber: process.env.QR_ACCOUNT_NUMBER || '1234567890',
    accountName: process.env.QR_ACCOUNT_NAME || 'NGUYEN VAN A',
  },
};
