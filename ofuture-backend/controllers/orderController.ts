// controllers/orderController.ts
// ─────────────────────────────────────────────
// Order lifecycle controller.
//
// Buyer:   createOrder, getMyOrders, getOrderById,
//          cancelOrder, confirmDelivery
// Seller:  getSellerOrders, markShipped
// Admin:   getAllOrders, adminUpdateStatus
//
// Every order creation runs inside a MySQL transaction:
//   1. Lock product row (SELECT … FOR UPDATE)
//   2. Verify stock
//   3. Decrement stock
//   4. Insert order row
//   5. Create escrow record (pending)
//   COMMIT or ROLLBACK
// ─────────────────────────────────────────────

import { Request, Response } from 'express';
import { pool } from '../config/db';
import ProductModel from '../models/productModel';
import OrderModel from '../models/orderModel';
import EscrowModel from '../models/escrowModel';
import { LogModel, LOG_EVENTS } from '../models/logModel';
import logger from '../utils/logger';

interface OrderRequest extends Request {
  user?: any;
  meta?: any;
}

// ── Shared log context ────────────────────────
const ctx = (req: OrderRequest) => ({
  userId    : req.user?.id ?? null,
  ipAddress : req.meta?.ip,
  userAgent : req.meta?.userAgent,
  endpoint  : req.originalUrl,
  method    : req.method,
});

// ─────────────────────────────────────────────
// VALID STATUS TRANSITIONS
// Each key is the current status;
// value is the set of statuses it may move to.
// ─────────────────────────────────────────────
const STATUS_TRANSITIONS: Record<string, Set<string>> = {
  pending   : new Set(['paid', 'cancelled']),
  paid      : new Set(['shipped', 'cancelled']),
  shipped   : new Set(['completed']),
  completed : new Set([]),           // terminal
  cancelled : new Set([]),           // terminal
  refunded  : new Set([]),           // terminal
};

/**
 * canTransition(from, to)
 * Returns true if the status move is allowed.
 */
const canTransition = (from: string, to: string) =>
  STATUS_TRANSITIONS[from]?.has(to) ?? false;

