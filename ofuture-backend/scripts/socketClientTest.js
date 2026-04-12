const io = require('socket.io-client');

const socket = io('http://localhost:5000', {
  auth: { userId: 'test-user-123', token: 'dev-token' },
  transports: ['websocket']
});

socket.on('connect', () => {
  console.log('client connected', socket.id);
});

socket.on('notification', (n) => {
  console.log('received notification:', n);
});

socket.on('connect_error', (err) => {
  console.error('connect_error', err.message);
});

// keep alive
setTimeout(() => { console.log('exiting client'); process.exit(0); }, 15000);