// Enums
export enum OrderStatus {
  PENDING = 'pending',
  AWAITING_PAYMENT = 'awaiting_payment',
  PAID = 'paid',
  PROCESSING = 'processing',
  SHIPPING = 'shipping',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  PAYMENT_FAILED = 'payment_failed',
}

export enum PaymentMethod {
  COD = 'cod',
  MOMO = 'momo',
  QR = 'qr',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

// Interfaces
export interface OrderItem {
  productId: string;
  name: string;
  image: string;
  quantity: number;
  price: number;
}

export interface Address {
  fullName: string;
  phone: string;
  address: string;
  city: string;
  district: string;
  ward: string;
}

export interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  items: OrderItem[];
  subtotal: number;
  shippingFee: number;
  tax: number;
  total: number;
  shippingAddress: Address;
  customerInfo: CustomerInfo;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MoMoPaymentData {
  requestId: string;
  orderId: string;
  payUrl: string;
  deeplink: string;
  qrCodeUrl: string;
}

export interface QRPaymentData {
  qrCodeImage: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  content: string;
}

export interface Payment {
  _id: string;
  orderId: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  transactionId?: string;
  momoData?: MoMoPaymentData;
  qrData?: QRPaymentData;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}
