// Profile Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    loadProfile();
    checkRole();
    // Safe event wiring: only attach listeners if elements exist
    const elUpdate = document.getElementById('update-form');
    if (elUpdate) elUpdate.addEventListener('submit', updateProfile);

    const elLogoutAll = document.getElementById('logout-all');
    if (elLogoutAll) elLogoutAll.addEventListener('click', logoutAllDevices);

    const elToggleMfa = document.getElementById('toggle-mfa');
    if (elToggleMfa) elToggleMfa.addEventListener('click', toggleMFA);

    const elRegCodes = document.getElementById('regenerate-codes');
    if (elRegCodes) elRegCodes.addEventListener('click', regenerateBackupCodes);

    const elDelete = document.getElementById('delete-account');
    if (elDelete) elDelete.addEventListener('click', showDeleteConfirm);
    const elConfirmDelete = document.getElementById('confirm-delete');
    if (elConfirmDelete) elConfirmDelete.addEventListener('click', deleteAccount);
    const elCancelDelete = document.getElementById('cancel-delete');
    if (elCancelDelete) elCancelDelete.addEventListener('click', hideDeleteConfirm);

    const elSearchBtn = document.getElementById('search-btn');
    if (elSearchBtn) elSearchBtn.addEventListener('click', loadUsers);
    const elPrev = document.getElementById('prev-page');
    if (elPrev) elPrev.addEventListener('click', () => changePage(-1));
    const elNext = document.getElementById('next-page');
    if (elNext) elNext.addEventListener('click', () => changePage(1));

    const elLogout = document.getElementById('logout');
    if (elLogout) elLogout.addEventListener('click', logout);
});

let currentPage = 1;
const pageSize = 10;

async function loadProfile() {
    try {
        const response = await fetch('/api/auth/me');
        if (!response.ok) throw new Error('Failed to load profile');
        const user = await response.json();
        const fn = document.getElementById('fullName'); if (fn) fn.value = user.fullName || '';
        const ph = document.getElementById('phone'); if (ph) ph.value = user.phone || '';
        const av = document.getElementById('avatar'); if (av) av.value = user.avatar || '';
        const uname = document.getElementById('username'); if (uname) uname.textContent = user.username || '';
        const emailInput = document.getElementById('emailInput'); if (emailInput) emailInput.value = user.email || '';
        const joined = document.getElementById('joined'); if (joined && user.createdAt) joined.textContent = new Date(user.createdAt).toLocaleDateString();
        const last = document.getElementById('lastLogin'); if (last && user.lastLogin) last.textContent = new Date(user.lastLogin).toLocaleDateString();
        if (typeof updateMFAStatus === 'function') updateMFAStatus(user.mfaEnabled);
    } catch (error) {
        alert('Error loading profile: ' + error.message);
    }
}

