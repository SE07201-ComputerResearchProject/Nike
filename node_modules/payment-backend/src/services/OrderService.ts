import { OrderModel, OrderDocument } from '../models/Order.js';
import { Order, OrderStatus, PaymentMethod } from '../models/types.js';

export interface CreateOrderDTO {
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
  paymentMethod: PaymentMethod;
}

export class OrderService {
  /**
   * Validate order data
   */
  async validateOrder(orderData: CreateOrderDTO): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Validate items
    if (!orderData.items || orderData.items.length === 0) {
      errors.push('Order must have at least one item');
    }

    if (orderData.items) {
      orderData.items.forEach((item, index) => {
        if (!item.productId) {
          errors.push(`Item ${index + 1}: productId is required`);
        }
        if (!item.name) {
          errors.push(`Item ${index + 1}: name is required`);
        }
        if (item.quantity <= 0) {
          errors.push(`Item ${index + 1}: quantity must be greater than 0`);
        }
        if (item.price < 0) {
          errors.push(`Item ${index + 1}: price cannot be negative`);
        }
      });
    }

    // Validate fees
    if (orderData.shippingFee < 0) {
      errors.push('Shipping fee cannot be negative');
    }
    if (orderData.tax < 0) {
      errors.push('Tax cannot be negative');
    }

    // Validate shipping address
    if (!orderData.shippingAddress) {
      errors.push('Shipping address is required');
    } else {
      const requiredAddressFields = ['fullName', 'phone', 'address', 'city', 'district', 'ward'];
      requiredAddressFields.forEach((field) => {
        if (!orderData.shippingAddress[field as keyof typeof orderData.shippingAddress]) {
          errors.push(`Shipping address: ${field} is required`);
        }
      });
    }

    // Validate customer info
    if (!orderData.customerInfo) {
      errors.push('Customer info is required');
    } else {
      const requiredCustomerFields = ['name', 'email', 'phone'];
      requiredCustomerFields.forEach((field) => {
        if (!orderData.customerInfo[field as keyof typeof orderData.customerInfo]) {
          errors.push(`Customer info: ${field} is required`);
        }
      });
    }

    // Validate payment method
    if (!Object.values(PaymentMethod).includes(orderData.paymentMethod)) {
      errors.push('Invalid payment method');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Calculate order total
   */
  private calculateTotal(orderData: CreateOrderDTO): number {
    const subtotal = orderData.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return subtotal + orderData.shippingFee + orderData.tax;
  }

  /**
   * Calculate subtotal
   */
  private calculateSubtotal(orderData: CreateOrderDTO): number {
    return orderData.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  /**
   * Generate unique order number
   */
  private generateOrderNumber(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `ORD${timestamp}${random}`;
  }

  /**
   * Create a new order
   */
  async createOrder(orderData: CreateOrderDTO): Promise<Order> {
    // Validate order data
    const validation = await this.validateOrder(orderData);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    // Calculate totals
    const subtotal = this.calculateSubtotal(orderData);
    const total = this.calculateTotal(orderData);

    // Create order
    const order = new OrderModel({
      orderNumber: this.generateOrderNumber(),
      items: orderData.items,
      subtotal,
      shippingFee: orderData.shippingFee,
      tax: orderData.tax,
      total,
      shippingAddress: orderData.shippingAddress,
      customerInfo: orderData.customerInfo,
      status: OrderStatus.PENDING,
      paymentMethod: orderData.paymentMethod,
    });

    await order.save();

    return order.toObject() as Order;
  }

  /**
   * Get order by ID
   */
  async getOrderById(orderId: string): Promise<Order | null> {
    const order = await OrderModel.findById(orderId);
    if (!order) {
      return null;
    }
    return order.toObject() as Order;
  }

  /**
   * Update order status
   */
  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const order = await OrderModel.findByIdAndUpdate(
      orderId,
      {
        status,
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!order) {
      throw new Error('Order not found');
    }

    return order.toObject() as Order;
  }

  /**
   * Update order payment ID
   */
  async updateOrderPaymentId(orderId: string, paymentId: string): Promise<Order> {
    const order = await OrderModel.findByIdAndUpdate(
      orderId,
      {
        paymentId,
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!order) {
      throw new Error('Order not found');
    }

    return order.toObject() as Order;
  }
}
