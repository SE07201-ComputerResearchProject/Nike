import { test, expect } from '@playwright/test';
import { LoginPage } from '../page-objects/LoginPage';

test.describe('Authentication Flows', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('TC_AUTH_01: Đăng nhập thành công với quyền Admin và lưu Storage', async ({ page }) => {
    // 1. Giả lập (Mock) API Backend trả về thành công
    await page.route('**/api/auth/login', async (route) => {
      const json = {
        success: true,
        data: {
          accessToken: 'fake-jwt-access-token',
          refreshToken: 'fake-jwt-refresh-token',
          user: { id: 'uuid-123', email: 'admin@ofuture.com', role: 'admin' }
        }
      };
      await route.fulfill({ json });
    });

    // 2. Thực hiện hành động trên UI
    await loginPage.fillCredentials('admin@ofuture.com', 'Admin@OFuture2024!');
    await loginPage.submit();

    // 3. Kiểm thử các kết quả mong đợi
    // Kiểm tra nút chuyển trạng thái "Đang đăng nhập..."
    await expect(loginPage.loginBtn).toHaveText('Đang đăng nhập...');
    
    // Kiểm tra Toast Notification hiển thị đúng màu và nội dung
    await expect(loginPage.notification).toBeVisible();
    await expect(loginPage.notification).toHaveClass(/notification-success/);
    expect(await loginPage.getNotificationMessage()).toContain('Đăng nhập thành công');

    // Kiểm tra chuyển hướng URL đúng logic của role admin
    await page.waitForURL('**/dashboard-admin/indexAdmin.html');

    // Kiểm tra dữ liệu đã được lưu vào localStorage
    const accessToken = await page.evaluate(() => localStorage.getItem('accessToken'));
    const userStorage = await page.evaluate(() => localStorage.getItem('user'));
    
    expect(accessToken).toBe('fake-jwt-access-token');
    expect(JSON.parse(userStorage as string).role).toBe('admin');
  });

  test('TC_AUTH_02: Đăng nhập thất bại do sai mật khẩu', async ({ page }) => {
    // 1. Giả lập API Backend trả về lỗi 401
    await page.route('**/api/auth/login', async (route) => {
      const json = {
        success: false,
        message: 'Sai Email hoặc Mật khẩu.'
      };
      await route.fulfill({ status: 401, json });
    });

    // 2. Thực hiện hành động
    await loginPage.fillCredentials('buyer@ofuture.com', 'wrongpassword');
    await loginPage.submit();

    // 3. Kiểm thử kết quả thất bại
    await expect(loginPage.notification).toBeVisible();
    await expect(loginPage.notification).toHaveClass(/notification-error/);
    expect(await loginPage.getNotificationMessage()).toContain('Sai Email hoặc Mật khẩu');

    // Nút đăng nhập phải được khôi phục trạng thái để bấm lại được
    await expect(loginPage.loginBtn).toBeEnabled();
    await expect(loginPage.loginBtn).toHaveText('Đăng nhập');
  });

  test('TC_AUTH_03: Hiển thị lỗi khi bỏ trống form', async ({ page }) => {
    // Cố tình bỏ trống form và submit
    await loginPage.submit();

    // Hệ thống chặn ở client-side (trong file login.js), không gọi API
    await expect(loginPage.notification).toBeVisible();
    await expect(loginPage.notification).toHaveClass(/notification-error/);
    expect(await loginPage.getNotificationMessage()).toContain('Vui lòng nhập email và mật khẩu');
  });
});