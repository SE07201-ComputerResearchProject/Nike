// routes/chatRoutes.ts
// ─────────────────────────────────────────────
// Routes for AI Chat functionality
// ─────────────────────────────────────────────

import express from 'express';
import rateLimit from 'express-rate-limit';
const { getHistory, sendMessage, requestHandoff } = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');
const { noCache } = require('../middleware/security');

const router = express.Router();

// Strict rate limiter for LLM to prevent budget drain (20 msgs / hour)
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: 20,
  message: { success: false, message: 'Too many messages sent. Please try again later or request human support.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// All chat routes require authentication
router.use(authenticate);
router.use(noCache);

/**
 * GET /api/chat/history
 * Protected - Fetch active session history
 */
router.get('/history', getHistory);

/**
 * POST /api/chat/send
 * Protected - Send a message to the AI
 * Body: { message: string }
 */
router.post('/send', chatLimiter, sendMessage);

/**
 * POST /api/chat/handoff
 * Protected - Request human admin intervention
 */
router.post('/handoff', requestHandoff);

export = router;