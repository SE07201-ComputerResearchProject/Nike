import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginBtn: Locator;
  readonly notification: Locator;

  constructor(page: Page) {
    this.page = page;
    // Ánh xạ chính xác với các ID trong file login.html/login.js
    this.emailInput = page.locator('#email');
    this.passwordInput = page.locator('#password');
    this.loginBtn = page.locator('#loginBtn');
    // Ánh xạ class của Toast Notification sinh ra từ login.js
    this.notification = page.locator('.notification'); 
  }

  // Hàm mở trang đăng nhập
  async goto() {
    await this.page.goto('/login.html');
  }

  // Hàm nhập thông tin
  async fillCredentials(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  // Hàm click đăng nhập
  async submit() {
    await this.loginBtn.click();
  }

  // Hàm lấy nội dung thông báo (Toast)
  async getNotificationMessage() {
    return await this.notification.textContent();
  }
}