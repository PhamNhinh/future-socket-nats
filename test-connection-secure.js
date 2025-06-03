const WebSocket = require('ws');

// Kết nối đến WebSocket secure server
const ws = new WebSocket('wss://bnb-socket.docserver.name/future', {
  rejectUnauthorized: false, // Bỏ qua kiểm tra chứng chỉ SSL trong môi trường test
  family: 4 // Bắt buộc sử dụng IPv4
});

// Xử lý sự kiện khi kết nối thành công
ws.on('open', () => {
  console.log('Kết nối thành công!');
  
  // Đóng kết nối sau 1 giây
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 1000);
});

// Xử lý sự kiện khi có lỗi
ws.on('error', (e) => {
  console.error('Lỗi kết nối:', e.message);
  process.exit(1);
});

// Xử lý sự kiện khi nhận được message
ws.on('message', (data) => {
  console.log('Nhận được dữ liệu:', data.toString());
});

// Timeout sau 5 giây nếu không có phản hồi
setTimeout(() => {
  console.error('Timeout: Không nhận được phản hồi sau 5 giây');
  process.exit(1);
}, 5000); 