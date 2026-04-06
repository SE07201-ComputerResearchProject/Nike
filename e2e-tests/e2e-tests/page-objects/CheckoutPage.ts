import { Page, Locator } from '@playwright/test';

export class CheckoutPage {
  readonly page: Page;
  readonly checkoutBtn: Locator;
  readonly addressInput: Locator;
  readonly noteInput: Locator;
  readonly paymentMethodSelect: Locator;
  readonly placeOrderBtn: Locator;
  readonly notification: Locator;

  constructor(page: Page) {
    this.page = page;
    // Nút thanh toán trong giỏ hàng (cart.html)
    this.checkoutBtn = page.locator('#checkout-btn'); 
    
    // Các trường nhập liệu trong trang thanh toán (checkout.html)
    this.addressInput = page.locator('#shipping-address');
    this.noteInput = page.locator('#order-notes');
    this.paymentMethodSelect = page.locator('#payment-method'); // VD: COD, MoMo
    this.placeOrderBtn = page.locator('#place-order-btn');
    
    // Toast notification chung của hệ thống
    this.notification = page.locator('.notification'); 
  }

  async gotoCart() {
    await this.page.goto('/cart.html');
  }

  async proceedToCheckout() {
    await this.checkoutBtn.click();
    await this.page.waitForURL('**/checkout.html');
  }

  async fillCheckoutInfo(address: string, notes: string, method: 'cod' | 'momo') {
    await this.addressInput.fill(address);
    await this.noteInput.fill(notes);
    await this.paymentMethodSelect.selectOption(method);
  }

  async placeOrder() {
    await this.placeOrderBtn.click();
  }
}