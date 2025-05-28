const WebSocket = require('ws');
const ws = new WebSocket('wss://bnb-socket.docserver.name');

ws.on('open', () => {
  console.log('Kết nối thành công!');
  setTimeout(() => process.exit(0), 1000);
});

ws.on('error', (e) => {
  console.error('Lỗi:', e.message);
  process.exit(1);
});

// Timeout sau 5 giây nếu không có phản hồi
setTimeout(() => {
  console.error('Timeout: Không nhận được phản hồi sau 5 giây');
  process.exit(1);
}, 5000); 