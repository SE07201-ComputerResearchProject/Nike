// services/aiChatService.ts
// ─────────────────────────────────────────────
// AI Chat Service using RAG (Retrieval-Augmented Generation).
// Fetches real-time database context before calling the LLM
// to guarantee zero-hallucination responses.
// ─────────────────────────────────────────────

import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../config/db';
import logger from '../utils/logger';

// Initialize Google Generative AI Client
console.log("👉 API Key:", process.env.GEMINI_API_KEY ? "Loaded ✅" : "UNDEFINED ❌");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const AI_MODEL = 'gemini-2.5-flash-lite';

const AiChatService = {
  // ── 1. Fetch System Knowledge (RAG Core) ──────────────────
  async fetchKnowledgeBase(): Promise<string> {
    try {
      const [rows]: any = await pool.execute(
        'SELECT topic, content FROM knowledge_base WHERE is_active = 1'
      );
      if (!rows.length) return 'No specific platform rules found.';

      return rows.map((row: any) => `- ${row.topic.toUpperCase()}: ${row.content}`).join('\n');
    } catch (error) {
      logger.error('Error fetching knowledge base:', error);
      return '';
    }
  },

  // ── 2. Fetch User Specific Context (RAG Core) ───────────────
  async fetchUserContext(userId: string): Promise<string> {
    try {
      // Fetch the 3 most recent orders to provide context if user asks "Where is my order?"
      const [orders]: any = await pool.execute(
        `SELECT id, status, total_amount, created_at 
         FROM orders 
         WHERE buyer_id = ? 
         ORDER BY created_at DESC 
         LIMIT 3`,
        [userId]
      );

      if (!orders.length) return 'User has no recent orders.';

      return orders.map((o: any) =>
        `Order ID: ${o.id} | Status: ${o.status} | Total: $${o.total_amount} | Date: ${o.created_at}`
      ).join('\n');
    } catch (error) {
      logger.error(`Error fetching context for user ${userId}:`, error);
      return 'Unable to retrieve user order history.';
    }
  },

  // ── 3. Build the Strict System Prompt ───────────────────────
  async generateSystemPrompt(userId: string): Promise<string> {
    const platformRules = await this.fetchKnowledgeBase();
    const userOrders = await this.fetchUserContext(userId);

    return `
You are the official Customer Support AI for O'Future, a B2B wholesale e-commerce platform.
Your primary directive is to assist users politely and professionally.

CRITICAL RULES (ZERO HALLUCINATION):
1. ONLY answer based on the "Platform Rules" and "User Orders" provided below.
2. If the user asks about something NOT in the provided context, politely state that you do not have that information and offer to transfer them to a human admin.
3. NEVER invent prices, fees, policies, or order statuses.
4. If a user expresses extreme frustration or asks to resolve a financial dispute, suggest handing off to a human admin.

--- PLATFORM RULES ---
${platformRules}

--- USER'S RECENT ORDERS ---
${userOrders}
    `.trim();
  },

  // ── 4. Main Process: Handle User Message & Get AI Reply ─────
  async processMessage(userId: string, sessionId: string, messageText: string) {
    try {
      // 4.1 Save user's message to database
      await pool.execute(
        `INSERT INTO chat_messages (session_id, sender_type, message_text) 
         VALUES (?, 'user', ?)`,
        [sessionId, messageText]
      );

      // 4.2 Fetch chat history for context window (last 10 messages to save tokens)
      const [historyRows]: any = await pool.execute(
        `SELECT sender_type, message_text 
         FROM chat_messages 
         WHERE session_id = ? 
         ORDER BY created_at ASC 
         LIMIT 10`,
        [sessionId]
      );

      // 4.3 Generate strict system prompt injected with live DB data
      const systemPrompt = await this.generateSystemPrompt(userId);

      // 4.4 Call Gemini API via Google SDK
      let aiResponseText = '';
      try {
        console.log("👉 Đang gọi Model:", AI_MODEL);

        const model = genAI.getGenerativeModel({
          model: AI_MODEL,
          systemInstruction: systemPrompt,
          generationConfig: {
            temperature: 0.2, // Low temperature for factual, non-creative responses
            maxOutputTokens: 300,
          },
        });

        // Map DB history sang Gemini format (bỏ message cuối vì sẽ sendMessage riêng)
        // Gemini yêu cầu history phải bắt đầu bằng 'user' và xen kẽ user/model
        const rawHistory = historyRows.slice(0, -1); // bỏ message cuối (message hiện tại)
        const geminiHistory = rawHistory.map((row: any) => ({
          role: row.sender_type === 'user' ? 'user' : 'model',
          parts: [{ text: row.message_text }],
        }));

        // Đảm bảo history bắt đầu bằng 'user' (Gemini requirement)
        const validHistory = geminiHistory[0]?.role === 'user' ? geminiHistory : [];

        const chat = model.startChat({
          history: validHistory,
        });

        const result = await chat.sendMessage(messageText);
        aiResponseText = result.response.text();
        console.log("👉 AI Reply:", aiResponseText);

      } catch (apiError) {
        logger.error('Gemini API Error:', apiError);
        aiResponseText = 'I am currently experiencing technical difficulties connecting to my brain. Please try again later or request human support.';
      }

      // 4.5 Save AI's response to database
      await pool.execute(
        `INSERT INTO chat_messages (session_id, sender_type, message_text) 
         VALUES (?, 'ai', ?)`,
        [sessionId, aiResponseText]
      );

      return {
        success: true,
        reply: aiResponseText,
      };

    } catch (error) {
      logger.error('Error in processMessage:', error);
      throw new Error('Failed to process chat message');
    }
  }
};

export = AiChatService;