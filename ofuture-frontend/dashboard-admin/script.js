// ============================================================
// O'Future Admin Dashboard - JavaScript
// API Base URL
// ============================================================

const API_BASE_URL = 'http://localhost:5000/api';

// Store data
let currentAdmin = null;
let allUsers = [];
let allEscrow = [];
let allPayments = [];
let allLogs = [];

// ============================================================
// Authentication & Initialization
// ============================================================

async function initializeDashboard() {
    // Check if user is authenticated and is admin
    const token = localStorage.getItem('accessToken');
    const user = localStorage.getItem('user');

    if (!token || !user) {
        window.location.href = '../loginbd.html/login.html';
        return;
    }

    try {
        currentAdmin = JSON.parse(user);

        // Check if user is admin
        if (currentAdmin.role !== 'admin') {
            alert('Only admins can access this dashboard');
            window.location.href = '../index.html';
            return;
        }

        // Update UI with user info
        document.getElementById('username').textContent = currentAdmin.username;

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
            loadAllUsers(),
            loadDisputedEscrow(),
            loadPayments(),
            loadSystemLogs(),
        ]);

        // Update dashboard stats
        updateDashboardStats();
    } catch (error) {
        alert('Error loading dashboard data: ' + error.message);
    }
}

async function loadUsers() {
    try {
        const response = await apiCall('/admin/users');
        allUsers = response.data || [];
        renderUsersTable();
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('usersTableBody').innerHTML = '<tr><td colspan="7" class="text-center">Error loading users</td></tr>';
    }
}

async function loadEscrow() {
    try {
        const response = await apiCall('/admin/escrow');
        allEscrow = response.data || [];
        renderEscrowTable();
    } catch (error) {
        console.error('Error loading escrow:', error);
        document.getElementById('escrowTableBody').innerHTML = '<tr><td colspan="7" class="text-center">Error loading escrow</td></tr>';
    }
}

async function loadPayments() {
    try {
        const response = await apiCall('/admin/payments');
        allPayments = response.data || [];
        renderPaymentsTable();
    } catch (error) {
        console.error('Error loading payments:', error);
        document.getElementById('paymentsTableBody').innerHTML = '<tr><td colspan="7" class="text-center">Error loading payments</td></tr>';
    }
}

async function loadLogs() {
    try {
        const response = await apiCall('/admin/logs');
        allLogs = response.data || [];
        renderLogs();
    } catch (error) {
        console.error('Error loading logs:', error);
        document.getElementById('logsContainer').innerHTML = '<p class="text-center">Error loading logs</p>';
    }
}

// ============================================================
// Rendering Functions
// ============================================================

function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');

    if (allUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No users found</td></tr>';
        return;
    }

    tbody.innerHTML = allUsers
        .map(
            (user) => `
        <tr>
            <td>${user.email}</td>
            <td>${user.username}</td>
            <td>${user.full_name || '-'}</td>
            <td>
                <span class="badge badge-${user.role === 'admin' ? 'admin' : user.role === 'seller' ? 'info' : 'secondary'}">
                    ${user.role || 'user'}
                </span>
            </td>
            <td>
                <span class="badge ${user.status === 'active' ? 'badge-success' : 'badge-danger'}">
                    ${user.status === 'active' ? 'Active' : 'Blocked'}
                </span>
            </td>
            <td class="text-muted">${new Date(user.created_at).toLocaleDateString()}</td>
            <td>
                ${user.status === 'active'
                    ? `<button class="btn btn-small btn-danger" onclick="toggleUserStatus('${user.id}', 'lock')">Block</button>`
                    : `<button class="btn btn-small btn-success" onclick="toggleUserStatus('${user.id}', 'unlock')">Unblock</button>`}
            </td>
        </tr>
    `
        )
        .join('');
}

