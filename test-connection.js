import WebSocket from 'ws';

// Kết nối đến WebSocket server trên localhost
const ws = new WebSocket('ws://localhost:8082');

// Xử lý sự kiện khi kết nối thành công
ws.on('open', () => {
  console.log('Kết nối thành công!');
  
  const testData = {
    type: 'subscribe',
    streamType: 'kline',
    symbols: ['BTCUSDT', 'ETHUSDT'],
    options: {
      interval: '15m'
    }
  };
  ws.send(JSON.stringify(testData));
  // Đóng kết nối sau 1 giây
  // setTimeout(() => {
  //   ws.close();
  //   process.exit(0);
  // }, 1000);
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

setTimeout(() => {
  const testData = {
    type: 'unsubscribe',
    streamType: 'kline',
    symbols: ['BTCUSDT'],
    options: {
      interval: '15m'
    }
  };
  ws.send(JSON.stringify(testData));
}, 5000);

// Timeout sau 5 giây nếu không có phản hồi
setTimeout(() => {
  console.error('Timeout: Không nhận được phản hồi sau 5 giây');
  process.exit(1);
}, 10000); 