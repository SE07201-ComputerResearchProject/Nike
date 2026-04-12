// ============================================================
// Notification Bell Visibility Control
// ============================================================

// Show notification bell only when user is logged in
function updateNotificationBellVisibility() {
  const token = localStorage.getItem('accessToken');
  const notificationBellWrapper = document.getElementById('notificationBellWrapper');
  
  if (token && notificationBellWrapper) {
    notificationBellWrapper.style.display = 'flex';
  } else if (notificationBellWrapper) {
    notificationBellWrapper.style.display = 'none';
  }
}

// Call on page load
document.addEventListener('DOMContentLoaded', updateNotificationBellVisibility);

// Also check when localStorage changes (login/logout)
window.addEventListener('storage', updateNotificationBellVisibility);
