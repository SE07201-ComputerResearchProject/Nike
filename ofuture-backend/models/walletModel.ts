// models/walletModel.ts
// ─────────────────────────────────────────────
// Wallet Model — Virtual Money System
// Manages wallet balance and transactions.
// ─────────────────────────────────────────────

import { pool } from '../config/db';

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  currency: string;
  created_at: Date;
  updated_at: Date;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'transfer_in' | 'transfer_out' | 'platform_fee' | 'adjustment';
  amount: number;
  description?: string;
  reference_id?: string;
  reference_type?: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: Date;
  updated_at: Date;
}

// ═════════════════════════════════════════════
// WALLET OPERATIONS
// ═════════════════════════════════════════════

/**
 * Get or create wallet for a user.
 * If wallet doesn't exist, create it with 0 balance.
 */
const getOrCreateWallet = async (userId: string): Promise<Wallet> => {
  let [wallet]: any = await pool.execute(
    `SELECT * FROM wallets WHERE user_id = ? LIMIT 1`,
    [userId]
  );

  if (!wallet || wallet.length === 0) {
    const walletId = require('crypto').randomUUID();
    await pool.execute(
      `INSERT INTO wallets (id, user_id, balance, currency) VALUES (?, ?, 0.00, 'VND')`,
      [walletId, userId]
    );
    [wallet] = await pool.execute(
      `SELECT * FROM wallets WHERE id = ? LIMIT 1`,
      [walletId]
    );
  }

  return wallet[0] || wallet;
};

/**
 * Get wallet by user ID
 */
const getWalletByUserId = async (userId: string): Promise<Wallet | null> => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM wallets WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

/**
 * Get wallet by wallet ID
 */
const getWalletById = async (walletId: string): Promise<Wallet | null> => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM wallets WHERE id = ? LIMIT 1`,
    [walletId]
  );
  return rows[0] || null;
};

/**
 * Add transaction to wallet (deposit, withdrawal, etc)
 * Also updates wallet balance atomically
 */
const addTransaction = async (
  walletId: string,
  userId: string,
  type: string,
  amount: number,
  description?: string,
  referenceId?: string,
  referenceType?: string
): Promise<WalletTransaction> => {
  const conn: any = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const transactionId = require('crypto').randomUUID();

    // Calculate new balance based on transaction type
    let balanceChange = 0;
    if (type === 'deposit' || type === 'transfer_in') {
      balanceChange = amount;
    } else if (type === 'withdrawal' || type === 'transfer_out' || type === 'platform_fee') {
      balanceChange = -amount;
    } else if (type === 'adjustment') {
      // For adjustments, amount can be positive or negative
      balanceChange = amount;
    }

    // Insert transaction
    await conn.execute(
      `INSERT INTO wallet_transactions 
       (id, wallet_id, user_id, type, amount, description, reference_id, reference_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [
        transactionId,
        walletId,
        userId,
        type,
        Math.abs(amount), // Store absolute value
        description,
        referenceId,
        referenceType,
      ]
    );

    // Update wallet balance
    await conn.execute(
      `UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE id = ?`,
      [balanceChange, walletId]
    );

    await conn.commit();

    return {
      id: transactionId,
      wallet_id: walletId,
      user_id: userId,
      type: type as any,
      amount: Math.abs(amount),
      description,
      reference_id: referenceId,
      reference_type: referenceType,
      status: 'completed',
      created_at: new Date(),
      updated_at: new Date(),
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Get wallet transactions with pagination
 */
const getTransactions = async (
  walletId: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ transactions: WalletTransaction[]; total: number }> => {
  // Get total count
  const [countRows]: any = await pool.execute(
    `SELECT COUNT(*) as total FROM wallet_transactions WHERE wallet_id = ?`,
    [walletId]
  );
  const total = countRows[0]?.total || 0;

  // Get paginated results
  const [transactions]: any = await pool.execute(
    `SELECT * FROM wallet_transactions 
     WHERE wallet_id = ? 
     ORDER BY created_at DESC 
     LIMIT ? OFFSET ?`,
    [walletId, limit, offset]
  );

  return { transactions, total };
};

/**
 * Get transaction by ID
 */
const getTransactionById = async (transactionId: string): Promise<WalletTransaction | null> => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM wallet_transactions WHERE id = ? LIMIT 1`,
    [transactionId]
  );
  return rows[0] || null;
};

/**
 * Get transactions by reference (e.g., all transactions related to an order)
 */
const getTransactionsByReference = async (
  referenceId: string,
  referenceType?: string
): Promise<WalletTransaction[]> => {
  let query = `SELECT * FROM wallet_transactions WHERE reference_id = ?`;
  const params: any[] = [referenceId];

  if (referenceType) {
    query += ` AND reference_type = ?`;
    params.push(referenceType);
  }

  query += ` ORDER BY created_at DESC`;

  const [rows]: any = await pool.execute(query, params);
  return rows || [];
};

/**
 * Update wallet balance (used by escrow and payment services)
 */
const updateBalance = async (walletId: string, newBalance: number): Promise<void> => {
  await pool.execute(
    `UPDATE wallets SET balance = ?, updated_at = NOW() WHERE id = ?`,
    [newBalance, walletId]
  );
};

export default {
  getOrCreateWallet,
  getWalletByUserId,
  getWalletById,
  addTransaction,
  getTransactions,
  getTransactionById,
  getTransactionsByReference,
  updateBalance,
};
