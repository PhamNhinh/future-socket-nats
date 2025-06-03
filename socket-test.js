const WebSocket = require('ws');

// URL của WebSocket server
const url = 'wss://bnb-socket.docserver.name/future';
console.log(`Đang kết nối đến ${url}...`);

// Tạo WebSocket với nhiều tùy chọn
const ws = new WebSocket(url, {
  family: 4, // Sử dụng IPv4
  handshakeTimeout: 15000, // Tăng timeout cho quá trình bắt tay lên 15 giây
  perMessageDeflate: false // Tắt nén để loại trừ vấn đề nén
});

// Hiển thị thời gian bắt đầu kết nối
const startTime = new Date();
console.log(`Bắt đầu kết nối lúc: ${startTime.toISOString()}`);

// Xử lý sự kiện kết nối đang mở
ws.on('connecting', () => {
  console.log('Đang trong quá trình kết nối...');
});

// Xử lý sự kiện khi kết nối thành công
ws.on('open', () => {
  const connectedTime = new Date();
  const timeTaken = (connectedTime - startTime) / 1000;
  console.log(`Kết nối thành công sau ${timeTaken} giây!`);
  console.log(`WebSocket đã mở lúc: ${connectedTime.toISOString()}`);
  console.log(`Trạng thái: ${ws.readyState}`); // 0: Connecting, 1: Open, 2: Closing, 3: Closed
  
  // Gửi tin nhắn đơn giản
  try {
    ws.send(JSON.stringify({ type: 'ping' }));
    console.log('Đã gửi tin nhắn ping');
  } catch (error) {
    console.error('Lỗi khi gửi tin nhắn:', error.message);
  }
});

// Xử lý sự kiện khi có lỗi
ws.on('error', (error) => {
  console.error('Lỗi WebSocket:', error);
  console.error('Chi tiết lỗi:', {
    message: error.message,
    code: error.code,
    type: error.type,
    errno: error.errno,
    syscall: error.syscall,
    address: error.address,
    port: error.port
  });
  
  // Hiển thị thông tin về DNS
  const dns = require('dns');
  dns.lookup('bnb-socket.docserver.name', (err, address, family) => {
    if (err) {
      console.error('Lỗi DNS lookup:', err);
    } else {
      console.log(`DNS resolve: ${address} (IPv${family})`);
    }
    process.exit(1);
  });
});

// Xử lý sự kiện khi nhận được message
ws.on('message', (data) => {
  console.log('Nhận được dữ liệu:', data.toString());
  
  // Đóng kết nối sau khi nhận được tin nhắn
  setTimeout(() => {
    ws.close();
    console.log('Đã đóng kết nối sau khi nhận tin nhắn');
    process.exit(0);
  }, 1000);
});

// Xử lý sự kiện khi kết nối đóng
ws.on('close', (code, reason) => {
  console.log(`Kết nối đã đóng với mã ${code} và lý do: ${reason || 'Không có lý do'}`);
});

// Timeout dài hơn (15 giây) 
setTimeout(() => {
  console.error('Timeout: Không nhận được phản hồi sau 15 giây');
  console.log('Trạng thái WebSocket:', ws.readyState); // 0: Connecting, 1: Open, 2: Closing, 3: Closed
  
  if (ws.readyState === WebSocket.CONNECTING) {
    console.log('WebSocket vẫn đang trong trạng thái kết nối sau 15 giây');
  }
  
  ws.terminate(); // Ngắt kết nối mạnh
  process.exit(1);
}, 15000); 