function renderEscrowTable() {
    const tbody = document.getElementById('escrowTableBody');

    if (allEscrow.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No disputed escrow records found</td></tr>';
        return;
    }

    tbody.innerHTML = allEscrow
        .map(
            (escrow) => `
        <tr>
            <td>${escrow.id?.substring(0, 8) || 'N/A'}</td>
            <td>${escrow.buyer?.username || 'Unknown'}</td>
            <td>${escrow.seller?.username || 'Unknown'}</td>
            <td>$${escrow.amount?.toFixed(2) || '0.00'}</td>
            <td class="text-muted">${new Date(escrow.created_at).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-small btn-primary" onclick="resolveDispute('${escrow.id}')">Resolve</button>
            </td>
        </tr>
    `
        )
        .join('');
}

function renderPaymentsTable() {
    const tbody = document.getElementById('paymentsTableBody');

    if (allPayments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No payments found</td></tr>';
        return;
    }

    tbody.innerHTML = allPayments
        .map(
            (payment) => `
        <tr>
            <td>${payment.id?.substring(0, 8) || 'N/A'}</td>
            <td>${payment.user?.username || 'Unknown'}</td>
            <td>$${payment.amount?.toFixed(2) || '0.00'}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(payment.status)}">
                    ${payment.status || 'unknown'}
                </span>
            </td>
            <td>${payment.gateway || '-'}</td>
            <td class="text-muted">${new Date(payment.created_at).toLocaleDateString()}</td>
            <td>
                ${
                    payment.status === 'pending'
                        ? `
                    <button class="btn btn-small btn-success" onclick="approvePayment('${payment.id}')">Approve</button>
                    <button class="btn btn-small btn-danger" onclick="rejectPayment('${payment.id}')">Reject</button>
                `
                        : '-'
                }
            </td>
        </tr>
    `
        )
        .join('');
}

function renderLogs() {
    const container = document.getElementById('logsContainer');

    if (allLogs.length === 0) {
        container.innerHTML = '<p class="text-center">No logs found</p>';
        return;
    }

    container.innerHTML = allLogs
        .slice(0, 50)
        .map(
            (log) => `
        <div class="log-entry">
            <div class="log-time">${new Date(log.created_at).toLocaleString()}</div>
            <div class="log-event">${log.event_type || 'Unknown Event'}</div>
            <div class="log-details">
                User: ${log.user?.username || 'System'} | 
                ${log.message || 'No details'}
            </div>
        </div>
    `
        )
        .join('');
}

function updateDashboardStats() {
    // Users stats
    const totalUsers = allUsers.length;
    const totalSellers = allUsers.filter((u) => u.role === 'seller').length;
    document.getElementById('totalUsers').textContent = totalUsers;
    document.getElementById('totalSellers').textContent = totalSellers;

    // Escrow stats
    const totalHeld = allEscrow.reduce((sum, e) => sum + (e.status === 'held' ? (e.amount || 0) : 0), 0);
    const totalReleased = allEscrow.reduce((sum, e) => sum + (e.status === 'released' ? (e.amount || 0) : 0), 0);
    const totalPending = allEscrow.reduce((sum, e) => sum + (e.status === 'pending' || e.status === 'processing' ? (e.amount || 0) : 0), 0);

    document.getElementById('totalEscrowBalance').textContent = '$' + totalHeld.toFixed(2);
    document.getElementById('escrowHeld').textContent = '$' + totalHeld.toFixed(2);
    document.getElementById('escrowReleased').textContent = '$' + totalReleased.toFixed(2);
    document.getElementById('escrowPending').textContent = '$' + totalPending.toFixed(2);

    // Transactions
    document.getElementById('totalTransactions').textContent = allEscrow.length;
}

// ============================================================
// Action Functions
// ============================================================

async function blockUser(userId) {
    if (!confirm('Are you sure you want to block this user?')) return;

    try {
        await apiCall(`/admin/users/${userId}/block`, {
            method: 'PATCH',
        });

        alert('User blocked successfully!');
        await loadUsers();
    } catch (error) {
        alert('Error blocking user: ' + error.message);
    }
}

