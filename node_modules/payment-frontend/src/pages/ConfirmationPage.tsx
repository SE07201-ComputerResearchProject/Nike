import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Order } from '../types';
import { getOrder } from '../api/orderApi';
import './ConfirmationPage.css';

export const ConfirmationPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orderId) {
      loadOrder(orderId);
    }
  }, [orderId]);

  const loadOrder = async (id: string) => {
    try {
      setLoading(true);
      const orderData = await getOrder(id);
      setOrder(orderData);
    } catch (err) {
      console.error('Error loading order:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: 'Chờ giao hàng',
      awaiting_payment: 'Chờ thanh toán',
      paid: 'Đã thanh toán',
      processing: 'Đang xử lý',
      shipping: 'Đang giao hàng',
      delivered: 'Đã giao hàng',
      cancelled: 'Đã hủy',
      payment_failed: 'Thanh toán thất bại',
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colorMap: Record<string, string> = {
      pending: '#ff9800',
      awaiting_payment: '#ff9800',
      paid: '#4caf50',
      processing: '#2196f3',
      shipping: '#2196f3',
      delivered: '#4caf50',
      cancelled: '#f44336',
      payment_failed: '#f44336',
    };
    return colorMap[status] || '#666';
  };

  if (loading) {
    return (
      <div className="confirmation-page">
        <div className="confirmation-page__loading">Đang tải...</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="confirmation-page">
        <div className="confirmation-page__error">Không tìm thấy đơn hàng</div>
      </div>
    );
  }

  return (
    <div className="confirmation-page">
      <div className="confirmation-page__container">
        <div className="confirmation-page__success-icon">✓</div>
        
        <h1 className="confirmation-page__title">Đặt Hàng Thành Công!</h1>
        
        <p className="confirmation-page__message">
          Cảm ơn bạn đã đặt hàng. Chúng tôi sẽ xử lý đơn hàng của bạn trong thời gian sớm nhất.
        </p>

        <div className="confirmation-page__order-info">
          <div className="confirmation-page__info-row">
            <span className="confirmation-page__label">Mã đơn hàng:</span>
            <span className="confirmation-page__value confirmation-page__value--order-number">
              {order.orderNumber}
            </span>
          </div>
          
          <div className="confirmation-page__info-row">
            <span className="confirmation-page__label">Trạng thái:</span>
            <span 
              className="confirmation-page__value confirmation-page__status"
              style={{ color: getStatusColor(order.status) }}
            >
              {getStatusText(order.status)}
            </span>
          </div>
          
          <div className="confirmation-page__info-row">
            <span className="confirmation-page__label">Tổng tiền:</span>
            <span className="confirmation-page__value confirmation-page__value--amount">
              {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.total)}
            </span>
          </div>
          
          <div className="confirmation-page__info-row">
            <span className="confirmation-page__label">Phương thức thanh toán:</span>
            <span className="confirmation-page__value">
              {order.paymentMethod === 'cod' && 'Thanh toán khi nhận hàng'}
              {order.paymentMethod === 'momo' && 'Ví MoMo'}
              {order.paymentMethod === 'qr' && 'Quét mã QR'}
            </span>
          </div>
        </div>

        <div className="confirmation-page__order-summary">
          <h3 className="confirmation-page__summary-title">Thông tin đơn hàng</h3>
          
          <div className="confirmation-page__items">
            {order.items.map((item, index) => (
              <div key={index} className="confirmation-page__item">
                <img src={item.image} alt={item.name} className="confirmation-page__item-image" />
                <div className="confirmation-page__item-details">
                  <div className="confirmation-page__item-name">{item.name}</div>
                  <div className="confirmation-page__item-quantity">Số lượng: {item.quantity}</div>
                </div>
                <div className="confirmation-page__item-price">
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.price * item.quantity)}
                </div>
              </div>
            ))}
          </div>

          <div className="confirmation-page__address">
            <h4>Địa chỉ giao hàng:</h4>
            <p>
              {order.shippingAddress.fullName} - {order.shippingAddress.phone}<br />
              {order.shippingAddress.address}, {order.shippingAddress.ward},{' '}
              {order.shippingAddress.district}, {order.shippingAddress.city}
            </p>
          </div>
        </div>

        <div className="confirmation-page__actions">
          <button 
            className="confirmation-page__button confirmation-page__button--primary"
            onClick={() => navigate('/')}
          >
            Quay Về Trang Chủ
          </button>
          <button 
            className="confirmation-page__button confirmation-page__button--secondary"
            onClick={() => navigate(`/orders/${order._id}`)}
          >
            Xem Chi Tiết Đơn Hàng
          </button>
        </div>
      </div>
    </div>
  );
};
