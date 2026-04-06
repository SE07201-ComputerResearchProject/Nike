import { test, expect } from '@playwright/test';
import { CheckoutPage } from '../page-objects/CheckoutPage';

test.describe('Buyer Checkout Flow', () => {
  let checkoutPage: CheckoutPage;

  // Tiêm trạng thái đã đăng nhập trước mỗi bài test
  test.beforeEach(async ({ page }) => {
    await page.goto('/login.html'); // Load 1 trang bất kỳ cùng domain để có thể can thiệp localStorage
    await page.evaluate(() => {
      localStorage.setItem('accessToken', 'fake-buyer-jwt-token');
      localStorage.setItem('user', JSON.stringify({
        id: 'buyer-uuid-123',
        email: 'buyer@ofuture.com',
        role: 'buyer'
      }));
      // Giả lập giỏ hàng có sẵn dữ liệu (nếu giỏ hàng lưu local)
      localStorage.setItem('cart', JSON.stringify([
        { productId: 'prod-001', quantity: 2, price: 500000 }
      ]));
    });

    checkoutPage = new CheckoutPage(page);
  });

  test('TC_BUYER_02: Tiến hành thanh toán COD thành công và chuyển vào Escrow', async ({ page }) => {
    // 1. Mock API tạo đơn hàng của Backend
    await page.route('**/api/orders', async (route) => {
      // Khi FE gọi API tạo đơn, trả về thành công
      await route.fulfill({
        json: {
          success: true,
          message: 'Đặt hàng thành công',
          data: {
            orderId: 'order-uuid-999',
            status: 'pending'
          }
        }
      });
    });

    // 2. Thực hiện hành vi người dùng
    await checkoutPage.gotoCart();
    await checkoutPage.proceedToCheckout();
    
    await checkoutPage.fillCheckoutInfo(
      '123 Đường Sư Vạn Hạnh, Q10, TP.HCM', 
      'Giao giờ hành chính', 
      'cod'
    );
    await checkoutPage.placeOrder();

    // 3. Kiểm thử kết quả
    // Nút đặt hàng phải chuyển sang trạng thái đang xử lý
    await expect(checkoutPage.placeOrderBtn).toBeDisabled();
    
    // Kiểm tra Toast Notification
    await expect(checkoutPage.notification).toBeVisible();
    await expect(checkoutPage.notification).toHaveClass(/notification-success/);
    
    // Hệ thống phải chuyển hướng sang trang chi tiết đơn hàng hoặc danh sách đơn
    await page.waitForURL('**/orders.html');
  });

  test('TC_BUYER_03: Xử lý lỗi khi Backend từ chối thanh toán do hết hàng (Out of Stock)', async ({ page }) => {
    // 1. Mock API trả về lỗi
    await page.route('**/api/orders', async (route) => {
      await route.fulfill({
        status: 400,
        json: {
          success: false,
          message: 'Sản phẩm đã hết hàng trong kho.'
        }
      });
    });

    // 2. Chạy luồng
    await checkoutPage.gotoCart();
    await checkoutPage.proceedToCheckout();
    await checkoutPage.fillCheckoutInfo('123 SVH', '', 'cod');
    await checkoutPage.placeOrder();

    // 3. Kiểm tra thông báo lỗi
    await expect(checkoutPage.notification).toBeVisible();
    await expect(checkoutPage.notification).toHaveClass(/notification-error/);
    await expect(checkoutPage.notification).toContainText('hết hàng');

    // Không được phép chuyển trang
    expect(page.url()).toContain('/checkout.html');
    await expect(checkoutPage.placeOrderBtn).toBeEnabled(); // Nút phải bấm lại được
  });
});