async function unblockUser(userId) {
    if (!confirm('Are you sure you want to unblock this user?')) return;

    try {
        await apiCall(`/admin/users/${userId}/unblock`, {
            method: 'PATCH',
        });

        alert('User unblocked successfully!');
        await loadUsers();
    } catch (error) {
        alert('Error unblocking user: ' + error.message);
    }
}

async function releaseEscrow(escrowId) {
    if (!confirm('Release funds for this escrow transaction?')) return;

    try {
        await apiCall('/admin/escrow/release', {
            method: 'POST',
            body: JSON.stringify({
                escrow_id: escrowId,
            }),
        });

        alert('Escrow funds released successfully!');
        await loadEscrow();
    } catch (error) {
        alert('Error releasing escrow: ' + error.message);
    }
}

async function approvePayment(paymentId) {
    if (!confirm('Approve this payment?')) return;

    try {
        await apiCall(`/admin/payments/${paymentId}/approve`, {
            method: 'PATCH',
        });

        alert('Payment approved successfully!');
        await loadPayments();
    } catch (error) {
        alert('Error approving payment: ' + error.message);
    }
}

async function rejectPayment(paymentId) {
    const reason = prompt('Reason for rejection:');
    if (!reason) return;

    try {
        await apiCall(`/admin/payments/${paymentId}/reject`, {
            method: 'PATCH',
            body: JSON.stringify({
                reason,
            }),
        });

        alert('Payment rejected successfully!');
        await loadPayments();
    } catch (error) {
        alert('Error rejecting payment: ' + error.message);
    }
}

// ============================================================
// NEW ADMIN FUNCTIONS - User Management
// ============================================================

async function loadAllUsers() {
    try {
        const response = await apiCall('/admin/users');
        allUsers = response.data || [];
        renderUsersTable();
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('usersTableBody').innerHTML = '<tr><td colspan="7" class="text-center">Error loading users</td></tr>';
    }
}

async function toggleUserStatus(userId, action) {
    const actionText = action === 'lock' ? 'block' : 'unblock';
    const reason = prompt(`Reason for ${actionText}ing user:`);
    if (!reason) return;

    try {
        await apiCall(`/admin/users/${userId}/status`, {
            method: 'PUT',
            body: JSON.stringify({
                action,
                reason,
            }),
        });

        alert(`User ${actionText}ed successfully!`);
        await loadAllUsers();
    } catch (error) {
        alert(`Error ${actionText}ing user: ` + error.message);
    }
}

// ============================================================
// NEW ADMIN FUNCTIONS - Escrow Disputes
// ============================================================

async function loadDisputedEscrow() {
    try {
        const response = await apiCall('/admin/escrow?status=disputed');
        allEscrow = response.data || [];
        renderEscrowTable();
    } catch (error) {
        console.error('Error loading disputed escrow:', error);
        document.getElementById('escrowTableBody').innerHTML = '<tr><td colspan="6" class="text-center">Error loading escrow disputes</td></tr>';
    }
}

// ============================================================
// NEW ADMIN FUNCTIONS - System Logs
// ============================================================

async function loadSystemLogs() {
    try {
        const response = await apiCall('/admin/system-logs');
        allLogs = response.data || [];
        renderSystemLogsTable();
    } catch (error) {
        console.error('Error loading system logs:', error);
        document.getElementById('logsTableBody').innerHTML = '<tr><td colspan="7" class="text-center">Error loading logs</td></tr>';
    }
}

function renderSystemLogsTable() {
    const tbody = document.getElementById('logsTableBody');

    if (allLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No logs found</td></tr>';
        return;
    }

    tbody.innerHTML = allLogs
        .slice(0, 100) // Show first 100 logs
        .map(
            (log) => `
        <tr>
            <td class="text-muted">${new Date(log.created_at).toLocaleString()}</td>
            <td>
                <span class="badge badge-${getSeverityClass(log.severity)}">
                    ${log.severity || 'info'}
                </span>
            </td>
            <td>${log.event_type || '-'}</td>
            <td class="text-truncate" style="max-width: 300px;" title="${log.message || ''}">${log.message || '-'}</td>
            <td>${log.user_id || '-'}</td>
            <td>${log.ip_address || '-'}</td>
            <td>${log.endpoint || '-'}</td>
        </tr>
    `
        )
        .join('');
}

