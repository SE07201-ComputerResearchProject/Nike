// controllers/chatController.ts
// ─────────────────────────────────────────────
// Controller for AI Customer Support Chat
// ─────────────────────────────────────────────

import { Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../config/db';
import aiChatService from '../services/aiChatService';
import logger from '../utils/logger';

interface ChatRequest extends Request {
  user?: any;
}

// ─────────────────────────────────────────────
// GET /api/chat/history
// Fetch the most recent chat session and its messages
// ─────────────────────────────────────────────
const getHistory = async (req: ChatRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user.id;
    
    // Find the latest active or handoff session
    const [sessions]: any = await pool.execute(
      `SELECT id, status FROM chat_sessions 
       WHERE user_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (sessions.length === 0) {
      return res.status(200).json({ 
        success: true, 
        data: { status: 'none', messages: [] } 
      });
    }

    const session = sessions[0];
    const [messages]: any = await pool.execute(
      `SELECT id, sender_type, message_text, created_at 
       FROM chat_messages 
       WHERE session_id = ? 
       ORDER BY created_at ASC`,
      [session.id]
    );

    res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        status: session.status,
        messages
      }
    });
  } catch (error) {
    logger.error('getHistory error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch chat history.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/chat/send
// Send a message to AI or append to admin queue
// ─────────────────────────────────────────────
const sendMessage = async (req: ChatRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user.id;
    const { message } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message text is required.' });
    }

    // Find latest session or create a new one
    let session;
    const [existing]: any = await pool.execute(
      `SELECT id, status FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (existing.length > 0 && existing[0].status !== 'resolved') {
      session = existing[0];
    } else {
      const newId = crypto.randomUUID();
      await pool.execute(
        `INSERT INTO chat_sessions (id, user_id, status) VALUES (?, ?, 'active')`,
        [newId, userId]
      );
      session = { id: newId, status: 'active' };
    }

    // IF status is handoff_to_admin, AI stops replying. Just save user message.
    if (session.status === 'handoff_to_admin') {
       await pool.execute(
         `INSERT INTO chat_messages (session_id, sender_type, message_text) VALUES (?, 'user', ?)`,
         [session.id, message]
       );
       return res.status(200).json({
         success: true,
         reply: 'Your message has been forwarded. A human admin will reply shortly.',
         handoff: true
       });
    }

    // Otherwise, process via AI Service
    const aiResult = await aiChatService.processMessage(userId, session.id, message);

    res.status(200).json({
      success: true,
      reply: aiResult.reply
    });

  } catch (error) {
    logger.error('sendMessage error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
};

// ─────────────────────────────────────────────
// POST /api/chat/handoff
// User explicitly requests human support
// ─────────────────────────────────────────────
const requestHandoff = async (req: ChatRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user.id;
    const [sessions]: any = await pool.execute(
      `SELECT id FROM chat_sessions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (sessions.length === 0) {
      return res.status(400).json({ success: false, message: 'No active chat session found.' });
    }

    const sessionId = sessions[0].id;
    
    // Update status to handoff
    await pool.execute(
      `UPDATE chat_sessions SET status = 'handoff_to_admin' WHERE id = ?`,
      [sessionId]
    );

    // Insert an automated system message
    await pool.execute(
      `INSERT INTO chat_messages (session_id, sender_type, message_text) VALUES (?, 'ai', ?)`,
      [sessionId, 'You have been transferred to human support. An admin will be with you shortly.']
    );

    res.status(200).json({ success: true, message: 'Transferred to human support successfully.' });

  } catch (error) {
    logger.error('requestHandoff error:', error);
    res.status(500).json({ success: false, message: 'Failed to request handoff.' });
  }
};

export = { getHistory, sendMessage, requestHandoff };