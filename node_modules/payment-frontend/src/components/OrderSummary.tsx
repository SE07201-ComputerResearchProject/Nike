import React from 'react';
import { Order } from '../types';
import './OrderSummary.css';

interface OrderSummaryProps {
  order: Order;
}

export const OrderSummary: React.FC<OrderSummaryProps> = ({ order }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(amount);
  };

  return (
    <div className="order-summary">
      <h2 className="order-summary__title">Thông Tin Đơn Hàng</h2>

      {/* Product List */}
      <div className="order-summary__section">
        <h3 className="order-summary__section-title">Sản Phẩm</h3>
        <div className="order-summary__items">
          {order.items.map((item, index) => (
            <div key={index} className="order-item">
              <img src={item.image} alt={item.name} className="order-item__image" />
              <div className="order-item__details">
                <div className="order-item__name">{item.name}</div>
                <div className="order-item__quantity">Số lượng: {item.quantity}</div>
              </div>
              <div className="order-item__price">{formatCurrency(item.price * item.quantity)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Price Summary */}
      <div className="order-summary__section">
        <div className="order-summary__row">
          <span>Tạm tính:</span>
          <span>{formatCurrency(order.subtotal)}</span>
        </div>
        <div className="order-summary__row">
          <span>Phí vận chuyển:</span>
          <span>{formatCurrency(order.shippingFee)}</span>
        </div>
        <div className="order-summary__row">
          <span>Thuế:</span>
          <span>{formatCurrency(order.tax)}</span>
        </div>
        <div className="order-summary__row order-summary__row--total">
          <span>Tổng cộng:</span>
          <span>{formatCurrency(order.total)}</span>
        </div>
      </div>

      {/* Shipping Address */}
      <div className="order-summary__section">
        <h3 className="order-summary__section-title">Địa Chỉ Giao Hàng</h3>
        <div className="order-summary__address">
          <div className="order-summary__address-name">{order.shippingAddress.fullName}</div>
          <div className="order-summary__address-phone">{order.shippingAddress.phone}</div>
          <div className="order-summary__address-detail">
            {order.shippingAddress.address}, {order.shippingAddress.ward},{' '}
            {order.shippingAddress.district}, {order.shippingAddress.city}
          </div>
        </div>
      </div>

      {/* Customer Info */}
      <div className="order-summary__section">
        <h3 className="order-summary__section-title">Thông Tin Liên Hệ</h3>
        <div className="order-summary__customer">
          <div>Tên: {order.customerInfo.name}</div>
          <div>Email: {order.customerInfo.email}</div>
          <div>Số điện thoại: {order.customerInfo.phone}</div>
        </div>
      </div>
    </div>
  );
};
