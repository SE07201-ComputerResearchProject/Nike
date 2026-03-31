document.addEventListener("DOMContentLoaded", () => {
  const addButtons = document.querySelectorAll(".add-cart-btn");

  addButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      alert("Sản phẩm đã được thêm vào giỏ hàng!");
    });
  });

  const checkoutBtn = document.getElementById("checkoutBtn");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      alert("Đã xác nhận đơn hàng và tạo giao dịch ký quỹ!");
    });
  }

  const saveProfileBtn = document.getElementById("saveProfileBtn");
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", () => {
      alert("Thông tin hồ sơ đã được cập nhật!");
    });
  }
});