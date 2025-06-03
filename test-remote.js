const WebSocket = require('ws');

// URL của WebSocket server từ xa
const url = 'ws://15.235.216.97:8082';
console.log(`Đang kết nối đến ${url}...`);

// Tạo WebSocket với IPv4
const ws = new WebSocket(url, {
  family: 4
});

// Hiển thị thời gian bắt đầu kết nối
const startTime = new Date();
console.log(`Bắt đầu kết nối lúc: ${startTime.toISOString()}`);

// Xử lý sự kiện khi kết nối thành công
ws.on('open', () => {
  const connectedTime = new Date();
  const timeTaken = (connectedTime - startTime) / 1000;
  console.log(`Kết nối thành công sau ${timeTaken} giây!`);
  
  // Gửi tin nhắn đơn giản
  try {
    ws.send(JSON.stringify({ type: 'subscribe', symbols: ['btcusdt'], streamType: 'ticker' }));
    console.log('Đã gửi yêu cầu subscribe');
  } catch (error) {
    console.error('Lỗi khi gửi tin nhắn:', error.message);
  }
});

// Xử lý sự kiện khi có lỗi
ws.on('error', (error) => {
  console.error('Lỗi WebSocket:', error);
  console.error('Chi tiết lỗi:', {
    message: error.message,
    code: error.code
  });
  process.exit(1);
});

// Xử lý sự kiện khi nhận được message
ws.on('message', (data) => {
  console.log('Nhận được dữ liệu:', data.toString().substring(0, 100) + '...');
});

// Xử lý sự kiện khi kết nối đóng
ws.on('close', (code, reason) => {
  console.log(`Kết nối đã đóng với mã ${code} và lý do: ${reason || 'Không có lý do'}`);
});

// Bấm Ctrl+C để thoát
console.log('Bấm Ctrl+C để thoát...');

// Xử lý khi ứng dụng thoát
process.on('SIGINT', () => {
  console.log('Đóng kết nối WebSocket...');
  ws.close();
  process.exit(0);
}); 