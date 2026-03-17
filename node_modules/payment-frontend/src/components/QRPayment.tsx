import React, { useState, useEffect, useRef } from 'react';
import { Order } from '../types';
import { createQRPayment, checkPaymentStatus } from '../api/paymentApi';
import './PaymentComponent.css';

interface QRPaymentProps {
  order: Order;
  onSuccess: (orderId: string) => void;
  onError: (error: string) => void;
}

export const QRPayment: React.FC<QRPaymentProps> = ({ order, onSuccess, onError }) => {
  const [loading, setLoading] = useState(true);
  const [qrData, setQrData] = useState<any>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    initializePayment();
    return () => {
      // Cleanup polling on unmount
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const initializePayment = async () => {
    try {
      const result = await createQRPayment(order._id, order.total);
      setQrData(result);
      setPaymentId(result.paymentId);
      setLoading(false);

      // Start polling for payment status
      startPolling(result.paymentId);
    } catch (error: any) {
      onError(error.message || 'Không thể tạo mã QR');
      setLoading(false);
    }
  };

  const startPolling = (paymentId: string) => {
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const status = await checkPaymentStatus(paymentId);
        
        if (status === 'success') {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
          }
          onSuccess(order._id);
        } else if (status === 'expired' || status === 'failed') {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
          }
          onError('Thanh toán đã hết hạn hoặc thất bại');
        }
      } catch (error) {
        console.error('Error checking payment status:', error);
      }
    }, 3000); // Poll every 3 seconds
  };

  if (loading) {
    return (
      <div className="payment-component">
        <div className="payment-component__loading">Đang tạo mã QR...</div>
      </div>
    );
  }

  if (!qrData) {
    return null;
  }

  return (
    <div className="payment-component">
      <div className="payment-component__info">
        <div className="payment-component__icon">📷</div>
        <h3 className="payment-component__title">Quét Mã QR Để Thanh Toán</h3>
        <p className="payment-component__description">
          Sử dụng ứng dụng ngân hàng của bạn để quét mã QR bên dưới
        </p>
      </div>

      <div className="qr-payment">
        <div className="qr-payment__code">
          <img src={qrData.qrCodeImage} alt="QR Code" className="qr-payment__image" />
        </div>

        <div className="qr-payment__info">
          <div className="qr-payment__row">
            <span className="qr-payment__label">Ngân hàng:</span>
            <span className="qr-payment__value">{qrData.bankName}</span>
          </div>
          <div className="qr-payment__row">
            <span className="qr-payment__label">Số tài khoản:</span>
            <span className="qr-payment__value">{qrData.accountNumber}</span>
          </div>
          <div className="qr-payment__row">
            <span className="qr-payment__label">Chủ tài khoản:</span>
            <span className="qr-payment__value">{qrData.accountName}</span>
          </div>
          <div className="qr-payment__row">
            <span className="qr-payment__label">Số tiền:</span>
            <span className="qr-payment__value qr-payment__value--amount">
              {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(qrData.amount)}
            </span>
          </div>
          <div className="qr-payment__row">
            <span className="qr-payment__label">Nội dung:</span>
            <span className="qr-payment__value">{qrData.content}</span>
          </div>
        </div>

        <div className="qr-payment__status">
          <div className="qr-payment__spinner"></div>
          <p>Đang chờ thanh toán...</p>
        </div>
      </div>
    </div>
  );
};