function getSeverityClass(severity) {
    switch (severity) {
        case 'error':
        case 'critical':
            return 'danger';
        case 'warn':
            return 'warning';
        case 'info':
        default:
            return 'info';
    }
}

// ============================================================
// Dispute Resolution Function
// ============================================================

async function resolveDispute(escrowId) {
    const decision = prompt('Enter resolution decision (e.g., "Release to buyer", "Release to seller", "Refund"):');
    if (!decision) return;

    const reason = prompt('Reason for resolution:');
    if (!reason) return;

    try {
        await apiCall(`/admin/escrow/${escrowId}/resolve`, {
            method: 'PUT',
            body: JSON.stringify({
                decision,
                reason,
            }),
        });

        alert('Dispute resolved successfully!');
        await loadDisputedEscrow();
    } catch (error) {
        alert('Error resolving dispute: ' + error.message);
    }
}

// ============================================================
// Update initialization to load new data
// ============================================================

async function loadDashboardData() {
    await Promise.all([
        loadAllUsers(),
        loadDisputedEscrow(),
        loadSystemLogs(),
        // Keep existing loads
        loadPayments(),
        loadLogs(),
    ]);
}

// ============================================================
// Helper Functions
// ============================================================

function getStatusBadgeClass(status) {
    const classes = {
        pending: 'badge-warning',
        approved: 'badge-success',
        rejected: 'badge-danger',
        held: 'badge-warning',
        releasing: 'badge-info',
        released: 'badge-success',
        active: 'badge-success',
        blocked: 'badge-danger',
    };
    return classes[status] || 'badge-secondary';
}

// ============================================================
// Navigation & Events
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

    // Search & filters
    document.getElementById('userSearch').addEventListener('input', (e) => {
        filterUsers(e.target.value);
    });

    document.getElementById('escrowStatusFilter').addEventListener('change', (e) => {
        filterEscrow(e.target.value);
    });

    document.getElementById('paymentStatusFilter').addEventListener('change', (e) => {
        filterPayments(e.target.value);
    });

    document.getElementById('logTypeFilter').addEventListener('change', (e) => {
        filterLogs(e.target.value);
    });

    document.getElementById('systemLogSeverityFilter').addEventListener('change', (e) => {
        filterSystemLogs(e.target.value);
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
        users: 'User Management',
        escrow: 'Escrow Management',
        payments: 'Payment Management',
        logs: 'Activity Logs',
        'system-logs': 'System Logs',
    };
    document.getElementById('pageTitle').textContent = titles[sectionName] || 'Dashboard';
}

// ============================================================
// Filtering Functions
// ============================================================

function filterUsers(searchTerm) {
    const tbody = document.getElementById('usersTableBody');
    const filtered = allUsers.filter(
        (user) =>
            user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No users match your search</td></tr>';
        return;
    }

    tbody.innerHTML = filtered
        .map(
            (user) => `
        <tr>
            <td>${user.email}</td>
            <td>${user.username}</td>
            <td>${user.full_name || '-'}</td>
            <td>
                <span class="badge badge-${user.role === 'admin' ? 'admin' : user.role === 'seller' ? 'info' : 'secondary'}">
                    ${user.role || 'user'}
                </span>
            </td>
            <td>
                <span class="badge ${user.is_active ? 'badge-success' : 'badge-danger'}">
                    ${user.is_active ? 'Active' : 'Blocked'}
                </span>
            </td>
            <td class="text-muted">${new Date(user.created_at).toLocaleDateString()}</td>
            <td>
                ${user.is_active
                    ? `<button class="btn btn-small btn-danger" onclick="blockUser('${user.id}')">Block</button>`
                    : `<button class="btn btn-small btn-success" onclick="unblockUser('${user.id}')">Unblock</button>`}
            </td>
        </tr>
    `
        )
        .join('');
}

