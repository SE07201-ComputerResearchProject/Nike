// services/escrowService.ts
// ─────────────────────────────────────────────
// Core escrow business logic.
// All state transitions happen inside MySQL
// transactions so the DB is always consistent.
//
// Flow:
//   payAndHold()     → order: pending → paid
//                      escrow: pending → held
//   releaseToSeller()→ order: completed
//                      escrow: held → released
//   refundToBuyer()  → order: cancelled | refunded
//                      escrow: held|pending → refunded
//   openDispute()    → escrow: held → disputed
//   resolveDispute() → escrow: disputed → released | refunded
// ─────────────────────────────────────────────

import { pool } from '../config/db';
import { LogModel, LOG_EVENTS } from '../models/logModel';
import logger from '../utils/logger';
import OutboxService from './outboxService';

const PLATFORM_FEE_RATE = 0.025; // 2.5 %

interface EscrowLogParams {
  userId: string | null;
  eventType: string;
  orderId: string;
  amount: number | string;
  message: string;
  ipAddress?: string | null;
}

interface PayAndHoldParams {
  orderId: string;
  buyerId: string;
  paymentMethod?: any;
  ipAddress?: string | null;
}

interface ReleaseToSellerParams {
  orderId: string;
  buyerId: string;
  ipAddress?: string | null;
}

interface RefundToBuyerParams {
  orderId: string;
  requesterId: string;
  requesterRole: string;
  reason?: string;
  ipAddress?: string | null;
}

interface OpenDisputeParams {
  orderId: string;
  buyerId: string;
  reason: string;
  ipAddress?: string | null;
}

interface ResolveDisputeParams {
  orderId: string;
  disputeId: string;
  adminId: string;
  resolution: 'release' | 'refund';
  reason: string;
  ipAddress?: string | null;
}

interface GetEscrowStatusParams {
  orderId: string;
  requesterId: string;
  requesterRole: string;
}

// ── Helper: write escrow audit log ───────────
const escrowLog = async ({ userId, eventType, orderId, amount, message, ipAddress }: EscrowLogParams) => {
  await LogModel.write({
    userId,
    eventType,
    severity  : 'info',
    ipAddress : ipAddress ?? null,
    message   : `[Escrow] ${message} | orderId=${orderId} amount=${amount}`,
    payload   : { orderId, amount },
  });
};

