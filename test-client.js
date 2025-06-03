const WebSocket = require('ws');

// Thay đổi URL này khi test trên client thực tế
const url = 'ws://15.235.216.97:8082'; // Địa chỉ IPv4 công khai của server
console.log(`Đang kết nối đến ${url}...`);

// Tạo WebSocket với IPv4
const ws = new WebSocket(url, {
  family: 4
});

// Xử lý sự kiện khi kết nối thành công
ws.on('open', () => {
  console.log('Kết nối thành công!');
  
  // Gửi yêu cầu subscribe
  try {
    ws.send(JSON.stringify({ 
      type: 'subscribe', 
      symbols: ['btcusdt'], 
      streamType: 'ticker'
    }));
    console.log('Đã gửi yêu cầu subscribe');
  } catch (error) {
    console.error('Lỗi khi gửi tin nhắn:', error.message);
  }
});

// Xử lý sự kiện khi có lỗi
ws.on('error', (error) => {
  console.error('Lỗi WebSocket:', error.message);
  process.exit(1);
});

// Xử lý sự kiện khi nhận được message
ws.on('message', (data) => {
  // Hiển thị 100 ký tự đầu tiên của dữ liệu
  const dataString = data.toString();
  console.log('Nhận được dữ liệu:', dataString.length > 100 ? dataString.substring(0, 100) + '...' : dataString);
});

// Xử lý sự kiện khi kết nối đóng
ws.on('close', (code, reason) => {
  console.log(`Kết nối đã đóng với mã ${code} và lý do: ${reason || 'Không có lý do'}`);
});

// Hướng dẫn sử dụng
console.log('Bấm Ctrl+C để thoát...');

// Xử lý khi ứng dụng thoát
process.on('SIGINT', () => {
  console.log('Đóng kết nối WebSocket...');
  ws.close();
  process.exit(0);
}); 