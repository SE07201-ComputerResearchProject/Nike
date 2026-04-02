// ============================================================
// O'Future Seller Dashboard - JavaScript
// API Base URL
// ============================================================

const API_BASE_URL = 'http://localhost:5000/api';

// Store data
let currentUser = null;
let allProducts = [];
let allOrders = [];
let allEscrow = [];
let allReviews = [];

// ============================================================
// Authentication & Initialization
// ============================================================

async function initializeDashboard() {
    // Check if user is authenticated and is a seller
    const token = localStorage.getItem('accessToken');
    const user = localStorage.getItem('user');

    if (!token || !user) {
        window.location.href = '../loginbd.html/login.html';
        return;
    }

    try {
        currentUser = JSON.parse(user);

        // Check if user is seller
        if (currentUser.role !== 'seller') {
            alert('Only sellers can access this dashboard');
            window.location.href = '../index.html';
            return;
        }

        // Update UI with user info
        document.getElementById('username').textContent = currentUser.username;

        // Load initial data
        await loadDashboardData();

        // Setup event listeners
        setupEventListeners();
    } catch (error) {
        console.error('Error initializing dashboard:', error);
        alert('Error loading dashboard. Please login again.');
        window.location.href = '../loginbd.html/login.html';
    }
}

// ============================================================
// API Calls with Auth
// ============================================================

async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('accessToken');

    if (!token) {
        throw new Error('No authentication token found');
    }

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers,
        });

        if (response.status === 401) {
            localStorage.clear();
            window.location.href = '../loginbd.html/login.html';
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// ============================================================
// Data Loading Functions
// ============================================================

async function loadDashboardData() {
    try {
        // Load all data in parallel
        await Promise.all([
            loadProducts(),
            loadOrders(),
            loadEscrow(),
            loadReviews(),
        ]);

        // Update dashboard stats
        updateDashboardStats();
    } catch (error) {
        alert('Error loading dashboard data: ' + error.message);
    }
}

async function loadProducts() {
    try {
        const response = await apiCall(`/products?sellerId=${currentUser.id}`);
        allProducts = response.data || [];
        renderProductsTable();
    } catch (error) {
        console.error('Error loading products:', error);
        document.getElementById('productsTableBody').innerHTML = '<tr><td colspan="5" class="text-center">Error loading products</td></tr>';
    }
}

async function loadOrders() {
    try {
        const response = await apiCall(`/orders?sellerId=${currentUser.id}`);
        allOrders = response.data || [];
        renderOrdersTable();
    } catch (error) {
        console.error('Error loading orders:', error);
        document.getElementById('ordersTableBody').innerHTML = '<tr><td colspan="6" class="text-center">Error loading orders</td></tr>';
    }
}

async function loadEscrow() {
    try {
        const response = await apiCall(`/escrow?sellerId=${currentUser.id}`);
        allEscrow = response.data || [];
        renderEscrowTable();
    } catch (error) {
        console.error('Error loading escrow:', error);
        document.getElementById('escrowTableBody').innerHTML = '<tr><td colspan="4" class="text-center">Error loading escrow</td></tr>';
    }
}

async function loadReviews() {
    try {
        const response = await apiCall(`/reviews?sellerId=${currentUser.id}`);
        allReviews = response.data || [];
        renderReviews();
    } catch (error) {
        console.error('Error loading reviews:', error);
        document.getElementById('reviewsContainer').innerHTML = '<p class="text-center">Error loading reviews</p>';
    }
}

// ============================================================
// Rendering Functions
// ============================================================

function renderProductsTable() {
    const tbody = document.getElementById('productsTableBody');

    if (allProducts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = allProducts
        .map(
            (product) => `
        <tr>
            <td>${product.name}</td>
            <td>$${product.price?.toFixed(2) || '0.00'}</td>
            <td>${product.stock_quantity || 0}</td>
            <td>
                <span class="badge ${product.status === 'active' ? 'badge-success' : 'badge-warning'}">
                    ${product.status || 'unknown'}
                </span>
            </td>
            <td>
                <button class="btn btn-small btn-secondary" onclick="editProduct('${product.id}')">Edit</button>
                <button class="btn btn-small btn-danger" onclick="deleteProduct('${product.id}')">Delete</button>
            </td>
        </tr>
    `
        )
        .join('');

    addBadgeStyles();
}

function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');

    if (allOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No orders found</td></tr>';
        return;
    }

    tbody.innerHTML = allOrders
        .map(
            (order) => `
        <tr>
            <td>${order.id?.substring(0, 8) || 'N/A'}</td>
            <td>${order.buyer?.username || 'Unknown'}</td>
            <td>${order.product?.name || 'Unknown'}</td>
            <td>$${order.total_amount?.toFixed(2) || '0.00'}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(order.status)}">
                    ${order.status || 'unknown'}
                </span>
            </td>
            <td>
                ${order.status === 'paid' ? `<button class="btn btn-small btn-success" onclick="confirmShipping('${order.id}')">Confirm Shipping</button>` : '-'}
            </td>
        </tr>
    `
        )
        .join('');

    addBadgeStyles();
}

function renderEscrowTable() {
    const tbody = document.getElementById('escrowTableBody');

    if (allEscrow.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No escrow records found</td></tr>';
        return;
    }

    tbody.innerHTML = allEscrow
        .map(
            (escrow) => `
        <tr>
            <td>${escrow.order_id?.substring(0, 8) || 'N/A'}</td>
            <td>$${escrow.amount?.toFixed(2) || '0.00'}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(escrow.status)}">
                    ${escrow.status || 'unknown'}
                </span>
            </td>
            <td>${escrow.released_at ? new Date(escrow.released_at).toLocaleDateString() : '-'}</td>
        </tr>
    `
        )
        .join('');

    addBadgeStyles();
}

function renderReviews() {
    const container = document.getElementById('reviewsContainer');

    if (allReviews.length === 0) {
        container.innerHTML = '<p class="text-center">No reviews yet</p>';
        return;
    }

    container.innerHTML = allReviews
        .map(
            (review) => `
        <div class="review-card">
            <div class="review-rating">${'⭐'.repeat(review.rating || 0)}</div>
            <div class="review-product"><strong>${review.product?.name || 'Unknown Product'}</strong></div>
            <div class="review-comment">"${review.body || 'No comment'}"</div>
        </div>
    `
        )
        .join('');
}

function updateDashboardStats() {
    document.getElementById('totalProducts').textContent = allProducts.length;
    document.getElementById('totalOrders').textContent = allOrders.length;

    const totalHeld = allEscrow.reduce((sum, e) => sum + (e.status === 'held' ? (e.amount || 0) : 0), 0);
    const totalReleased = allEscrow.reduce((sum, e) => sum + (e.status === 'released' ? (e.amount || 0) : 0), 0);

    document.getElementById('totalEscrow').textContent = '$' + totalHeld.toFixed(2);
    document.getElementById('totalHeld').textContent = '$' + totalHeld.toFixed(2);
    document.getElementById('totalReleased').textContent = '$' + totalReleased.toFixed(2);

    const avgRating = allReviews.length > 0
        ? (allReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / allReviews.length).toFixed(1)
        : '0';
    document.getElementById('avgRating').textContent = avgRating + ' ⭐';
}

// ============================================================
// Action Functions
// ============================================================

async function addProduct(e) {
    e.preventDefault();

    const name = document.getElementById('productName').value;
    const description = document.getElementById('productDesc').value;
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);

    if (!name || !price || stock < 0) {
        alert('Please fill in all required fields correctly');
        return;
    }

    try {
        const response = await apiCall('/products', {
            method: 'POST',
            body: JSON.stringify({
                name,
                description,
                price,
                stock_quantity: stock,
                seller_id: currentUser.id,
            }),
        });

        alert('Product added successfully!');
        closeProductForm();
        await loadProducts();
    } catch (error) {
        alert('Error adding product: ' + error.message);
    }
}