// ─────────────────────────────────────────────
// payAndHold({ orderId, buyerId, paymentMethod, ipAddress })
// ─────────────────────────────────────────────
const payAndHold = async ({ orderId, buyerId, paymentMethod = {}, ipAddress }: PayAndHoldParams) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock order + escrow rows (Sử dụng as any[] để TypeScript hiểu cấu trúc mảng trả về từ MySQL)
    const [[order]] = (await conn.execute(
      `SELECT o.*, p.name AS product_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.id = ? AND o.buyer_id = ? FOR UPDATE`,
      [orderId, buyerId]
    )) as any[];

    if (!order) {
      await conn.rollback();
      return { success: false, code: 'ORDER_NOT_FOUND', message: 'Order not found or does not belong to you.' };
    }

    if (order.status !== 'pending') {
      await conn.rollback();
      return { success: false, code: 'INVALID_ORDER_STATUS', message: `Order is "${order.status}". Only pending orders can be paid.` };
    }

    const [[escrow]] = (await conn.execute(
      'SELECT * FROM escrow_transactions WHERE order_id = ? FOR UPDATE',
      [orderId]
    )) as any[];

    if (!escrow) {
      await conn.rollback();
      return { success: false, code: 'ESCROW_NOT_FOUND', message: 'Escrow record not found for this order.' };
    }

    if (escrow.status !== 'pending') {
      await conn.rollback();
      return { success: false, code: 'ESCROW_ALREADY_PROCESSED', message: `Escrow is already "${escrow.status}".` };
    }

    // Mark as processing to prevent concurrent charges
    const [uRes]: any = await conn.execute(
      `UPDATE escrow_transactions SET status = 'processing' WHERE order_id = ? AND status = 'pending'`,
      [orderId]
    );

    if (uRes.affectedRows === 0) {
      await conn.rollback();
      return { success: false, code: 'ESCROW_ALREADY_PROCESSED', message: 'Escrow could not be reserved for processing.' };
    }

    // Enqueue a charge event in the outbox within the same transaction to ensure durability
    const paymentPayload = {
      orderId,
      escrowId: escrow.id,
      amount: parseFloat(order.total_amount),
      currency: 'USD',
      paymentMethod: {
        type: paymentMethod.type ?? null,
        last4: (paymentMethod.cardNumber || '').replace(/\s/g, '').slice(-4) || null,
      },
      idempotencyKey: `${escrow.id}:charge`,
    };

    await OutboxService.enqueueEvent(conn, {
      aggregateType: 'escrow_transaction',
      aggregateId: escrow.id,
      eventType: 'charge',
      payload: paymentPayload,
    });

    await conn.commit();

    await escrowLog({
      userId    : buyerId,
      eventType : LOG_EVENTS.ESCROW_HELD,
      orderId,
      amount    : order.total_amount,
      message   : `Charge enqueued for processing. escrowId=${escrow.id}`,
      ipAddress,
    });

    logger.info(`Escrow charge enqueued: orderId=${orderId} amount=${order.total_amount} escrowId=${escrow.id}`);

    return {
      success     : true,
      message     : 'Payment scheduled. The charge will be processed shortly and funds placed in escrow.',
      orderId,
      amount      : parseFloat(order.total_amount),
      platformFee : parseFloat(escrow.platform_fee),
      netToSeller : parseFloat(escrow.net_amount),
      escrowStatus: 'processing',
      orderStatus : order.status,
    };

  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('payAndHold error:', err);
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// releaseToSeller({ orderId, buyerId, ipAddress })
// ─────────────────────────────────────────────
const releaseToSeller = async ({ orderId, buyerId, ipAddress }: ReleaseToSellerParams) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = (await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId])) as any[];
    if (!order) { await conn.rollback(); return { success: false, code: 'ORDER_NOT_FOUND', message: 'Order not found.' }; }

    if (order.buyer_id !== buyerId) { await conn.rollback(); return { success: false, code: 'FORBIDDEN', message: 'Only the buyer can confirm delivery.' }; }

    if (order.status !== 'shipped') { await conn.rollback(); return { success: false, code: 'INVALID_ORDER_STATUS', message: `Order must be "shipped" before delivery can be confirmed. Current: "${order.status}".` }; }

    const [[escrow]] = (await conn.execute('SELECT * FROM escrow_transactions WHERE order_id = ? FOR UPDATE', [orderId])) as any[];
    if (!escrow || escrow.status !== 'held') { await conn.rollback(); return { success: false, code: 'ESCROW_NOT_HELD', message: 'Escrow funds are not currently held for this order.' }; }

    // Mark as releasing to prevent concurrent releases
    const [uRes]: any = await conn.execute("UPDATE escrow_transactions SET status = 'releasing' WHERE order_id = ? AND status = 'held'", [orderId]);
    if (uRes.affectedRows === 0) { await conn.rollback(); return { success: false, code: 'ESCROW_PROCESSING', message: 'Escrow is already being processed.' }; }

    // Enqueue transfer event in outbox within same TX
    const transferPayload = {
      orderId,
      escrowId: escrow.id,
      sellerId: order.seller_id,
      amount: parseFloat(escrow.net_amount),
      currency: 'USD',
      idempotencyKey: `${escrow.id}:transfer`,
    };

    await OutboxService.enqueueEvent(conn, {
      aggregateType: 'escrow_transaction',
      aggregateId: escrow.id,
      eventType: 'transfer',
      payload: transferPayload,
    });

    await conn.commit();

    await escrowLog({ userId: buyerId, eventType: LOG_EVENTS.ESCROW_RELEASED, orderId, amount: escrow.net_amount, message: `Release enqueued to seller ${order.seller_id}. escrowId=${escrow.id}`, ipAddress });

    logger.info(`Escrow release enqueued: orderId=${orderId} netAmount=${escrow.net_amount} escrowId=${escrow.id}`);

    return { success: true, message: 'Release scheduled. Funds will be transferred to the seller shortly.', orderId, netToSeller: parseFloat(escrow.net_amount), platformFee: parseFloat(escrow.platform_fee), escrowStatus: 'releasing', orderStatus: order.status };

  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('releaseToSeller error:', err);
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// refundToBuyer({ orderId, requesterId, requesterRole, reason, ipAddress })
// ─────────────────────────────────────────────
const refundToBuyer = async ({ orderId, requesterId, requesterRole, reason, ipAddress }: RefundToBuyerParams) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = (await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId])) as any[];
    if (!order) { await conn.rollback(); return { success: false, code: 'ORDER_NOT_FOUND', message: 'Order not found.' }; }

    if (requesterRole !== 'admin' && order.buyer_id !== requesterId) { await conn.rollback(); return { success: false, code: 'FORBIDDEN', message: 'Access denied.' }; }

    if (['completed', 'refunded'].includes(order.status)) { await conn.rollback(); return { success: false, code: 'NOT_REFUNDABLE', message: `Order is "${order.status}" and cannot be refunded.` }; }

    const [[escrow]] = (await conn.execute('SELECT * FROM escrow_transactions WHERE order_id = ? FOR UPDATE', [orderId])) as any[];
    if (!escrow) { await conn.rollback(); return { success: false, code: 'ESCROW_NOT_FOUND', message: 'No escrow record found.' }; }

    if (!['pending', 'held'].includes(escrow.status)) { await conn.rollback(); return { success: false, code: 'NOT_REFUNDABLE', message: `Escrow is "${escrow.status}" — cannot be refunded.` }; }

    // Enqueue refund event in outbox within same TX
    const refundPayload = {
      orderId,
      escrowId: escrow.id,
      amount: parseFloat(escrow.amount),
      currency: 'USD',
      chargeId: escrow.charge_id || null,
      reason: reason ?? 'requested_by_customer',
      quantity: order.quantity,
      productId: order.product_id,
      idempotencyKey: `${escrow.id}:refund`,
    };

    await OutboxService.enqueueEvent(conn, {
      aggregateType: 'escrow_transaction',
      aggregateId: escrow.id,
      eventType: 'refund',
      payload: refundPayload,
    });

    await conn.commit();

    await escrowLog({ userId: requesterId, eventType: LOG_EVENTS.ESCROW_REFUNDED, orderId, amount: escrow.amount, message: `Refund enqueued. escrowId=${escrow.id} reason="${reason}"`, ipAddress });

    logger.info(`Escrow refund enqueued: orderId=${orderId} amount=${escrow.amount} escrowId=${escrow.id}`);

    return { success: true, message: 'Refund scheduled. The refund will be processed shortly.', orderId, amount: parseFloat(escrow.amount), escrowStatus: 'refunding', orderStatus: order.status };

  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('refundToBuyer error:', err);
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// openDispute({ orderId, buyerId, reason, ipAddress })
// ─────────────────────────────────────────────
const openDispute = async ({ orderId, buyerId, reason, ipAddress }: OpenDisputeParams) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = (await conn.execute(
      'SELECT * FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    )) as any[];

    if (!order) {
      await conn.rollback();
      return { success: false, code: 'ORDER_NOT_FOUND', message: 'Order not found.' };
    }

    if (order.buyer_id !== buyerId) {
      await conn.rollback();
      return { success: false, code: 'FORBIDDEN', message: 'Only the buyer can open a dispute.' };
    }

    if (order.status !== 'shipped') {
      await conn.rollback();
      return { success: false, code: 'INVALID_STATUS',
               message: `Disputes can only be opened on shipped orders. Current status: "${order.status}".` };
    }

    const [[escrow]] = (await conn.execute(
      'SELECT * FROM escrow_transactions WHERE order_id = ? FOR UPDATE',
      [orderId]
    )) as any[];

    if (!escrow || escrow.status !== 'held') {
      await conn.rollback();
      return { success: false, code: 'ESCROW_NOT_HELD',
               message: 'Escrow must be in "held" status to open a dispute.' };
    }

    await conn.execute(
      `UPDATE escrow_transactions SET status = 'disputed' WHERE order_id = ?`,
      [orderId]
    );

    await conn.commit();

    await LogModel.write({
      userId    : buyerId,
      eventType : LOG_EVENTS.SUSPICIOUS_ACTIVITY,
      severity  : 'warn',
      ipAddress,
      message   : `Dispute opened: orderId=${orderId} reason="${reason}"`,
      payload   : { orderId, reason },
    });

    logger.warn(`Dispute opened: orderId=${orderId} buyerId=${buyerId}`);

    return {
      success      : true,
      message      : 'Dispute opened. An admin will review and resolve within 48 hours.',
      orderId,
      escrowStatus : 'disputed',
    };

  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('openDispute error:', err);
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// resolveDispute({ orderId, adminId, resolution, reason, ipAddress })
// ─────────────────────────────────────────────
const resolveDispute = async ({ orderId, disputeId, adminId, resolution, reason, ipAddress }: ResolveDisputeParams) => {
  if (!['release', 'refund'].includes(resolution)) {
    return { success: false, code: 'INVALID_RESOLUTION', message: 'resolution must be "release" or "refund".' };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[escrow]] = (await conn.execute('SELECT * FROM escrow_transactions WHERE order_id = ? FOR UPDATE', [orderId])) as any[];

    if (!escrow || escrow.status !== 'disputed') {
      await conn.rollback();
      return { success: false, code: 'NOT_DISPUTED', message: 'This order does not have an active dispute.' };
    }

    const [[order]] = (await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId])) as any[];

    if (resolution === 'release') {
      await conn.execute("UPDATE escrow_transactions SET status = 'releasing' WHERE order_id = ? AND status = 'disputed'", [orderId]);

      const transferPayload = {
        orderId,
        escrowId: escrow.id,
        disputeId, // <-- ĐƯA DISPUTE_ID VÀO PAYLOAD CHO WORKER
        sellerId: order.seller_id,
        amount: parseFloat(escrow.net_amount),
        currency: 'USD',
        idempotencyKey: `${escrow.id}:transfer`,
      };

      await OutboxService.enqueueEvent(conn, { aggregateType: 'escrow_transaction', aggregateId: escrow.id, eventType: 'transfer', payload: transferPayload });
      await conn.commit();
      
      await escrowLog({ userId: adminId, eventType: LOG_EVENTS.ESCROW_RELEASED, orderId, amount: escrow.net_amount, message: `Admin enqueued release. escrowId=${escrow.id}`, ipAddress });
      return { success: true, message: 'Dispute resolved: release scheduled.', orderId, resolution: 'released', escrowStatus: 'releasing' };

    } else {
      await conn.execute("UPDATE escrow_transactions SET status = 'refunding' WHERE order_id = ? AND status = 'disputed'", [orderId]);

      const refundPayload = {
        orderId,
        escrowId: escrow.id,
        disputeId, // <-- ĐƯA DISPUTE_ID VÀO PAYLOAD CHO WORKER
        amount: parseFloat(escrow.amount),
        currency: 'USD',
        chargeId: escrow.charge_id || null,
        reason: `Admin dispute resolution: ${reason}`,
        quantity: order.quantity,
        productId: order.product_id,
        idempotencyKey: `${escrow.id}:refund`,
      };

      await OutboxService.enqueueEvent(conn, { aggregateType: 'escrow_transaction', aggregateId: escrow.id, eventType: 'refund', payload: refundPayload });
      await conn.commit();

      await escrowLog({ userId: adminId, eventType: LOG_EVENTS.ESCROW_REFUNDED, orderId, amount: escrow.amount, message: `Admin enqueued refund. escrowId=${escrow.id}`, ipAddress });
      return { success: true, message: 'Dispute resolved: refund scheduled.', orderId, resolution: 'refunded', escrowStatus: 'refunding' };
    }

  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error('resolveDispute error:', err);
    throw err;
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────
// getEscrowStatus({ orderId, requesterId, requesterRole })
// ─────────────────────────────────────────────
const getEscrowStatus = async ({ orderId, requesterId, requesterRole }: GetEscrowStatusParams) => {
  const [[row]] = (await pool.execute(
    `SELECT e.*,
            o.status  AS order_status,
            o.buyer_id, o.seller_id,
            b.username AS buyer_username,
            s.username AS seller_username
     FROM escrow_transactions e
     JOIN orders o ON o.id = e.order_id
     JOIN users  b ON b.id = o.buyer_id
     JOIN users  s ON s.id = o.seller_id
     WHERE e.order_id = ?
     LIMIT 1`,
    [orderId]
  )) as any[];

  if (!row) return { success: false, code: 'NOT_FOUND', message: 'Escrow record not found.' };

  // Visibility: buyer, seller of this order, or admin
  if (requesterRole !== 'admin' &&
      row.buyer_id !== requesterId &&
      row.seller_id !== requesterId) {
    return { success: false, code: 'FORBIDDEN', message: 'Access denied.' };
  }

  return {
    success : true,
    data    : {
      escrowId     : row.id,
      orderId      : row.order_id,
      amount       : parseFloat(row.amount),
      platformFee  : parseFloat(row.platform_fee),
      netToSeller  : parseFloat(row.net_amount),
      status       : row.status,
      orderStatus  : row.order_status,
      buyer        : row.buyer_username,
      seller       : row.seller_username,
      heldAt       : row.held_at,
      releasedAt   : row.released_at,
      refundedAt   : row.refunded_at,
      releaseReason: row.release_reason,
      refundReason : row.refund_reason,
      createdAt    : row.created_at,
    },
  };
};

export = {
  payAndHold,
  releaseToSeller,
  refundToBuyer,
  openDispute,
  resolveDispute,
  getEscrowStatus,
};