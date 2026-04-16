// services/walletService.ts
// ─────────────────────────────────────────────
// Wallet Service — Manages wallet transactions
// Integrates with Escrow and Payment services
// ─────────────────────────────────────────────

import WalletModel from '../models/walletModel';
import logger from '../utils/logger';
import { pool } from '../config/db';

/**
 * Deposit funds to wallet when MoMo/QR payment succeeds
 * Called by payment service after successful payment
 */
const depositFromPayment = async (
  userId: string,
  amount: number,
  paymentId: string,
  paymentMethod: 'momo' | 'qr' | 'cod',
  description?: string
): Promise<void> => {
  try {
    const wallet = await WalletModel.getOrCreateWallet(userId);

    await WalletModel.addTransaction(
      wallet.id,
      userId,
      'deposit',
      amount,
      description || `Payment received via ${paymentMethod.toUpperCase()}`,
      paymentId,
      `${paymentMethod}_payment`
    );

    logger.info(`Wallet deposit: user=${userId}, amount=${amount}, method=${paymentMethod}`);
  } catch (error) {
    logger.error('depositFromPayment error:', error);
    throw error;
  }
};

/**
 * Transfer funds to seller wallet when escrow is released
 * Called by escrow service after release is confirmed
 */
const transferFromEscrowRelease = async (
  sellerId: string,
  amount: number,
  escrowId: string,
  orderId: string,
  description?: string,
  externalConn?: any
): Promise<void> => {
  try {
    const wallet = await WalletModel.getOrCreateWallet(sellerId);

    await WalletModel.addTransaction(
      wallet.id,
      sellerId,
      'transfer_in',
      amount,
      description || `Funds released from escrow`,
      escrowId,
      'escrow_release',
      externalConn
    );

    logger.info(`Wallet transfer from escrow: seller=${sellerId}, amount=${amount}, orderId=${orderId}`);
  } catch (error) {
    logger.error('transferFromEscrowRelease error:', error);
    throw error;
  }
};

/**
 * Refund funds to buyer wallet when escrow is refunded
 * Called by escrow service after refund is confirmed
 */
const refundFromEscrow = async (
  buyerId: string,
  amount: number,
  escrowId: string,
  orderId: string,
  reason?: string
): Promise<void> => {
  try {
    const wallet = await WalletModel.getOrCreateWallet(buyerId);

    await WalletModel.addTransaction(
      wallet.id,
      buyerId,
      'deposit',
      amount,
      reason || `Refund from order`,
      escrowId,
      'escrow_refund'
    );

    logger.info(`Wallet refund from escrow: buyer=${buyerId}, amount=${amount}, orderId=${orderId}`);
  } catch (error) {
    logger.error('refundFromEscrow error:', error);
    throw error;
  }
};

/**
 * Get wallet balance for a user
 */
const getBalance = async (userId: string): Promise<number> => {
  const wallet = await WalletModel.getWalletByUserId(userId);
  return wallet ? wallet.balance : 0;
};

/**
 * Batch get wallets for multiple users
 */
const getBalances = async (userIds: string[]): Promise<Map<string, number>> => {
  const conn: any = await pool.getConnection();
  try {
    const placeholders = userIds.map(() => '?').join(',');
    const [rows]: any = await conn.execute(
      `SELECT user_id, balance FROM wallets WHERE user_id IN (${placeholders})`,
      userIds
    );

    const balances = new Map<string, number>();
    for (const row of rows) {
      balances.set(row.user_id, row.balance);
    }
    return balances;
  } finally {
    conn.release();
  }
};

/**
 * Check if buyer has sufficient wallet balance
 */
const hasSufficientBalance = async (userId: string, amount: number): Promise<boolean> => {
  const balance = await getBalance(userId);
  return balance >= amount;
};

/**
 * Deduct funds from buyer wallet (for wallet-based payments)
 * Used when buyer pays directly from wallet
 */
const deductFromWallet = async (
  userId: string,
  amount: number,
  orderId: string,
  description?: string
): Promise<void> => {
  try {
    const wallet = await WalletModel.getOrCreateWallet(userId);

    if (wallet.balance < amount) {
      throw new Error('Insufficient wallet balance');
    }

    await WalletModel.addTransaction(
      wallet.id,
      userId,
      'transfer_out',
      amount,
      description || 'Payment from wallet',
      orderId,
      'order_payment'
    );

    logger.info(`Wallet deduction: user=${userId}, amount=${amount}, orderId=${orderId}`);
  } catch (error) {
    logger.error('deductFromWallet error:', error);
    throw error;
  }
};

/**
 * Apply platform fee deduction from seller wallet
 */
const applyPlatformFee = async (
  sellerId: string,
  feeAmount: number,
  escrowId: string,
  orderId: string
): Promise<void> => {
  try {
    const wallet = await WalletModel.getOrCreateWallet(sellerId);

    await WalletModel.addTransaction(
      wallet.id,
      sellerId,
      'platform_fee',
      feeAmount,
      `Platform fee (2.5%)`,
      escrowId,
      'platform_fee'
    );

    logger.info(`Platform fee applied: seller=${sellerId}, fee=${feeAmount}, orderId=${orderId}`);
  } catch (error) {
    logger.error('applyPlatformFee error:', error);
    throw error;
  }
};

export = {
  depositFromPayment,
  transferFromEscrowRelease,
  refundFromEscrow,
  getBalance,
  getBalances,
  hasSufficientBalance,
  deductFromWallet,
  applyPlatformFee,
};
