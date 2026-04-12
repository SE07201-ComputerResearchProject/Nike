import DisputeChatModel from '../models/disputeChatModel';
import { DisputeModel } from '../models/disputeModel';

/**
 * DisputeChatService - Business logic for dispute chat operations
 */
class DisputeChatService {
  /**
   * Send a chat message in a dispute
   * Validates that user is involved in the dispute
   */
  static async sendMessage(
    disputeId: string,
    senderId: string,
    message: string,
    attachments?: string[]
  ): Promise<{ success: boolean; id?: string; message?: string }> {
    // Verify dispute exists
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) {
      return { success: false, message: 'Dispute not found' };
    }

    // Verify sender is buyer or seller
    const isComplainant = dispute.complainant_id === senderId;
    const isSeller = dispute.seller_id === senderId;

    if (!isComplainant && !isSeller) {
      return { success: false, message: 'Not authorized to message in this dispute' };
    }

    // Create message
    const id = await DisputeChatModel.create({
      dispute_id: disputeId,
      sender_id: senderId,
      message,
      attachments,
    });

    return { success: true, id };
  }

  /**
   * Get all chat messages in a dispute with sender info
   */
  static async getDisputeChat(
    disputeId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any[]> {
    const result = await DisputeChatModel.getByDisputeIdPaginated(
      disputeId,
      page,
      limit,
      true // include user info
    );

    return result.messages;
  }

  /**
   * Mark messages as read for a user
   */
  static async markMessagesAsRead(disputeId: string, userId: string): Promise<boolean> {
    return await DisputeChatModel.markDisputeAsRead(disputeId, userId);
  }

  /**
   * Get unread message count for a dispute
   */
  static async getUnreadCount(disputeId: string, userId: string): Promise<number> {
    const messages = await DisputeChatModel.getUnreadByDispute(disputeId, userId);
    return messages.length;
  }

  /**
   * Delete a chat message (only by sender or admin)
   */
  static async deleteMessage(messageId: string, userId: string, userRole?: string): Promise<boolean> {
    const message = await DisputeChatModel.getById(messageId);

    if (!message) {
      return false;
    }

    // Only sender or admin can delete
    if (message.sender_id !== userId && userRole !== 'admin') {
      return false;
    }

    return await DisputeChatModel.delete(messageId);
  }

  /**
   * Update a chat message (only by sender)
   */
  static async updateMessage(
    messageId: string,
    senderId: string,
    message: string,
    attachments?: string[]
  ): Promise<boolean> {
    const chat = await DisputeChatModel.getById(messageId);

    if (!chat || chat.sender_id !== senderId) {
      return false;
    }

    return await DisputeChatModel.update(messageId, {
      message,
      attachments,
    });
  }

  /**
   * Get summary of dispute chat
   */
  static async getDisputeSummary(
    disputeId: string
  ): Promise<{
    totalMessages: number;
    lastMessage?: string;
    lastMessageAt?: string;
  }> {
    const total = await DisputeChatModel.getMessageCount(disputeId);
    const messages = await DisputeChatModel.getByDisputeId(disputeId, 1, 1);

    let lastMessage = undefined;
    let lastMessageAt = undefined;

    if (messages && messages.length > 0) {
      lastMessage = messages[messages.length - 1].message;
      lastMessageAt = messages[messages.length - 1].created_at;
    }

    return {
      totalMessages: total,
      lastMessage,
      lastMessageAt,
    };
  }
}

export default DisputeChatService;