async function updateProfile(event) {
    event.preventDefault();
    const data = {
        fullName: document.getElementById('fullName').value,
        phone: document.getElementById('phone').value,
        avatar: document.getElementById('avatar').value
    };
    try {
        const response = await fetch('/api/auth/me', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to update profile');
        alert('Profile updated successfully');
    } catch (error) {
        alert('Error updating profile: ' + error.message);
    }
}

async function logoutAllDevices() {
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allDevices: true })
        });
        if (!response.ok) throw new Error('Failed to logout');
        alert('Logged out from all devices');
        window.location.href = 'login.html';
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function toggleMFA() {
    const isEnabled = document.getElementById('mfa-status').textContent.includes('Enabled');
    if (isEnabled) {
        // Disable MFA
        try {
            const response = await fetch('/api/mfa/disable', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to disable MFA');
            updateMFAStatus(false);
            alert('MFA disabled');
        } catch (error) {
            alert('Error: ' + error.message);
        }
    } else {
        // Enable MFA - show QR
        try {
            const response = await fetch('/api/mfa/setup');
            if (!response.ok) throw new Error('Failed to setup MFA');
            const data = await response.json();
            document.getElementById('qr-img').src = data.qrCodeUrl;
            document.getElementById('qr-code').style.display = 'block';
            // After scanning, enable
            document.getElementById('toggle-mfa').textContent = 'Confirm Enable MFA';
            document.getElementById('toggle-mfa').onclick = confirmEnableMFA;
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }
}

async function confirmEnableMFA() {
    try {
        const response = await fetch('/api/mfa/enable', { method: 'POST' });
        if (!response.ok) throw new Error('Failed to enable MFA');
        updateMFAStatus(true);
        document.getElementById('qr-code').style.display = 'none';
        document.getElementById('toggle-mfa').textContent = 'Disable MFA';
        document.getElementById('toggle-mfa').onclick = toggleMFA;
        loadBackupCodes();
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

function updateMFAStatus(enabled) {
    document.getElementById('mfa-status').textContent = enabled ? 'Status: Enabled' : 'Status: Disabled';
    document.getElementById('toggle-mfa').textContent = enabled ? 'Disable MFA' : 'Enable MFA';
    if (enabled) {
        loadBackupCodes();
    } else {
        document.getElementById('backup-codes').style.display = 'none';
    }
}

async function loadBackupCodes() {
    try {
        const response = await fetch('/api/mfa/backup-codes');
        if (!response.ok) throw new Error('Failed to load backup codes');
        const codes = await response.json();
        const list = document.getElementById('codes-list');
        list.innerHTML = '';
        codes.forEach(code => {
            const li = document.createElement('li');
            li.textContent = code;
            list.appendChild(li);
        });
        document.getElementById('backup-codes').style.display = 'block';
    } catch (error) {
        alert('Error loading backup codes: ' + error.message);
    }
}

async function regenerateBackupCodes() {
    try {
        const response = await fetch('/api/mfa/regenerate-backup-codes', { method: 'POST' });
        if (!response.ok) throw new Error('Failed to regenerate codes');
        loadBackupCodes();
        alert('Backup codes regenerated');
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

function showDeleteConfirm() {
    document.getElementById('delete-confirm').style.display = 'block';
}

function hideDeleteConfirm() {
    document.getElementById('delete-confirm').style.display = 'none';
}

async function deleteAccount() {
    const password = document.getElementById('delete-password').value;
    if (!password) {
        alert('Please enter your password');
        return;
    }
    try {
        const response = await fetch('/api/auth/me', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (!response.ok) throw new Error('Failed to delete account');
        alert('Account deleted');
        window.location.href = 'index.html';
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function checkRole() {
    // Assume role is in user data or separate call
    try {
        const response = await fetch('/api/auth/me');
        const user = await response.json();
        if (user.role === 'admin') {
            document.getElementById('admin-panel').style.display = 'block';
            loadUsers();
        }
    } catch (error) {
        // Ignore
    }
}

async function loadUsers(page = 1) {
    const search = document.getElementById('search-user').value;
    const role = document.getElementById('filter-role').value;
    const params = new URLSearchParams({ page, limit: pageSize, search, role });
    try {
        const response = await fetch(`/api/admin/users?${params}`);
        if (!response.ok) throw new Error('Failed to load users');
        const data = await response.json();
        renderUsers(data.users);
        updatePagination(data.totalPages, page);
    } catch (error) {
        alert('Error loading users: ' + error.message);
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '';
    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${user.email}</td>
            <td>${user.role}</td>
            <td>${user.isActive ? 'Active' : 'Suspended'}</td>
            <td>
                <button onclick="suspendUser(${user.id})">${user.isActive ? 'Suspend' : 'Unsuspend'}</button>
                <button onclick="unlockUser(${user.id})">Unlock</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function updatePagination(totalPages, current) {
    document.getElementById('page-info').textContent = `Page ${current} of ${totalPages}`;
    document.getElementById('prev-page').disabled = current === 1;
    document.getElementById('next-page').disabled = current === totalPages;
}

function changePage(delta) {
    currentPage += delta;
    loadUsers(currentPage);
}

async function suspendUser(id) {
    try {
        const response = await fetch(`/api/admin/users/${id}/suspend`, { method: 'PUT' });
        if (!response.ok) throw new Error('Failed to suspend user');
        loadUsers(currentPage);
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function unlockUser(id) {
    try {
        const response = await fetch(`/api/admin/users/${id}/unlock`, { method: 'PUT' });
        if (!response.ok) throw new Error('Failed to unlock user');
        loadUsers(currentPage);
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = 'login.html';
    } catch (error) {
        // Ignore
    }
}