import React from 'react';
import { PaymentMethod } from '../types';
import './PaymentMethodSelector.css';

interface PaymentMethodSelectorProps {
  selectedMethod: PaymentMethod;
  onMethodChange: (method: PaymentMethod) => void;
}

export const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  selectedMethod,
  onMethodChange,
}) => {
  const methods = [
    {
      id: PaymentMethod.COD,
      name: 'Thanh toán khi nhận hàng (COD)',
      description: 'Thanh toán bằng tiền mặt khi nhận hàng',
      icon: '💵',
    },
    {
      id: PaymentMethod.MOMO,
      name: 'Ví MoMo',
      description: 'Thanh toán qua ví điện tử MoMo',
      icon: '📱',
    },
    {
      id: PaymentMethod.QR,
      name: 'Quét mã QR',
      description: 'Thanh toán qua ngân hàng bằng mã QR',
      icon: '📷',
    },
  ];

  return (
    <div className="payment-method-selector">
      <h3 className="payment-method-selector__title">Chọn Phương Thức Thanh Toán</h3>
      <div className="payment-method-selector__options">
        {methods.map((method) => (
          <div
            key={method.id}
            className={`payment-method-option ${
              selectedMethod === method.id ? 'payment-method-option--active' : ''
            }`}
            onClick={() => onMethodChange(method.id)}
          >
            <div className="payment-method-option__icon">{method.icon}</div>
            <div className="payment-method-option__content">
              <div className="payment-method-option__name">{method.name}</div>
              <div className="payment-method-option__description">{method.description}</div>
            </div>
            <div className="payment-method-option__radio">
              <input
                type="radio"
                checked={selectedMethod === method.id}
                onChange={() => onMethodChange(method.id)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
