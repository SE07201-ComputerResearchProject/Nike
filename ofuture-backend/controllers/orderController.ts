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
import NotificationService from '../services/notificationService';
import logger from '../utils/logger';
import orderService from '../services/orderService';
import WalletService from '../services/walletService';

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
// TỰ ĐỘNG TÁCH ĐƠN HÀNG THEO SELLER
// Entire flow is wrapped in a DB transaction.
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// POST /api/orders
// Tách đơn hàng tự động + Gắn Batch ID cho Thanh toán
// ─────────────────────────────────────────────
const createOrder = async (req: OrderRequest, res: Response): Promise<any> => {
  const { items, shippingAddress, notes } = req.body;
  const buyerId = req.user.id;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Cart items are required.' });
  }

  const conn: any = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const groupedOrders: Record<string, any> = {};
    let totalCartAmount = 0;
    const totalShippingFee = req.body.shippingFee || 0;
    const totalDiscount = req.body.discountAmount || 0;

    // 1. Duyệt qua từng sản phẩm để lấy thông tin và gom nhóm theo seller_id
    for (const item of items) {
      const [productRows]: any = await conn.execute(
        `SELECT id, seller_id, name, price, stock_quantity, status
         FROM products WHERE id = ? AND status = 'active' FOR UPDATE`,
        [item.productId]
      );

      const product = productRows[0];

      if (!product) throw new Error(`Sản phẩm ${item.productId} không tồn tại.`);
      if (product.seller_id === buyerId) throw new Error(`Bạn không thể tự mua sản phẩm của mình.`);
      if (product.stock_quantity < item.quantity) throw new Error(`Sản phẩm "${product.name}" không đủ số lượng.`);

      const sellerId = product.seller_id;
      const unitPrice = parseFloat(product.price);
      const subtotal = parseFloat((unitPrice * item.quantity).toFixed(2));
      totalCartAmount += subtotal;

      // Trừ stock ngay lập tức
      await conn.execute(
        `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
        [item.quantity, product.id]
      );

      if (!groupedOrders[sellerId]) {
        groupedOrders[sellerId] = { totalAmount: 0, items: [] };
      }
      groupedOrders[sellerId].totalAmount += subtotal;
      groupedOrders[sellerId].items.push({
        product_id: product.id, quantity: item.quantity, unit_price: unitPrice, subtotal
      });
    }

    // 2. Tạo BATCH ID để MoMo có thể thanh toán 1 lần cho tất cả đơn hàng này
    const batchId = require('crypto').randomUUID();
    const batchNote = notes ? `${notes} | BATCH:${batchId}` : `BATCH:${batchId}`;
    
    const sellerCount = Object.keys(groupedOrders).length;
    const splitShippingFee = parseFloat((totalShippingFee / sellerCount).toFixed(2));
    const splitDiscount = parseFloat((totalDiscount / sellerCount).toFixed(2));
    let finalTotalAmountAll = 0;

    // 3. Tách và lưu từng đơn hàng riêng biệt vào DB
    for (const sellerId in groupedOrders) {
      const group = groupedOrders[sellerId];
      const orderId = require('crypto').randomUUID();
      const finalTotalAmount = group.totalAmount + splitShippingFee - splitDiscount;
      finalTotalAmountAll += finalTotalAmount;

      await conn.execute(
        `INSERT INTO orders 
           (id, buyer_id, seller_id, total_amount, shipping_fee, discount_amount, final_total_amount, shipping_address, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [orderId, buyerId, sellerId, group.totalAmount, splitShippingFee, splitDiscount, finalTotalAmount, JSON.stringify(shippingAddress), batchNote]
      );

      for (const oi of group.items) {
        await conn.execute(
          `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [require('crypto').randomUUID(), orderId, oi.product_id, oi.quantity, oi.unit_price, oi.subtotal]
        );
      }

      const platformFee = parseFloat((finalTotalAmount * 0.025).toFixed(2));
      await conn.execute(
        `INSERT INTO escrow_transactions
           (order_id, buyer_id, seller_id, amount, platform_fee, net_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [orderId, buyerId, sellerId, finalTotalAmount, platformFee, finalTotalAmount - platformFee]
      );
    }

    await conn.commit();

    // 4. Trả về batchId để file script.js gọi API thanh toán MoMo/QR
    res.status(201).json({
      success: true,
      message: 'Đã tách và tạo đơn hàng thành công.',
      data: {
        orderId: batchId, // Gửi batchId đi thay vì 1 orderId đơn lẻ
        totalAmount: totalCartAmount,
        finalTotalAmount: finalTotalAmountAll,
        status: 'pending'
      }
    });

  } catch (err: any) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message || 'Lỗi khi tạo đơn hàng.' });
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
    const order = await orderService.getOrderWithDetails(id);

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

    // Restore stock cho tất cả các item trong đơn hàng
    const [orderItems]: any = await conn.execute(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
      [id]
    );
    for (const item of orderItems) {
      await conn.execute(
        'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
    }

    // Mark escrow for refund (if it was held)
    await conn.execute(
      `UPDATE escrow_transactions
       SET status = 'refunded', refunded_at = NOW(), refund_reason = ?
       WHERE order_id = ? AND status IN ('pending','held')`,
      [reason ?? 'Order cancelled by user', id]
    );

    await conn.commit();

    // Nếu đơn hàng đã trả tiền (paid/shipped), tiến hành hoàn tiền vào ví Buyer
    if (['paid', 'shipped'].includes(order.status)) {
      const [[escrow]]: any = await pool.execute(
        'SELECT * FROM escrow_transactions WHERE order_id = ? LIMIT 1', [id]
      );
      if (escrow) {
        try {
          await WalletService.refundFromEscrow(
            order.buyer_id,
            parseFloat(escrow.amount),
            escrow.id,
            id,
            reason ?? 'Hoàn tiền do hủy đơn hàng'
          );
        } catch (walletErr) {
          logger.error('Wallet refund to buyer failed:', walletErr);
        }
      }
    }

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

  if (!trackingNumber || !carrier) {
    return res.status(400).json({ 
      success: false, 
      message: 'Bắt buộc phải nhập Mã vận đơn (trackingNumber) và Đơn vị vận chuyển (carrier).' 
    });
  }

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

    // 1. Lấy thông tin Escrow để biết số tiền thực nhận của Seller (sau khi trừ phí)
    const [[escrow]]: any = await conn.execute(
      'SELECT * FROM escrow_transactions WHERE order_id = ? FOR UPDATE',
      [id]
    );

    // 2. Mark order as completed
    await conn.execute(
      `UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ?`,
      [id]
    );

    // 3. Release escrow funds
    await conn.execute(
      `UPDATE escrow_transactions
       SET status = 'released', released_at = NOW(),
           release_reason = 'Buyer confirmed delivery'
       WHERE order_id = ? AND status = 'held'`,
      [id]
    );

    // 4. CHUYỂN TIỀN VÀO VÍ SELLER
    if (escrow) {
      try {
        await WalletService.transferFromEscrowRelease(
          order.seller_id,
          parseFloat(escrow.net_amount), // Chuyển số tiền thực nhận (đã trừ phí)
          escrow.id,
          id,
          `Tiền bán hàng từ đơn ${id}`,
          conn
        );

        // Tùy chọn: Ghi nhận phí nền tảng hiển thị trong lịch sử ví Seller
        await WalletService.applyPlatformFee(
          order.seller_id,
          parseFloat(escrow.platform_fee),
          escrow.id,
          id
        );
      } catch (walletErr) {
        logger.error('Wallet release to seller failed:', walletErr);
      }
    }

    await conn.commit(); 

    const [[firstItem]]: any = await conn.execute(
      'SELECT p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ? LIMIT 1',
      [id]
    );

    // Notify seller that escrow has been released
    NotificationService.notifyEscrowReleased({
      orderId: id,
      sellerId: order.seller_id,
      productName: firstItem ? firstItem.name : 'Đơn hàng của bạn', // Đã sửa
      amount: order.final_total_amount || order.total_amount
    }).catch(err => logger.error('Notification error:', err));

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

    // Notify buyer and seller of status change
    NotificationService.notifyOrderStatusChange({
      orderId: id,
      buyerId: order.buyer_id,
      sellerId: order.seller_id,
      previousStatus: order.status,
      newStatus: status,
      productName: order.product_name,
      totalAmount: order.total_amount
    }).catch(err => logger.error('Notification error:', err));

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
const formatOrderSummary = (o: any) => {
  let productImage = null;
  try {
    if (o.image_urls) {
      const parsed = JSON.parse(o.image_urls);
      productImage = Array.isArray(parsed) ? parsed[0] : parsed;
    }
  } catch (e) {
    productImage = o.image_urls; // fallback if not JSON
  }
  
  return {
    id             : o.id,
    status         : o.status,
    quantity       : o.quantity,
    unitPrice      : parseFloat(o.unit_price),
    totalAmount    : parseFloat(o.total_amount),
    productName    : o.product_name,
    productImage   : productImage,
    productId      : o.product_id,
    sellerUsername : o.seller_username,
    buyerUsername  : o.buyer_username,
    createdAt      : o.created_at,
  };
};

const formatOrderDetail = (o: any) => ({
  id              : o.id,
  status          : o.status,
  quantity        : o.quantity || 0,
  unitPrice       : parseFloat(o.unit_price || '0'),
  totalAmount     : parseFloat(o.total_amount || o.final_total_amount || '0'),
  shippingAddress : safeParseJson(o.shipping_address),
  notes           : o.notes,
  buyer           : { id: o.buyer_id,  username: o.buyer_username,  email: o.buyer_email },
  seller          : { id: o.seller_id, username: o.seller_username },
  product         : { id: o.product_id, name: o.product_name },
  escrow          : { status: o.escrow_status, amount: o.escrow_amount ? parseFloat(o.escrow_amount) : null },
  cancelledAt     : o.cancelled_at,
  completedAt     : o.completed_at,
  createdAt       : o.created_at,
  updatedAt       : o.updated_at,
  items           : o.items || [],
  history         : o.history || []
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