import React, { useState, useEffect } from 'react';
import { Order } from '../types';
import { createMoMoPayment } from '../api/paymentApi';
import './PaymentComponent.css';

interface MoMoPaymentProps {
  order: Order;
  onSuccess: (orderId: string) => void;
  onError: (error: string) => void;
}

export const MoMoPayment: React.FC<MoMoPaymentProps> = ({ order, onSuccess, onError }) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if returning from MoMo
    const urlParams = new URLSearchParams(window.location.search);
    const resultCode = urlParams.get('resultCode');
    const orderId = urlParams.get('orderId');

    if (resultCode && orderId) {
      if (resultCode === '0') {
        onSuccess(orderId);
      } else {
        onError('Thanh toán MoMo thất bại');
      }
    }
  }, [onSuccess, onError]);

  const handlePayment = async () => {
    setLoading(true);
    try {
      const result = await createMoMoPayment(order._id, order.total);
      // Redirect to MoMo payment page
      window.location.href = result.payUrl;
    } catch (error: any) {
      onError(error.message || 'Không thể tạo thanh toán MoMo');
      setLoading(false);
    }
  };

  return (
    <div className="payment-component">
      <div className="payment-component__info">
        <div className="payment-component__icon">📱</div>
        <h3 className="payment-component__title">Thanh Toán Qua Ví MoMo</h3>
        <p className="payment-component__description">
          Bạn sẽ được chuyển đến trang thanh toán MoMo để hoàn tất giao dịch.
          Số tiền thanh toán:{' '}
          <strong>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.total)}</strong>
        </p>
      </div>

      <button
        className="payment-component__button payment-component__button--momo"
        onClick={handlePayment}
        disabled={loading}
      >
        {loading ? 'Đang xử lý...' : 'Thanh Toán Với MoMo'}
      </button>
    </div>
  );
};