async function deleteProduct(productId) {
    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
        await apiCall(`/products/${productId}`, {
            method: 'DELETE',
        });

        alert('Product deleted successfully!');
        await loadProducts();
    } catch (error) {
        alert('Error deleting product: ' + error.message);
    }
}

function editProduct(productId) {
    alert('Edit functionality coming soon');
}

async function confirmShipping(orderId) {
    if (!confirm('Confirm shipping for this order?')) return;

    try {
        await apiCall(`/orders/${orderId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({
                status: 'shipped',
            }),
        });

        alert('Order status updated to shipped!');
        await loadOrders();
    } catch (error) {
        alert('Error updating order: ' + error.message);
    }
}

// ============================================================
// Helper Functions
// ============================================================

function getStatusBadgeClass(status) {
    const classes = {
        pending: 'badge-warning',
        paid: 'badge-info',
        shipped: 'badge-info',
        completed: 'badge-success',
        cancelled: 'badge-danger',
        held: 'badge-warning',
        released: 'badge-success',
    };
    return classes[status] || 'badge-secondary';
}

function addBadgeStyles() {
    if (!document.getElementById('badge-styles')) {
        const style = document.createElement('style');
        style.id = 'badge-styles';
        style.textContent = `
            .badge {
                display: inline-block;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
            }
            .badge-success { background-color: #d1fae5; color: #065f46; }
            .badge-warning { background-color: #fed7aa; color: #92400e; }
            .badge-danger { background-color: #fee2e2; color: #991b1b; }
            .badge-info { background-color: #dbeafe; color: #0c2d6b; }
            .badge-secondary { background-color: #e5e7eb; color: #374151; }
        `;
        document.head.appendChild(style);
    }
}

function closeProductForm() {
    document.getElementById('addProductForm').style.display = 'none';
    document.getElementById('productForm').reset();
}

// ============================================================
// Navigation
// ============================================================

function setupEventListeners() {
    // Menu items
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach((item) => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.getAttribute('data-section');
            showSection(section, item);
        });
    });

    // Add product button
    document.getElementById('addProductBtn').addEventListener('click', () => {
        document.getElementById('addProductForm').style.display = 'flex';
    });

    // Product form submission
    document.getElementById('productForm').addEventListener('submit', addProduct);

    // Close product form when clicking outside
    document.getElementById('addProductForm').addEventListener('click', (e) => {
        if (e.target.id === 'addProductForm') {
            closeProductForm();
        }
    });

    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '../loginbd.html/login.html';
    });
}

function showSection(sectionName, menuItem) {
    // Update menu items
    document.querySelectorAll('.menu-item').forEach((item) => {
        item.classList.remove('active');
    });
    menuItem.classList.add('active');

    // Update sections
    document.querySelectorAll('.section').forEach((section) => {
        section.classList.remove('active');
    });

    const section = document.getElementById(`${sectionName}-section`);
    if (section) {
        section.classList.add('active');
    }

    // Update page title
    const titles = {
        dashboard: 'Dashboard',
        products: 'Products',
        orders: 'Orders',
        escrow: 'Escrow Tracking',
        reviews: 'Reviews',
    };
    document.getElementById('pageTitle').textContent = titles[sectionName] || 'Dashboard';
}

// ============================================================
// Initialize on page load
// ============================================================

document.addEventListener('DOMContentLoaded', initializeDashboard);
