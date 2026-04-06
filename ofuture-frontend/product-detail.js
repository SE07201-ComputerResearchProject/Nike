document.addEventListener("DOMContentLoaded", async () => {
    // 1. LẤY ID SẢN PHẨM TỪ URL (VD: product-detail.html?id=5)
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        alert("Không tìm thấy thông tin sản phẩm!");
        window.location.href = "product.html";
        return;
    }

    // Biến toàn cục lưu thông tin sản phẩm hiện tại để dùng cho Cart và Sample
    let currentProduct = null;

    // 2. GỌI API LOAD CHI TIẾT SẢN PHẨM
    async function loadProductDetail() {
        try {
            // Giả định backend có route GET /api/products/:id
            const response = await fetchAPI(`/products/${productId}`);
            currentProduct = response.data;

            // Đổ dữ liệu vào DOM (Yêu cầu file HTML phải có các ID tương ứng này)
            const elImage = document.getElementById('productImage');
            const elThumbnails = document.getElementById('productThumbnails');
            const elName = document.getElementById('productName');
            const elPrice = document.getElementById('productPrice');
            const elDesc = document.getElementById('productDesc');
            const elMoq = document.getElementById('productMoq'); // Chỗ hiển thị "10 thùng"

            if (currentProduct.imageUrls && currentProduct.imageUrls.length > 0) {
                // Hiển thị ảnh lớn đầu tiên
                if (elImage) elImage.src = `http://localhost:5000${currentProduct.imageUrls[0]}`;
                
                // Render các ảnh nhỏ (Thumbnail)
                if (elThumbnails) {
                    elThumbnails.innerHTML = currentProduct.imageUrls.map((img, index) => `
                        <img src="http://localhost:5000${img}" 
                             style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 2px solid ${index === 0 ? 'var(--accent)' : 'transparent'}; transition: all 0.2s;"
                             onclick="changeMainImage('http://localhost:5000${img}', this)"
                             alt="Thumbnail">
                    `).join('');
                }
            } else {
                if (elImage) elImage.src = 'https://via.placeholder.com/700x420?text=No+Image'; // Ảnh mặc định nếu SP không có ảnh
            }

            // Gắn hàm đổi ảnh vào window để onclick HTML gọi được
            window.changeMainImage = function(src, element) {
                document.getElementById('productImage').src = src;
                // Cập nhật viền cho ảnh đang chọn
                const thumbs = document.getElementById('productThumbnails').children;
                for (let t of thumbs) t.style.borderColor = 'transparent';
                element.style.borderColor = 'var(--accent)';
            };
            if (elName) elName.textContent = currentProduct.name;
            if (elPrice) elPrice.textContent = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(currentProduct.price);
            if (elDesc) elDesc.textContent = currentProduct.description || 'Chưa có mô tả';
            if (elMoq) elMoq.textContent = `${currentProduct.moq} sản phẩm`; // Hiển thị Số lượng tối thiểu (MOQ)

            // Cập nhật thuộc tính min của ô nhập số lượng giỏ hàng
            const qtyInput = document.getElementById('cartQuantity');
            if (qtyInput) {
                qtyInput.min = currentProduct.moq || 1;
                qtyInput.value = currentProduct.moq || 1;
            }

        } catch (error) {
            console.error("Lỗi tải chi tiết sản phẩm:", error);
            alert("Không thể tải thông tin sản phẩm hoặc sản phẩm không tồn tại!");
        }
    }

    // --- LOGIC 1: YÊU CẦU HÀNG MẪU (SAMPLE REQUEST) ---
    const btnRequestSample = document.getElementById("btn-request-sample");
    const sampleModal = document.getElementById("sampleModal");
    const closeSampleModal = document.getElementById("closeSampleModal");
    const submitSampleRequest = document.getElementById("submitSampleRequest");

    if (btnRequestSample && sampleModal) {
        btnRequestSample.addEventListener("click", () => {
            if (!currentProduct) return alert("Dữ liệu sản phẩm chưa sẵn sàng!");
            sampleModal.style.display = "flex";
        });

        closeSampleModal.addEventListener("click", () => {
            sampleModal.style.display = "none";
        });

        submitSampleRequest.addEventListener("click", async () => {
            const depositInput = document.getElementById("sampleDeposit").value;
            const notesInput = document.getElementById("sampleNotes").value;

            if (!depositInput || depositInput < 0) {
                return alert("Vui lòng nhập số tiền cọc hợp lệ!");
            }

            try {
                // Tắt nút để chống spam click
                submitSampleRequest.disabled = true;
                submitSampleRequest.textContent = "Đang gửi...";

                // Gọi API tạo Sample Request (Khớp với thiết kế DB SampleRequests)
                await fetchAPI('/samples', {
                    method: 'POST',
                    body: JSON.stringify({
                        productId: productId,
                        notes: notesInput
                    })
                });

                alert(`Đã gửi yêu cầu nhận hàng mẫu thành công! Seller sẽ sớm phản hồi.`);
                sampleModal.style.display = "none";
                
                // Reset form
                document.getElementById("sampleDeposit").value = "";
                document.getElementById("sampleNotes").value = "";

            } catch (error) {
                alert(error.message || "Lỗi khi gửi yêu cầu hàng mẫu.");
            } finally {
                submitSampleRequest.disabled = false;
                submitSampleRequest.textContent = "Gửi yêu cầu";
            }
        });
    }

    // --- LOGIC 2: THÊM VÀO GIỎ HÀNG (ADD TO CART) ---
    // Lưu ý: Nút thêm giỏ hàng có thể là id="btnAddToCart" hoặc class="add-cart-btn"
    const addCartBtn = document.querySelector(".add-cart-btn");
    
    if (addCartBtn) {
        addCartBtn.addEventListener("click", async () => {
            if (!currentProduct) return alert("Dữ liệu sản phẩm chưa sẵn sàng!");

            const qtyInput = document.getElementById('cartQuantity');
            const quantity = qtyInput ? parseInt(qtyInput.value) : (currentProduct.moq || 1);

            if (quantity < currentProduct.moq) {
                return alert(`Bạn phải mua tối thiểu ${currentProduct.moq} sản phẩm!`);
            }

            try {
                addCartBtn.disabled = true;
                addCartBtn.textContent = "Đang thêm...";

                // Gọi API thêm vào giỏ hàng (Giả định route POST /api/cart)
                await fetchAPI('/cart', {
                    method: 'POST',
                    body: JSON.stringify({
                        product_id: productId,
                        quantity: quantity
                    })
                });

                alert("Sản phẩm đã được thêm vào giỏ hàng!");
                // Tùy chọn: Chuyển hướng sang giỏ hàng luôn
                // window.location.href = "cart.html";

            } catch (error) {
                alert(error.message || "Lỗi khi thêm vào giỏ hàng.");
            } finally {
                addCartBtn.disabled = false;
                addCartBtn.textContent = "Thêm vào giỏ hàng";
            }
        });
    }

    // 3. KHỞI CHẠY LOAD DỮ LIỆU KHI MỞ TRANG
    loadProductDetail();
});