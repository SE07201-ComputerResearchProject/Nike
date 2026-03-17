import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Order, PaymentMethod } from '../types';
import { getOrder } from '../api/orderApi';
import { OrderSummary } from '../components/OrderSummary';
import { PaymentMethodSelector } from '../components/PaymentMethodSelector';
import { CODPayment } from '../components/CODPayment';
import { MoMoPayment } from '../components/MoMoPayment';
import { QRPayment } from '../components/QRPayment';
import './PaymentPage.css';

export const PaymentPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  
  const [order, setOrder] = useState<Order | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(PaymentMethod.COD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải thông tin đơn hàng');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = (orderId: string) => {
    navigate(`/confirmation/${orderId}`);
  };

  const handlePaymentError = (errorMessage: string) => {
    setError(errorMessage);
  };

  const handleMethodChange = (method: PaymentMethod) => {
    setSelectedMethod(method);
    setError(null);
  };

  if (loading) {
    return (
      <div className="payment-page">
        <div className="payment-page__loading">Đang tải...</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="payment-page">
        <div className="payment-page__error">Không tìm thấy đơn hàng</div>
      </div>
    );
  }

  return (
    <div className="payment-page">
      <div className="payment-page__container">
        <h1 className="payment-page__title">Thanh Toán</h1>

        {error && (
          <div className="payment-page__error-banner">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className="payment-page__content">
          <div className="payment-page__left">
            <OrderSummary order={order} />
          </div>

          <div className="payment-page__right">
            <PaymentMethodSelector
              selectedMethod={selectedMethod}
              onMethodChange={handleMethodChange}
            />

            <div className="payment-page__method-content">
              {selectedMethod === PaymentMethod.COD && (
                <CODPayment
                  order={order}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                />
              )}
              {selectedMethod === PaymentMethod.MOMO && (
                <MoMoPayment
                  order={order}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                />
              )}
              {selectedMethod === PaymentMethod.QR && (
                <QRPayment
                  order={order}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
