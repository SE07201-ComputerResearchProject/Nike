// controllers/walletController.ts
// ─────────────────────────────────────────────
// Wallet Controller — REST endpoints for wallet operations
// ─────────────────────────────────────────────

import { Request, Response } from 'express';
import WalletModel from '../models/walletModel';
import logger from '../utils/logger';

/**
 * Get wallet balance for authenticated user
 * GET /api/wallet/balance
 */
const getBalance = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const wallet = await WalletModel.getOrCreateWallet(userId);

    res.status(200).json({
      success: true,
      data: {
        walletId: wallet.id,
        balance: wallet.balance,
        currency: wallet.currency,
        formattedBalance: `${Number(wallet.balance).toLocaleString('vi-VN')} đ`,
      },
    });
  } catch (err: any) {
    logger.error('getBalance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get wallet transaction history
 * GET /api/wallet/transactions?page=1&limit=20
 */
const getTransactionHistory = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const wallet = await WalletModel.getOrCreateWallet(userId);
    const { transactions, total } = await WalletModel.getTransactions(wallet.id, limit, offset);

    const formattedTransactions = transactions.map((txn: any) => ({
      id: txn.id,
      type: txn.type,
      amount: `${Number(txn.amount).toLocaleString('vi-VN')} đ`,
      amountValue: txn.amount,
      description: txn.description,
      referenceId: txn.reference_id,
      referenceType: txn.reference_type,
      status: txn.status,
      createdAt: txn.created_at,
    }));

    res.status(200).json({
      success: true,
      data: {
        transactions: formattedTransactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err: any) {
    logger.error('getTransactionHistory error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get wallet details (balance + recent transactions)
 * GET /api/wallet/details
 */
const getWalletDetails = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const wallet = await WalletModel.getOrCreateWallet(userId);
    const { transactions } = await WalletModel.getTransactions(wallet.id, 10, 0);

    const formattedTransactions = transactions.map((txn: any) => ({
      id: txn.id,
      type: txn.type,
      amount: `${Number(txn.amount).toLocaleString('vi-VN')} đ`,
      amountValue: txn.amount,
      description: txn.description,
      status: txn.status,
      createdAt: txn.created_at,
    }));

    res.status(200).json({
      success: true,
      data: {
        wallet: {
          id: wallet.id,
          balance: `${Number(wallet.balance).toLocaleString('vi-VN')} đ`,
          balanceValue: wallet.balance,
          currency: wallet.currency,
        },
        recentTransactions: formattedTransactions,
      },
    });
  } catch (err: any) {
    logger.error('getWalletDetails error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get transaction by ID
 * GET /api/wallet/transactions/:transactionId
 */
const getTransaction = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const transactionId = req.params.transactionId as string;
    const transaction = await WalletModel.getTransactionById(transactionId);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Verify ownership
    if (transaction.user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    res.status(200).json({
      success: true,
      data: {
        ...transaction,
        formattedAmount: `${Number(transaction.amount).toLocaleString('vi-VN')} đ`,
      },
    });
  } catch (err: any) {
    logger.error('getTransaction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get wallet balance for a specific user (admin only)
 * GET /api/admin/wallet/user/:userId
 */
const getUserWalletAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const requestingUser = (req as any).user;
    if (requestingUser?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const userId = req.params.userId as string;
    const wallet = await WalletModel.getWalletByUserId(userId);

    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    res.status(200).json({
      success: true,
      data: wallet,
    });
  } catch (err: any) {
    logger.error('getUserWalletAdmin error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Adjust wallet balance (admin only)
 * POST /api/admin/wallet/adjust
 * Body: { userId, amount, description }
 */
const adjustWalletBalance = async (req: Request, res: Response): Promise<any> => {
  try {
    const requestingUser = (req as any).user;
    if (requestingUser?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { userId, amount, description } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const wallet = await WalletModel.getOrCreateWallet(userId);
    const transaction = await WalletModel.addTransaction(
      wallet.id,
      userId,
      'adjustment',
      amount,
      description || 'Admin adjustment',
      null,
      'admin'
    );

    logger.info(`Admin wallet adjustment: user=${userId}, amount=${amount}`);

    res.status(200).json({
      success: true,
      data: transaction,
      message: 'Wallet adjusted successfully',
    });
  } catch (err: any) {
    logger.error('adjustWalletBalance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export = {
  getBalance,
  getTransactionHistory,
  getWalletDetails,
  getTransaction,
  getUserWalletAdmin,
  adjustWalletBalance,
};
