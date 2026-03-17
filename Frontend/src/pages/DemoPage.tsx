import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createOrder } from '../api/orderApi';
import './DemoPage.css';

export const DemoPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const createDemoOrder = async () => {
    setLoading(true);
    try {
      const demoOrder = {
        items: [
          {
            productId: 'prod-001',
            name: 'iPhone 15 Pro Max',
            image: 'https://via.placeholder.com/150',
            quantity: 1,
            price: 29990000,
          },
          {
            productId: 'prod-002',
            name: 'AirPods Pro (2nd generation)',
            image: 'https://via.placeholder.com/150',
            quantity: 1,
            price: 6490000,
          },
        ],
        shippingFee: 50000,
        tax: 1824000,
        shippingAddress: {
          fullName: 'Nguyễn Văn A',
          phone: '0901234567',
          address: '123 Đường ABC',
          city: 'Hồ Chí Minh',
          district: 'Quận 1',
          ward: 'Phường Bến Nghé',
        },
        customerInfo: {
          name: 'Nguyễn Văn A',
          email: 'nguyenvana@example.com',
          phone: '0901234567',
        },
        paymentMethod: 'cod',
      };

      const order = await createOrder(demoOrder);
      navigate(`/payment/${order._id}`);
    } catch (error: any) {
      alert('Lỗi: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="demo-page">
      <div className="demo-page__container">
        <h1 className="demo-page__title">Demo Trang Thanh Toán</h1>
        <p className="demo-page__description">
          Click vào nút bên dưới để tạo đơn hàng demo và test các phương thức thanh toán
        </p>
        <button
          className="demo-page__button"
          onClick={createDemoOrder}
          disabled={loading}
        >
          {loading ? 'Đang tạo đơn hàng...' : 'Tạo Đơn Hàng Demo'}
        </button>
      </div>
    </div>
  );
};