// ─────────────────────────────────────────────
// POST /api/orders
// Buyer places a new order.
// Entire flow is wrapped in a DB transaction.
// ─────────────────────────────────────────────
const createOrder = async (req: OrderRequest, res: Response): Promise<any> => {
  const { productId, quantity, shippingAddress, notes } = req.body;
  const buyerId = req.user.id;

  // Acquire a connection for the transaction
  const conn: any = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // ── 1. Lock the product row against concurrent orders ──
    const [productRows]: any = await conn.execute(
      `SELECT id, seller_id, name, price, stock_quantity, status
       FROM products
       WHERE id = ? AND status = 'active'
       FOR UPDATE`,           // row-level lock held until COMMIT/ROLLBACK
      [productId]
    );

    const product = productRows[0];

    if (!product) {
      await conn.rollback();
      return res.status(404).json({
        success : false,
        message : 'Product not found or no longer available.',
      });
    }

    // ── 2. Prevent buyer purchasing their own product ──────
    if (product.seller_id === buyerId) {
      await conn.rollback();
      return res.status(400).json({
        success : false,
        message : 'You cannot purchase your own product.',
      });
    }

    // ── 3. Stock check ─────────────────────────────────────
    if (product.stock_quantity < quantity) {
      await conn.rollback();
      return res.status(409).json({
        success  : false,
        message  : `Insufficient stock. Available: ${product.stock_quantity}, requested: ${quantity}.`,
        available: product.stock_quantity,
      });
    }

    // ── 4. Calculate totals ────────────────────────────────
    const unitPrice   = parseFloat(product.price);
    const totalAmount = parseFloat((unitPrice * quantity).toFixed(2));

    // ── 5. Decrement stock atomically ──────────────────────
    await conn.execute(
      `UPDATE products
       SET stock_quantity = stock_quantity - ?
       WHERE id = ? AND stock_quantity >= ?`,
      [quantity, productId, quantity]
    );

    // ── 6. Insert order ────────────────────────────────────
    const [orderResult]: any = await conn.execute(
      `INSERT INTO orders
         (buyer_id, seller_id, product_id, quantity,
          unit_price, total_amount, shipping_address, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        buyerId,
        product.seller_id,
        productId,
        quantity,
        unitPrice,
        totalAmount,
        JSON.stringify(shippingAddress),
        notes ?? null,
      ]
    );

    // ── 7. Fetch the new order UUID ────────────────────────
    const [[newOrderRow]]: any = await conn.execute(
      'SELECT id FROM orders WHERE buyer_id = ? AND product_id = ? ORDER BY created_at DESC LIMIT 1',
      [buyerId, productId]
    );
    const orderId = newOrderRow.id;

    // ── 8. Create a PENDING escrow record ─────────────────
    // Money not yet held — escrow moves to "held" when buyer pays (Phase 7).
    const platformFee = parseFloat((totalAmount * 0.025).toFixed(2));
    const netAmount   = parseFloat((totalAmount - platformFee).toFixed(2));

    await conn.execute(
      `INSERT INTO escrow_transactions
         (order_id, buyer_id, seller_id, amount, platform_fee, net_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [orderId, buyerId, product.seller_id, totalAmount, platformFee, netAmount]
    );

    // ── 9. COMMIT ──────────────────────────────────────────
    await conn.commit();

    // ── 10. Audit log ──────────────────────────────────────
    await LogModel.write({
      ...ctx(req),
      eventType : LOG_EVENTS.ORDER_CREATED,
      severity  : 'info',
      message   : `Order created: id=${orderId} product="${product.name}" qty=${quantity} total=${totalAmount}`,
      payload   : { orderId, productId, quantity, totalAmount },
    });

    logger.info(`Order created: id=${orderId} buyer=${buyerId}`);

    res.status(201).json({
      success : true,
      message : 'Order placed successfully. Please proceed to payment.',
      data    : {
        orderId,
        productName  : product.name,
        quantity,
        unitPrice,
        totalAmount,
        platformFee,
        netToSeller : netAmount,
        status       : 'pending',
        nextStep     : 'POST /api/escrow/pay to complete payment and lock funds in escrow.',
      },
    });

  } catch (err) {
    await conn.rollback();
    logger.error('createOrder transaction error:', err);
    res.status(500).json({ success: false, message: 'Order placement failed. Please try again.' });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// GET /api/orders/my
// Buyer views their own orders.
// ─────────────────────────────────────────────
const getMyOrders = async (req: OrderRequest, res: Response): Promise<any> => {
  try {
    const { page = '1', limit = '20', status } = req.query;

    const orders = await OrderModel.findByBuyer(req.user.id, {
      page  : Math.max(1, parseInt(page as string)  || 1),
      limit : Math.min(100, parseInt(limit as string) || 20),
      status: status as string,
    });

    res.status(200).json({
      success : true,
      data    : orders.map(formatOrderSummary),
    });

  } catch (err) {
    logger.error('getMyOrders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/orders/:id
// Buyer OR Seller sees a single order.
// Buyer can only see their own; seller can only see their sales.
// Admin sees all.
// ─────────────────────────────────────────────
const getOrderById = async (req: OrderRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const order = await OrderModel.findById(id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Enforce visibility: only the buyer, seller, or admin
    const { role, id: userId } = req.user;
    if (role !== 'admin' && order.buyer_id !== userId && order.seller_id !== userId) {
      return res.status(403).json({
        success : false,
        message : 'Access denied. This order does not belong to you.',
      });
    }

    res.status(200).json({
      success : true,
      data    : formatOrderDetail(order),
    });

  } catch (err) {
    logger.error('getOrderById error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch order.' });
  }
};

// ─────────────────────────────────────────────
// GET /api/orders/seller
// Seller views incoming orders for their products.
// ─────────────────────────────────────────────
const getSellerOrders = async (req: OrderRequest, res: Response): Promise<any> => {
  try {
    const { page = '1', limit = '20', status } = req.query;

    const orders = await OrderModel.findBySeller(req.user.id, {
      page  : Math.max(1, parseInt(page as string)  || 1),
      limit : Math.min(100, parseInt(limit as string) || 20),
      status: status as string,
    });

    res.status(200).json({
      success : true,
      data    : orders.map(formatOrderSummary),
    });

  } catch (err) {
    logger.error('getSellerOrders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch seller orders.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/orders/:id/cancel
// Buyer cancels their own pending/paid order.
// Seller can also cancel (e.g. out-of-stock situation).
// Stock is restored; escrow is flagged for refund.
// ─────────────────────────────────────────────
const cancelOrder = async (req: OrderRequest, res: Response): Promise<any> => {
  const id = req.params.id as string;
  const { reason } = req.body;

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock order row
    const [[order]]: any = await conn.execute(
      'SELECT * FROM orders WHERE id = ? FOR UPDATE',
      [id]
    );

    if (!order) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Visibility: buyer, seller, or admin
    const { role, id: userId } = req.user;
    if (role !== 'admin' && order.buyer_id !== userId && order.seller_id !== userId) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // Status transition check
    if (!canTransition(order.status, 'cancelled')) {
      await conn.rollback();
      return res.status(409).json({
        success : false,
        message : `Cannot cancel an order with status "${order.status}".`,
        hint    : order.status === 'shipped'
          ? 'Order is already shipped. Contact support to resolve.'
          : `Order is "${order.status}" — no further cancellations allowed.`,
      });
    }

    // Update order status
    await conn.execute(
      `UPDATE orders
       SET status = 'cancelled', cancelled_at = NOW(), notes = COALESCE(?, notes)
       WHERE id = ?`,
      [reason ?? null, id]
    );

    // Restore stock
    await conn.execute(
      'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
      [order.quantity, order.product_id]
    );

    // Mark escrow for refund (if it was held)
    await conn.execute(
      `UPDATE escrow_transactions
       SET status = 'refunded', refunded_at = NOW(), refund_reason = ?
       WHERE order_id = ? AND status IN ('pending','held')`,
      [reason ?? 'Order cancelled by user', id]
    );

    await conn.commit();

    await LogModel.write({
      ...ctx(req),
      eventType : LOG_EVENTS.ORDER_CANCELLED,
      severity  : 'warn',
      message   : `Order cancelled: id=${id} by userId=${userId} reason="${reason ?? 'none'}"`,
    });

    res.status(200).json({
      success : true,
      message : 'Order cancelled successfully. Any held funds will be refunded.',
      data    : { orderId: id, status: 'cancelled' },
    });

  } catch (err) {
    await conn.rollback();
    logger.error('cancelOrder error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel order.' });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// POST /api/orders/:id/ship
// Seller marks an order as shipped.
// Order must be in "paid" status (escrow is held).
// ─────────────────────────────────────────────
const markShipped = async (req: OrderRequest, res: Response): Promise<any> => {
  const id = req.params.id as string;
  const { trackingNumber, carrier } = req.body;

  try {
    const order: any = await OrderModel.findById(id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Only this order's seller (or admin) can mark shipped
    if (req.user.role !== 'admin' && order.seller_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (!canTransition(order.status, 'shipped')) {
      return res.status(409).json({
        success : false,
        message : `Cannot mark as shipped. Current status: "${order.status}". Order must be "paid" first.`,
      });
    }

    const notes = trackingNumber
      ? `Shipped via ${carrier ?? 'carrier'} — tracking: ${trackingNumber}`
      : null;

    await OrderModel.updateStatus(id, 'shipped', { notes });

    res.status(200).json({
      success : true,
      message : 'Order marked as shipped.',
      data    : {
        orderId        : id,
        status         : 'shipped',
        trackingNumber : trackingNumber ?? null,
        carrier        : carrier ?? null,
        nextStep       : 'Buyer must confirm delivery to release escrow funds.',
      },
    });

  } catch (err) {
    logger.error('markShipped error:', err);
    res.status(500).json({ success: false, message: 'Failed to update shipping status.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/orders/:id/confirm-delivery
// Buyer confirms they received the order.
// This triggers escrow release in Phase 7.
// ─────────────────────────────────────────────
const confirmDelivery = async (req: OrderRequest, res: Response): Promise<any> => {
  const id = req.params.id as string;

  const conn: any = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]]: any = await conn.execute(
      'SELECT * FROM orders WHERE id = ? FOR UPDATE',
      [id]
    );

    if (!order) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Only the buyer confirms delivery
    if (order.buyer_id !== req.user.id) {
      await conn.rollback();
      return res.status(403).json({
        success : false,
        message : 'Only the buyer can confirm delivery.',
      });
    }

    if (!canTransition(order.status, 'completed')) {
      await conn.rollback();
      return res.status(409).json({
        success : false,
        message : `Cannot confirm delivery. Current status: "${order.status}". Order must be "shipped" first.`,
      });
    }

    // Mark order as completed
    await conn.execute(
      `UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [id]
    );

    // Release escrow funds to seller
    await conn.execute(
      `UPDATE escrow_transactions
       SET status = 'released', released_at = NOW(),
           release_reason = 'Buyer confirmed delivery'
       WHERE order_id = ? AND status = 'held'`,
      [id]
    );

    await conn.commit();

    await LogModel.write({
      ...ctx(req),
      eventType : LOG_EVENTS.ESCROW_RELEASED,
      severity  : 'info',
      message   : `Delivery confirmed for order id=${id}. Escrow released to seller.`,
    });

    res.status(200).json({
      success : true,
      message : 'Delivery confirmed. Payment has been released to the seller.',
      data    : { orderId: id, status: 'completed' },
    });

  } catch (err) {
    await conn.rollback();
    logger.error('confirmDelivery error:', err);
    res.status(500).json({ success: false, message: 'Failed to confirm delivery.' });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// GET /api/orders  (Admin)
// Admin views all orders with optional filters.
// ─────────────────────────────────────────────
const getAllOrders = async (req: OrderRequest, res: Response): Promise<any> => {
  try {
    const { page = '1', limit = '20', status } = req.query;

    const orders = await OrderModel.adminListAll({
      page  : Math.max(1, parseInt(page as string)  || 1),
      limit : Math.min(100, parseInt(limit as string) || 20),
      status: status as string,
    });

    res.status(200).json({
      success : true,
      data    : orders,
    });

  } catch (err) {
    logger.error('getAllOrders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
};

// ─────────────────────────────────────────────
// PUT /api/orders/:id/status  (Admin)
// Admin forces any status transition.
// ─────────────────────────────────────────────
const adminUpdateStatus = async (req: OrderRequest, res: Response): Promise<any> => {
  const id = req.params.id as string;
  const { status, reason } = req.body;

  const VALID_STATUSES = ['pending','paid','shipped','completed','cancelled','refunded'];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success : false,
      message : `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}.`,
    });
  }

  try {
    const order: any = await OrderModel.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    await OrderModel.updateStatus(id, status, { notes: reason });

    await LogModel.write({
      ...ctx(req),
      eventType : LOG_EVENTS.SUSPICIOUS_ACTIVITY,
      severity  : 'warn',
      message   : `Admin forced order status: id=${id} "${order.status}" → "${status}" reason="${reason ?? 'none'}"`,
    });

    res.status(200).json({
      success : true,
      message : `Order status updated to "${status}".`,
      data    : { orderId: id, previousStatus: order.status, newStatus: status },
    });

  } catch (err) {
    logger.error('adminUpdateStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
};

// ─────────────────────────────────────────────
// Private formatters
// ─────────────────────────────────────────────
const formatOrderSummary = (o: any) => ({
  id             : o.id,
  status         : o.status,
  quantity       : o.quantity,
  unitPrice      : parseFloat(o.unit_price),
  totalAmount    : parseFloat(o.total_amount),
  productName    : o.product_name,
  productId      : o.product_id,
  sellerUsername : o.seller_username,
  buyerUsername  : o.buyer_username,
  createdAt      : o.created_at,
});

const formatOrderDetail = (o: any) => ({
  id              : o.id,
  status          : o.status,
  quantity        : o.quantity,
  unitPrice       : parseFloat(o.unit_price),
  totalAmount     : parseFloat(o.total_amount),
  shippingAddress : safeParseJson(o.shipping_address),
  notes           : o.notes,
  buyer           : { id: o.buyer_id,  username: o.buyer_username,  email: o.buyer_email },
  seller          : { id: o.seller_id, username: o.seller_username },
  product         : { id: o.product_id, name: o.product_name },
  escrow          : { status: o.escrow_status, amount: o.escrow_amount
                        ? parseFloat(o.escrow_amount) : null },
  cancelledAt     : o.cancelled_at,
  completedAt     : o.completed_at,
  createdAt       : o.created_at,
  updatedAt       : o.updated_at,
});

const safeParseJson = (value: any, fallback: any = null) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); }
  catch { return fallback; }
};

export = {
  createOrder,
  getMyOrders,
  getOrderById,
  getSellerOrders,
  cancelOrder,
  markShipped,
  confirmDelivery,
  getAllOrders,
  adminUpdateStatus,
};