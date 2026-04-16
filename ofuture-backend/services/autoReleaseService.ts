// services/autoReleaseService.ts
import { pool } from '../config/db';
import OrderController from '../controllers/orderController';
import logger from '../utils/logger';

export const startAutoReleaseWorker = () => {
  // Chạy mỗi 24 giờ
  setInterval(async () => {
    logger.info('[Worker] Bắt đầu quét đơn hàng quá hạn xác nhận...');
    const conn = await pool.getConnection();
    try {
      // Tìm các đơn hàng 'shipped' đã quá 7 ngày
      const [expiredOrders]: any = await conn.execute(
        `SELECT id FROM orders 
         WHERE status = 'shipped' 
         AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND id NOT IN (
            SELECT order_id FROM disputes WHERE status IN ('pending', 'processing')
         )`
      );

      for (const order of expiredOrders) {
        logger.info(`[Worker] Tự động hoàn tất đơn hàng: ${order.id}`);
        // Gọi logic confirmDelivery nhưng với quyền hệ thống (mock request)
        const mockReq: any = { params: { id: order.id }, user: { id: 'SYSTEM', role: 'admin' } };
        const mockRes: any = { status: () => ({ json: () => {} }) };
        await OrderController.confirmDelivery(mockReq, mockRes);
      }
    } catch (err) {
      logger.error('[Worker] Lỗi auto-release:', err);
    } finally {
      conn.release();
    }
  }, 24 * 60 * 60 * 1000);
};