function filterEscrow(status) {
    if (!status) {
        renderEscrowTable();
        return;
    }

    const tbody = document.getElementById('escrowTableBody');
    const filtered = allEscrow.filter((e) => e.status === status);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">No escrow records with status: ${status}</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered
        .map(
            (escrow) => `
        <tr>
            <td>${escrow.id?.substring(0, 8) || 'N/A'}</td>
            <td>${escrow.buyer?.username || 'Unknown'}</td>
            <td>${escrow.seller?.username || 'Unknown'}</td>
            <td>$${escrow.amount?.toFixed(2) || '0.00'}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(escrow.status)}">
                    ${escrow.status || 'unknown'}
                </span>
            </td>
            <td class="text-muted">${new Date(escrow.created_at).toLocaleDateString()}</td>
            <td>
                ${escrow.status === 'held' ? `<button class="btn btn-small btn-success" onclick="releaseEscrow('${escrow.id}')">Release</button>` : '-'}
            </td>
        </tr>
    `
        )
        .join('');
}

function filterPayments(status) {
    if (!status) {
        renderPaymentsTable();
        return;
    }

    const tbody = document.getElementById('paymentsTableBody');
    const filtered = allPayments.filter((p) => p.status === status);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">No payments with status: ${status}</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered
        .map(
            (payment) => `
        <tr>
            <td>${payment.id?.substring(0, 8) || 'N/A'}</td>
            <td>${payment.user?.username || 'Unknown'}</td>
            <td>$${payment.amount?.toFixed(2) || '0.00'}</td>
            <td>
                <span class="badge ${getStatusBadgeClass(payment.status)}">
                    ${payment.status || 'unknown'}
                </span>
            </td>
            <td>${payment.gateway || '-'}</td>
            <td class="text-muted">${new Date(payment.created_at).toLocaleDateString()}</td>
            <td>
                ${
                    payment.status === 'pending'
                        ? `
                    <button class="btn btn-small btn-success" onclick="approvePayment('${payment.id}')">Approve</button>
                    <button class="btn btn-small btn-danger" onclick="rejectPayment('${payment.id}')">Reject</button>
                `
                        : '-'
                }
            </td>
        </tr>
    `
        )
        .join('');
}

function filterLogs(eventType) {
    if (!eventType) {
        renderLogs();
        return;
    }

    const filtered = allLogs.filter((log) => log.event_type === eventType);
    const container = document.getElementById('logsContainer');

    if (filtered.length === 0) {
        container.innerHTML = `<p class="text-center">No logs with event type: ${eventType}</p>`;
        return;
    }

    container.innerHTML = filtered
        .slice(0, 50)
        .map(
            (log) => `
        <div class="log-entry">
            <div class="log-time">${new Date(log.created_at).toLocaleString()}</div>
            <div class="log-event">${log.event_type || 'Unknown Event'}</div>
            <div class="log-details">
                User: ${log.user?.username || 'System'} | 
                ${log.message || 'No details'}
            </div>
        </div>
    `
        )
        .join('');
}

function filterSystemLogs(severity) {
    if (!severity) {
        renderSystemLogsTable();
        return;
    }

    const tbody = document.getElementById('logsTableBody');
    const filtered = allLogs.filter((log) => log.severity === severity);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">No logs with severity: ${severity}</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered
        .slice(0, 100)
        .map(
            (log) => `
        <tr>
            <td class="text-muted">${new Date(log.created_at).toLocaleString()}</td>
            <td>
                <span class="badge badge-${getSeverityClass(log.severity)}">
                    ${log.severity || 'info'}
                </span>
            </td>
            <td>${log.event_type || '-'}</td>
            <td class="text-truncate" style="max-width: 300px;" title="${log.message || ''}">${log.message || '-'}</td>
            <td>${log.user_id || '-'}</td>
            <td>${log.ip_address || '-'}</td>
            <td>${log.endpoint || '-'}</td>
        </tr>
    `
        )
        .join('');
}

// ============================================================
// Initialize on page load
// ============================================================

document.addEventListener('DOMContentLoaded', initializeDashboard);
