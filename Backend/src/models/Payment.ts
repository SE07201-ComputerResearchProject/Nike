import mongoose, { Schema, Document } from 'mongoose';
import { Payment as IPayment, PaymentMethod, PaymentStatus } from './types.js';

export interface PaymentDocument extends Omit<IPayment, '_id'>, Document {}

const MoMoPaymentDataSchema = new Schema({
  requestId: { type: String, required: true },
  orderId: { type: String, required: true },
  payUrl: { type: String, required: true },
  deeplink: { type: String },
  qrCodeUrl: { type: String },
});

const QRPaymentDataSchema = new Schema({
  qrCodeImage: { type: String, required: true },
  bankName: { type: String, required: true },
  accountNumber: { type: String, required: true },
  accountName: { type: String, required: true },
  content: { type: String, required: true },
});

const PaymentSchema = new Schema<PaymentDocument>(
  {
    orderId: {
      type: String,
      required: true,
      index: true,
    },
    method: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
      index: true,
    },
    transactionId: {
      type: String,
      index: true,
    },
    momoData: {
      type: MoMoPaymentDataSchema,
    },
    qrData: {
      type: QRPaymentDataSchema,
    },
    expiresAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
PaymentSchema.index({ orderId: 1, status: 1 });
PaymentSchema.index({ expiresAt: 1 }, { sparse: true });

export const PaymentModel = mongoose.model<PaymentDocument>('Payment', PaymentSchema);
