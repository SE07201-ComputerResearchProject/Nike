import React, { useState } from 'react';
import { Order } from '../types';
import { createOrder } from '../api/orderApi';
import './PaymentComponent.css';

interface CODPaymentProps {
  order: Order;
  onSuccess: (orderId: string) => void;
  onError: (error: string) => void;
}

export const CODPayment: React.FC<CODPaymentProps> = ({ order, onSuccess, onError }) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const result = await createOrder({
        ...order,
        paymentMethod: 'cod',
      });
      onSuccess(result._id);
    } catch (error: any) {
      onError(error.message || 'Không thể tạo đơn hàng');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="payment-component">
      <div className="payment-component__info">
        <div className="payment-component__icon">💵</div>
        <h3 className="payment-component__title">Thanh Toán Khi Nhận Hàng</h3>
        <p className="payment-component__description">
          Bạn sẽ thanh toán bằng tiền mặt khi nhận được hàng. Vui lòng chuẩn bị đủ số tiền{' '}
          <strong>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.total)}</strong>
        </p>
      </div>

      <button
        className="payment-component__button"
        onClick={handleConfirm}
        disabled={loading}
      >
        {loading ? 'Đang xử lý...' : 'Xác Nhận Đơn Hàng'}
      </button>
    </div>
  );
};
