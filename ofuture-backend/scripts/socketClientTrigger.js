const io = require('socket.io-client');
const http = require('http');

const socket = io('http://localhost:5000', {
  auth: { userId: 'test-user-123', token: 'dev-token' },
  transports: ['websocket'],
  reconnectionDelay: 1000
});

socket.on('connect', () => {
  console.log('client connected', socket.id);
  // Trigger server-side debug notify
  const postData = JSON.stringify({ userId: 'test-user-123', title: 'WS Test', message: 'Real-time test' });
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/debug/notify',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    console.log('POST status:', res.statusCode);
    res.on('data', (chunk) => { console.log('POST response:', chunk.toString()); });
  });
  req.on('error', (e) => { console.error('POST error:', e); });
  req.write(postData);
  req.end();
});

socket.on('notification', (n) => {
  console.log('received notification:', n);
});

socket.on('connect_error', (err) => {
  console.error('connect_error', err && err.message ? err.message : err);
});

setTimeout(() => { console.log('exiting'); process.exit(0); }, 10000);