// services/aiChatService.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../config/db';
import logger from '../utils/logger';

console.log("👉 API Key:", process.env.GEMINI_API_KEY ? "Loaded ✅" : "UNDEFINED ❌");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const AI_MODEL = process.env.AI_MODEL_NAME || 'gemini-2.5-flash';

const AiChatService = {
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

  async fetchUserContext(userId: string): Promise<string> {
    try {
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

  async processMessage(userId: string, sessionId: string, messageText: string) {
    try {
      // 4.1 Save user's message to database
      await pool.execute(
        `INSERT INTO chat_messages (session_id, sender_type, message_text) 
         VALUES (?, 'user', ?)`,
        [sessionId, messageText]
      );

      // ✅ SỬA 2: Sửa câu lệnh SQL để lấy đúng 10 tin nhắn MỚI NHẤT
      const [historyRows]: any = await pool.execute(
        `SELECT sender_type, message_text 
         FROM (
           SELECT sender_type, message_text, created_at 
           FROM chat_messages 
           WHERE session_id = ? 
           ORDER BY created_at DESC 
           LIMIT 10
         ) sub
         ORDER BY created_at ASC`,
        [sessionId]
      );

      const systemPrompt = await this.generateSystemPrompt(userId);
      let aiResponseText = '';

      try {
        console.log("👉 Đang gọi Model:", AI_MODEL);
        const model = genAI.getGenerativeModel({
          model: AI_MODEL,
          systemInstruction: systemPrompt,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 300,
          },
        });

        // Bỏ tin nhắn cuối (chính là tin nhắn user vừa gửi)
        const rawHistory = historyRows.slice(0, -1); 
        const geminiHistory = rawHistory.map((row: any) => ({
          role: row.sender_type === 'user' ? 'user' : 'model',
          parts: [{ text: row.message_text }],
        }));

        // ✅ SỬA 3: Thuật toán ép buộc History phải xen kẽ (Chống crash)
        const validHistory: any[] = [];
        let expectedRole = 'user';
        for (const msg of geminiHistory) {
          if (msg.role === expectedRole) {
            validHistory.push(msg);
            expectedRole = expectedRole === 'user' ? 'model' : 'user';
          }
        }
        
        // Cắt bỏ nếu tin nhắn chót đang là 'user' để dọn chỗ cho messageText tiếp theo
        if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
          validHistory.pop();
        }

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

      // 4.5 Save AI's response
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