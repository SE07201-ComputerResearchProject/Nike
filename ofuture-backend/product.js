/* ================================
   CONFIG
================================ */
const API_URL = "http://localhost:3000/api/products";

let cart = JSON.parse(localStorage.getItem("cart")) || [];
let products = [];
let currentCategory = "all";

/* ================================
   LOAD PRODUCTS FROM API
================================ */
async function fetchProducts() {
    try {
        const res = await fetch(API_URL);
        products = await res.json();

        renderProducts();
    } catch (err) {
        console.error("Cannot load products:", err);
    }
}

/* ================================
   RENDER PRODUCTS
================================ */
function renderProducts() {

    const container = document.getElementById("product-list");
    if (!container) return;

    container.innerHTML = "";

    let filteredProducts = products;

    // FILTER CATEGORY
    if (currentCategory !== "all") {
        filteredProducts = products.filter(
            p => p.category === currentCategory
        );
    }

    // NO PRODUCT
    if (filteredProducts.length === 0) {
        container.innerHTML = "<p>No products found</p>";
        return;
    }

    filteredProducts.forEach(p => {

        container.innerHTML += `
            <div class="product-card">

                <img src="${p.image}" 
                     alt="${p.name}"
                     onerror="this.src='https://via.placeholder.com/300'">

                <h3>${p.name}</h3>
                <p class="price">$${p.price}</p>

                <button onclick="addToCart(
                    '${p._id}',
                    '${p.name}',
                    ${p.price}
                )">
                    Add To Cart
                </button>

            </div>
        `;
    });
}

/* ================================
   CATEGORY MENU CLICK
================================ */
document.addEventListener("DOMContentLoaded", () => {

    const menuItems = document.querySelectorAll(".category-menu a");

    menuItems.forEach(item => {

        item.addEventListener("click", function () {

            // remove active
            menuItems.forEach(a => a.classList.remove("active"));

            // add active
            this.classList.add("active");

            // set category
            currentCategory = this.dataset.category;

            renderProducts();
        });
    });

});

/* ================================
   CART LOGIC
================================ */
function addToCart(id, name, price) {

    const item = cart.find(i => i.id === id);

    if (item) {
        item.qty++;
    } else {
        cart.push({ id, name, price, qty: 1 });
    }

    saveCart();
    renderCart();
}

/* ================================
   RENDER CART
================================ */
function renderCart() {

    const container = document.getElementById("cart-items");
    const totalEl = document.getElementById("total");

    if (!container || !totalEl) return;

    container.innerHTML = "";

    let total = 0;

    cart.forEach(item => {

        total += item.price * item.qty;

        container.innerHTML += `
            <div class="cart-item">
                ${item.name} x${item.qty}
                <span>$${item.price * item.qty}</span>
            </div>
        `;
    });

    totalEl.innerText = "Total: $" + total;

    const count = document.getElementById("cart-count");
    if (count) count.innerText = cart.length;
}

/* ================================
   SAVE CART
================================ */
function saveCart() {
    localStorage.setItem("cart", JSON.stringify(cart));
}

/* ================================
   TOGGLE CART
================================ */
function toggleCart() {
    document.getElementById("cart").classList.toggle("active");
}

/* ================================
   INIT
================================ */
fetchProducts();
renderCart();
