import { apiClient, retryRequest } from './client';
import { Order } from '../types';

export interface CreateOrderData {
  items: Array<{
    productId: string;
    name: string;
    image: string;
    quantity: number;
    price: number;
  }>;
  shippingFee: number;
  tax: number;
  shippingAddress: {
    fullName: string;
    phone: string;
    address: string;
    city: string;
    district: string;
    ward: string;
  };
  customerInfo: {
    name: string;
    email: string;
    phone: string;
  };
  paymentMethod: string;
}

/**
 * Create a new order
 */
export const createOrder = async (orderData: CreateOrderData): Promise<Order> => {
  return retryRequest(async () => {
    const response = await apiClient.post('/orders', orderData);
    return response.data.data;
  });
};

/**
 * Get order by ID
 */
export const getOrder = async (orderId: string): Promise<Order> => {
  return retryRequest(async () => {
    const response = await apiClient.get(`/orders/${orderId}`);
    return response.data.data;
  });
};
