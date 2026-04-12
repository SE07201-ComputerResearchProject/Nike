// services/orderService.ts
// ─────────────────────────────────────────────
// Order Service — Multi-item order business logic
// Handles order creation, calculation, and state management
// ─────────────────────────────────────────────

import { pool } from '../config/db';
import OrderItemModel from '../models/orderItemModel';
import OrderHistoryModel from '../models/orderHistoryModel';
import logger from '../utils/logger';

interface CreateMultiItemOrderParams {
  buyer_id: string;
  seller_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
  }>;
  shipping_fee?: number;
  discount_amount?: number;
  shipping_address?: any;
}

/**
 * Create a multi-item order
 * 1. Create order record with calculated totals
 * 2. Create order_items for each product
 * 3. Record initial status in order_histories
 */
const createMultiItemOrder = async (params: CreateMultiItemOrderParams) => {
  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Calculate totals
    let total_amount = 0;
    params.items.forEach(item => {
      total_amount += item.quantity * item.unit_price;
    });

    const shipping_fee = params.shipping_fee || 0;
    const discount_amount = params.discount_amount || 0;
    const final_total_amount = total_amount + shipping_fee - discount_amount;

    // Create order
    const order_id = require('crypto').randomUUID();
    await conn.execute(
      `INSERT INTO orders 
       (id, buyer_id, seller_id, total_amount, shipping_fee, discount_amount, final_total_amount, shipping_address, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        order_id,
        params.buyer_id,
        params.seller_id,
        total_amount,
        shipping_fee,
        discount_amount,
        final_total_amount,
        params.shipping_address ? JSON.stringify(params.shipping_address) : null
      ]
    );

    // Create order items
    for (const item of params.items) {
      const item_id = require('crypto').randomUUID();
      const subtotal = item.quantity * item.unit_price;

      await conn.execute(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item_id, order_id, item.product_id, item.quantity, item.unit_price, subtotal]
      );
    }

    // Record initial status
    const history_id = require('crypto').randomUUID();
    await conn.execute(
      `INSERT INTO order_histories (id, order_id, status, reason)
       VALUES (?, ?, 'pending', 'Order created')`,
      [history_id, order_id]
    );

    await conn.commit();

    logger.info(`Order created: ${order_id} (${params.items.length} items)`);

    return {
      order_id,
      total_amount,
      shipping_fee,
      discount_amount,
      final_total_amount,
      item_count: params.items.length
    };
  } catch (error) {
    await conn.rollback();
    logger.error('createMultiItemOrder error:', error);
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Update order totals based on items
 */
const recalculateOrderTotals = async (order_id: string): Promise<void> => {
  const total_amount = await OrderItemModel.calculateOrderTotal(order_id);
  
  // Fetch current order to get shipping and discount
  const [[order]]: any = await pool.execute(
    `SELECT shipping_fee, discount_amount FROM orders WHERE id = ?`,
    [order_id]
  );

  if (!order) throw new Error('Order not found');

  const final_total_amount = total_amount + parseFloat(order.shipping_fee) - parseFloat(order.discount_amount);

  await pool.execute(
    `UPDATE orders SET total_amount = ?, final_total_amount = ? WHERE id = ?`,
    [total_amount, final_total_amount, order_id]
  );
};

/**
 * Update order status and record in history
 */
const updateStatus = async (
  order_id: string,
  new_status: string,
  reason?: string,
  created_by?: string
): Promise<void> => {
  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Update order status
    await conn.execute(
      `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?`,
      [new_status, order_id]
    );

    // Record in history
    const history_id = require('crypto').randomUUID();
    await conn.execute(
      `INSERT INTO order_histories (id, order_id, status, reason, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [history_id, order_id, new_status, reason || null, created_by || null]
    );

    await conn.commit();

    logger.info(`Order ${order_id} status changed to ${new_status}`);
  } catch (error) {
    await conn.rollback();
    logger.error('updateStatus error:', error);
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Get order with items and history
 */
const getOrderWithDetails = async (order_id: string): Promise<any> => {
  const [[order]]: any = await pool.execute(
    `SELECT * FROM orders WHERE id = ?`,
    [order_id]
  );

  if (!order) return null;

  // Get items with product details
  const items = await OrderItemModel.getWithProducts(order_id);

  // Get status history
  const history = await OrderHistoryModel.getWithUsers(order_id);

  return {
    ...order,
    items,
    history,
    final_total_amount_formatted: `${Number(order.final_total_amount).toLocaleString('vi-VN')} đ`
  };
};

/**
 * Apply shipping fee to order
 */
const applyShippingFee = async (order_id: string, shipping_fee: number): Promise<void> => {
  const [[order]]: any = await pool.execute(
    `SELECT total_amount, discount_amount FROM orders WHERE id = ?`,
    [order_id]
  );

  if (!order) throw new Error('Order not found');

  const final_total_amount = parseFloat(order.total_amount) + shipping_fee - parseFloat(order.discount_amount);

  await pool.execute(
    `UPDATE orders SET shipping_fee = ?, final_total_amount = ? WHERE id = ?`,
    [shipping_fee, final_total_amount, order_id]
  );
};

/**
 * Apply discount/voucher to order
 */
const applyDiscount = async (order_id: string, discount_amount: number): Promise<void> => {
  const [[order]]: any = await pool.execute(
    `SELECT total_amount, shipping_fee FROM orders WHERE id = ?`,
    [order_id]
  );

  if (!order) throw new Error('Order not found');

  const final_total_amount = parseFloat(order.total_amount) + parseFloat(order.shipping_fee) - discount_amount;

  await pool.execute(
    `UPDATE orders SET discount_amount = ?, final_total_amount = ? WHERE id = ?`,
    [discount_amount, final_total_amount, order_id]
  );
};

/**
 * Get time order spent in each status
 */
const getOrderTimeline = async (order_id: string): Promise<any[]> => {
  return OrderHistoryModel.getTimeline(order_id);
};

export = {
  createMultiItemOrder,
  recalculateOrderTotals,
  updateStatus,
  getOrderWithDetails,
  applyShippingFee,
  applyDiscount,
  getOrderTimeline,
};
