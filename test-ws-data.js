const WebSocket = require('ws');
const ws = new WebSocket('wss://bnb-socket.docserver.name');

ws.on('open', () => {
  console.log('Kết nối thành công!');
  
  // Gửi dữ liệu thử nghiệm
  const testData = {
    type: 'subscribe',
    streamType: 'kline',
    symbols: ['btcusdt'],
    interval: '1m'
  };
  
  console.log('Gửi dữ liệu:', JSON.stringify(testData));
  ws.send(JSON.stringify(testData));
});

ws.on('message', (data) => {
  console.log('Nhận được dữ liệu:');
  try {
    const parsed = JSON.parse(data);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log('Dữ liệu thô:', data.toString());
  }
});

ws.on('error', (e) => {
  console.error('Lỗi:', e.message);
});

// Tự động đóng kết nối sau 30 giây
setTimeout(() => {
  console.log('Đóng kết nối sau 30 giây...');
  ws.close();
  process.exit(0);
}, 30000); 