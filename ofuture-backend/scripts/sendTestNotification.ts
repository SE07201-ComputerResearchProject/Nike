import notificationService from '../services/notificationService';

(async () => {
  try {
    const id = await notificationService.sendAlert('test-user-123', 'Test Notification', 'This is a test notification from automated script', '/');
    console.log('Created notification id:', id);
    process.exit(0);
  } catch (err) {
    console.error('Failed to send test notification:', err);
    process.exit(1);
  }
})();