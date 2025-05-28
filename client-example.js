/**
 * Client kết nối đến Future Socket NATS Server - File ví dụ
 * Sử dụng WebSocket để kết nối và đăng ký dữ liệu thị trường Binance
 */

const WebSocket = require('ws');
const readline = require('readline');

// Cấu hình kết nối
const config = {
  serverUrl: 'ws://localhost:8080', // Thay đổi thành địa chỉ server thực tế
  reconnectInterval: 5000, // Thời gian thử kết nối lại (ms)
  pingInterval: 30000, // Thời gian gửi ping (ms)
};

let ws;
let clientId = null;
let reconnectAttempts = 0;
let pingInterval;
let isConnected = false;
let currentMarket = 'spot'; // 'spot' hoặc 'futures'

// Danh sách theo dõi đã đăng ký
const subscriptions = {
  symbols: [],
  rawStreams: [],
};

// Tạo giao diện dòng lệnh
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Thiết lập kết nối WebSocket
 */
function connect() {
  if (ws) {
    ws.terminate();
  }

  console.log(`Đang kết nối đến ${config.serverUrl}...`);
  ws = new WebSocket(config.serverUrl);

  // Xử lý sự kiện mở kết nối
  ws.on('open', () => {
    console.log('Kết nối thành công!');
    isConnected = true;
    reconnectAttempts = 0;

    // Bắt đầu gửi ping để duy trì kết nối
    startPing();

    // Hiển thị menu chính
    showMainMenu();
  });

  // Xử lý dữ liệu nhận được
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(message);
    } catch (error) {
      console.error('Lỗi khi xử lý dữ liệu:', error);
    }
  });

  // Xử lý lỗi
  ws.on('error', (error) => {
    console.error('Lỗi kết nối:', error.message);
  });

  // Xử lý đóng kết nối
  ws.on('close', (code, reason) => {
    isConnected = false;
    clearInterval(pingInterval);
    
    console.log(`Kết nối đã đóng: ${code} - ${reason || 'Không có lý do'}`);
    
    // Thử kết nối lại
    reconnectAttempts++;
    console.log(`Thử kết nối lại lần ${reconnectAttempts} sau ${config.reconnectInterval / 1000}s...`);
    setTimeout(connect, config.reconnectInterval);
  });
}

/**
 * Bắt đầu gửi ping định kỳ
 */
function startPing() {
  clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, config.pingInterval);
}

/**
 * Xử lý tin nhắn nhận được từ server
 */
function handleMessage(message) {
  // Xử lý tin nhắn kết nối
  if (message.type === 'connection') {
    clientId = message.clientId;
    console.log(`Đã kết nối với ID: ${clientId}`);
    return;
  }

  // Xử lý tin nhắn đăng ký thành công
  if (message.type === 'subscribed') {
    if (message.streamType) {
      console.log(`Đăng ký thành công ${message.streamType} cho ${message.symbols ? message.symbols.join(', ') : 'các biểu tượng'}`);
    } else if (message.rawStreams) {
      console.log(`Đăng ký thành công các raw stream: ${message.rawStreams.join(', ')}`);
      subscriptions.rawStreams = [...subscriptions.rawStreams, ...message.rawStreams];
    }
    return;
  }

  // Xử lý tin nhắn hủy đăng ký thành công
  if (message.type === 'unsubscribed') {
    if (message.streamType) {
      console.log(`Hủy đăng ký thành công ${message.streamType} cho ${message.symbols ? message.symbols.join(', ') : 'các biểu tượng'}`);
    } else if (message.rawStreams) {
      console.log(`Hủy đăng ký thành công các raw stream: ${message.rawStreams.join(', ')}`);
      subscriptions.rawStreams = subscriptions.rawStreams.filter(stream => !message.rawStreams.includes(stream));
    }
    return;
  }

  // Xử lý dữ liệu lịch sử
  if (message.type === 'historicalKlines') {
    console.log(`Nhận ${message.klines.length} nến lịch sử cho ${message.symbol}:`);
    console.log(message.klines.slice(0, 3)); // Hiển thị 3 nến đầu tiên
    console.log('...');
    if (message.klines.length > 3) {
      console.log(message.klines.slice(-3)); // Hiển thị 3 nến cuối cùng
    }
    return;
  }

  // Xử lý dữ liệu raw stream
  if (message.stream) {
    const streamParts = message.stream.split('@');
    const symbol = streamParts[0].toUpperCase();
    const streamType = streamParts[1];
    
    if (streamType.includes('kline')) {
      const kline = message.data.k;
      console.log(`[${streamType}] ${symbol}: O: ${kline.o}, H: ${kline.h}, L: ${kline.l}, C: ${kline.c}, V: ${kline.v}`);
    } else if (streamType.includes('ticker')) {
      console.log(`[${streamType}] ${symbol}: Giá: ${message.data.c}, Thay đổi 24h: ${message.data.p} (${message.data.P}%)`);
    } else {
      console.log(`[${streamType}] ${symbol}: Dữ liệu mới`);
    }
    return;
  }

  // Xử lý dữ liệu thị trường
  switch (message.type) {
    case 'kline':
      const kline = message.data.k;
      console.log(`[Kline] ${message.data.s}: O: ${kline.o}, H: ${kline.h}, L: ${kline.l}, C: ${kline.c}, V: ${kline.v}`);
      break;
    
    case 'ticker':
      console.log(`[Ticker] ${message.data.s}: Giá: ${message.data.c}, Thay đổi 24h: ${message.data.p} (${message.data.P}%)`);
      break;
    
    case 'depth':
      console.log(`[Depth] ${message.data.s}: ${message.data.b.length} giá mua, ${message.data.a.length} giá bán`);
      break;
    
    case 'markPrice':
      console.log(`[Mark Price] ${message.data.s}: ${message.data.p}, Giá thanh toán: ${message.data.r}`);
      break;
    
    case 'liquidation':
      console.log(`[Liquidation] ${message.data.s}: ${message.data.q} @ ${message.data.p}`);
      break;
    
    case 'error':
      console.error(`Lỗi: ${message.message}`);
      break;
    
    default:
      // Hiển thị tất cả các tin nhắn khác
      // console.log('Dữ liệu khác:', message);
      break;
  }
}

/**
 * Hiển thị menu chính
 */
function showMainMenu() {
  console.log('\n===== FUTURE SOCKET NATS CLIENT =====');
  console.log('1. Chọn thị trường (Spot/Futures)');
  console.log('2. Đăng ký kline (nến)');
  console.log('3. Đăng ký depth (độ sâu thị trường)');
  console.log('4. Đăng ký ticker (giá hiện tại)');
  console.log('5. Đăng ký raw stream (định dạng Binance)');
  console.log('6. Hủy đăng ký');
  console.log('7. Lấy dữ liệu lịch sử');
  console.log('8. Xem đăng ký hiện tại');
  console.log('9. Đăng ký tất cả các biểu tượng');
  console.log('0. Thoát');
  console.log('====================================');
  
  rl.question('Nhập lựa chọn của bạn: ', (choice) => {
    switch (choice) {
      case '1':
        selectMarket();
        break;
      case '2':
        subscribeKline();
        break;
      case '3':
        subscribeDepth();
        break;
      case '4':
        subscribeTicker();
        break;
      case '5':
        subscribeRawStream();
        break;
      case '6':
        unsubscribeMenu();
        break;
      case '7':
        getHistoricalData();
        break;
      case '8':
        showCurrentSubscriptions();
        break;
      case '9':
        subscribeAllSymbols();
        break;
      case '0':
        console.log('Đang thoát...');
        rl.close();
        process.exit(0);
        break;
      default:
        console.log('Lựa chọn không hợp lệ!');
        showMainMenu();
        break;
    }
  });
}

/**
 * Chọn thị trường (Spot/Futures)
 */
function selectMarket() {
  console.log('\n=== CHỌN THỊ TRƯỜNG ===');
  console.log('1. Spot');
  console.log('2. Futures');
  console.log('0. Quay lại');
  
  rl.question('Nhập lựa chọn của bạn: ', (choice) => {
    switch (choice) {
      case '1':
        currentMarket = 'spot';
        console.log('Đã chọn thị trường Spot');
        showMainMenu();
        break;
      case '2':
        currentMarket = 'futures';
        console.log('Đã chọn thị trường Futures');
        showMainMenu();
        break;
      case '0':
        showMainMenu();
        break;
      default:
        console.log('Lựa chọn không hợp lệ!');
        selectMarket();
        break;
    }
  });
}

/**
 * Đăng ký kline (nến)
 */
function subscribeKline() {
  rl.question('Nhập biểu tượng (vd: btcusdt hoặc btcusdt,ethusdt): ', (symbols) => {
    if (!symbols) {
      console.log('Vui lòng nhập ít nhất một biểu tượng!');
      showMainMenu();
      return;
    }
    
    const symbolArray = symbols.toLowerCase().split(',').map(s => s.trim());
    
    rl.question('Nhập khoảng thời gian (1m, 5m, 15m, 1h, 4h, 1d): ', (interval) => {
      if (!interval) {
        interval = '1m'; // Mặc định 1 phút
      }
      
      const subscription = {
        type: 'subscribe',
        streamType: 'kline',
        symbols: symbolArray,
        options: {
          interval: interval.trim()
        }
      };
      
      // Gửi yêu cầu đăng ký
      ws.send(JSON.stringify(subscription));
      
      // Cập nhật danh sách đăng ký
      subscriptions.symbols = [...new Set([...subscriptions.symbols, ...symbolArray])];
      
      console.log(`Đang đăng ký kline ${interval} cho ${symbolArray.join(', ')}...`);
      showMainMenu();
    });
  });
}

/**
 * Đăng ký depth (độ sâu thị trường)
 */
function subscribeDepth() {
  rl.question('Nhập biểu tượng (vd: btcusdt hoặc btcusdt,ethusdt): ', (symbols) => {
    if (!symbols) {
      console.log('Vui lòng nhập ít nhất một biểu tượng!');
      showMainMenu();
      return;
    }
    
    const symbolArray = symbols.toLowerCase().split(',').map(s => s.trim());
    
    rl.question('Nhập độ sâu (5, 10, 20): ', (level) => {
      if (!level || !['5', '10', '20'].includes(level.trim())) {
        level = '20'; // Mặc định độ sâu 20
      }
      
      const subscription = {
        type: 'subscribe',
        streamType: 'depth',
        symbols: symbolArray,
        options: {
          level: level.trim()
        }
      };
      
      // Gửi yêu cầu đăng ký
      ws.send(JSON.stringify(subscription));
      
      // Cập nhật danh sách đăng ký
      subscriptions.symbols = [...new Set([...subscriptions.symbols, ...symbolArray])];
      
      console.log(`Đang đăng ký depth ${level} cho ${symbolArray.join(', ')}...`);
      showMainMenu();
    });
  });
}

/**
 * Đăng ký ticker (giá hiện tại)
 */
function subscribeTicker() {
  rl.question('Nhập biểu tượng (vd: btcusdt hoặc btcusdt,ethusdt): ', (symbols) => {
    if (!symbols) {
      console.log('Vui lòng nhập ít nhất một biểu tượng!');
      showMainMenu();
      return;
    }
    
    const symbolArray = symbols.toLowerCase().split(',').map(s => s.trim());
    
    const subscription = {
      type: 'subscribe',
      streamType: 'ticker',
      symbols: symbolArray
    };
    
    // Gửi yêu cầu đăng ký
    ws.send(JSON.stringify(subscription));
    
    // Cập nhật danh sách đăng ký
    subscriptions.symbols = [...new Set([...subscriptions.symbols, ...symbolArray])];
    
    console.log(`Đang đăng ký ticker cho ${symbolArray.join(', ')}...`);
    showMainMenu();
  });
}

/**
 * Đăng ký raw stream (định dạng Binance)
 */
function subscribeRawStream() {
  console.log('\nVí dụ các định dạng raw stream:');
  console.log('- btcusdt@kline_1m (Nến 1 phút BTC/USDT)');
  console.log('- ethusdt@depth20 (Độ sâu 20 ETH/USDT)');
  console.log('- bnbusdt@ticker (Ticker BNB/USDT)');
  console.log('- btcusdt@markPrice@1s (Giá đánh dấu BTC/USDT - chỉ Futures)');
  console.log('- ethusdt@markPrice@1s (Giá đánh dấu ETH/USDT - chỉ Futures)');
  
  rl.question('Nhập các raw stream (phân cách bằng dấu phẩy): ', (streams) => {
    if (!streams) {
      console.log('Vui lòng nhập ít nhất một stream!');
      showMainMenu();
      return;
    }
    
    const streamArray = streams.toLowerCase().split(',').map(s => s.trim());
    
    const subscription = {
      type: 'subscribe',
      rawStreams: streamArray
    };
    
    // Gửi yêu cầu đăng ký
    ws.send(JSON.stringify(subscription));
    
    console.log(`Đang đăng ký raw streams: ${streamArray.join(', ')}...`);
    showMainMenu();
  });
}

/**
 * Menu hủy đăng ký
 */
function unsubscribeMenu() {
  console.log('\n=== HỦY ĐĂNG KÝ ===');
  console.log('1. Hủy đăng ký theo loại stream');
  console.log('2. Hủy đăng ký raw stream');
  console.log('3. Hủy tất cả đăng ký');
  console.log('0. Quay lại');
  
  rl.question('Nhập lựa chọn của bạn: ', (choice) => {
    switch (choice) {
      case '1':
        unsubscribeByType();
        break;
      case '2':
        unsubscribeRawStream();
        break;
      case '3':
        unsubscribeAll();
        break;
      case '0':
        showMainMenu();
        break;
      default:
        console.log('Lựa chọn không hợp lệ!');
        unsubscribeMenu();
        break;
    }
  });
}

/**
 * Hủy đăng ký theo loại stream
 */
function unsubscribeByType() {
  console.log('\n=== CHỌN LOẠI STREAM ===');
  console.log('1. Kline (nến)');
  console.log('2. Depth (độ sâu thị trường)');
  console.log('3. Ticker (giá hiện tại)');
  console.log('0. Quay lại');
  
  rl.question('Nhập lựa chọn của bạn: ', (choice) => {
    let streamType;
    
    switch (choice) {
      case '1':
        streamType = 'kline';
        break;
      case '2':
        streamType = 'depth';
        break;
      case '3':
        streamType = 'ticker';
        break;
      case '0':
        unsubscribeMenu();
        return;
      default:
        console.log('Lựa chọn không hợp lệ!');
        unsubscribeByType();
        return;
    }
    
    rl.question('Nhập biểu tượng (vd: btcusdt hoặc btcusdt,ethusdt): ', (symbols) => {
      if (!symbols) {
        console.log('Vui lòng nhập ít nhất một biểu tượng!');
        unsubscribeMenu();
        return;
      }
      
      const symbolArray = symbols.toLowerCase().split(',').map(s => s.trim());
      
      const unsubscription = {
        type: 'unsubscribe',
        streamType: streamType,
        symbols: symbolArray
      };
      
      // Gửi yêu cầu hủy đăng ký
      ws.send(JSON.stringify(unsubscription));
      
      console.log(`Đang hủy đăng ký ${streamType} cho ${symbolArray.join(', ')}...`);
      showMainMenu();
    });
  });
}

/**
 * Hủy đăng ký raw stream
 */
function unsubscribeRawStream() {
  // Hiển thị danh sách raw stream đã đăng ký
  if (subscriptions.rawStreams.length === 0) {
    console.log('Không có raw stream nào đã đăng ký!');
    unsubscribeMenu();
    return;
  }
  
  console.log('\nCác raw stream đã đăng ký:');
  subscriptions.rawStreams.forEach((stream, index) => {
    console.log(`${index + 1}. ${stream}`);
  });
  
  rl.question('Nhập các raw stream cần hủy (phân cách bằng dấu phẩy): ', (streams) => {
    if (!streams) {
      console.log('Vui lòng nhập ít nhất một stream!');
      unsubscribeMenu();
      return;
    }
    
    const streamArray = streams.toLowerCase().split(',').map(s => s.trim());
    
    const unsubscription = {
      type: 'unsubscribe',
      rawStreams: streamArray
    };
    
    // Gửi yêu cầu hủy đăng ký
    ws.send(JSON.stringify(unsubscription));
    
    console.log(`Đang hủy đăng ký raw streams: ${streamArray.join(', ')}...`);
    showMainMenu();
  });
}

/**
 * Hủy tất cả đăng ký
 */
function unsubscribeAll() {
  // Hủy đăng ký tất cả các stream
  if (subscriptions.symbols.length > 0) {
    const unsubscription = {
      type: 'unsubscribe',
      streamType: 'all',
      symbols: ['ALL']
    };
    
    // Gửi yêu cầu hủy đăng ký
    ws.send(JSON.stringify(unsubscription));
  }
  
  // Hủy đăng ký tất cả raw stream
  if (subscriptions.rawStreams.length > 0) {
    const unsubscription = {
      type: 'unsubscribe',
      rawStreams: subscriptions.rawStreams
    };
    
    // Gửi yêu cầu hủy đăng ký
    ws.send(JSON.stringify(unsubscription));
  }
  
  // Xóa danh sách đăng ký
  subscriptions.symbols = [];
  subscriptions.rawStreams = [];
  
  console.log('Đang hủy tất cả đăng ký...');
  showMainMenu();
}

/**
 * Lấy dữ liệu lịch sử
 */
function getHistoricalData() {
  rl.question('Nhập biểu tượng (vd: btcusdt): ', (symbol) => {
    if (!symbol) {
      console.log('Vui lòng nhập một biểu tượng!');
      showMainMenu();
      return;
    }
    
    symbol = symbol.toLowerCase().trim();
    
    rl.question('Nhập khoảng thời gian (1m, 5m, 15m, 1h, 4h, 1d): ', (interval) => {
      if (!interval) {
        interval = '1m'; // Mặc định 1 phút
      }
      
      interval = interval.trim();
      
      rl.question('Nhập số lượng nến (tối đa 1000): ', (limit) => {
        let limitValue = parseInt(limit);
        
        if (isNaN(limitValue) || limitValue <= 0) {
          limitValue = 500; // Mặc định 500 nến
        } else if (limitValue > 1000) {
          limitValue = 1000; // Giới hạn tối đa 1000 nến
        }
        
        const request = {
          type: 'getHistoricalKlines',
          symbol: symbol,
          interval: interval,
          limit: limitValue,
          isFutures: currentMarket === 'futures'
        };
        
        // Gửi yêu cầu lấy dữ liệu lịch sử
        ws.send(JSON.stringify(request));
        
        console.log(`Đang lấy ${limitValue} nến ${interval} cho ${symbol}...`);
        showMainMenu();
      });
    });
  });
}

/**
 * Hiển thị danh sách đăng ký hiện tại
 */
function showCurrentSubscriptions() {
  console.log('\n=== DANH SÁCH ĐĂNG KÝ HIỆN TẠI ===');
  
  if (subscriptions.symbols.length > 0) {
    console.log('Biểu tượng đã đăng ký:');
    console.log(subscriptions.symbols.join(', '));
  } else {
    console.log('Không có biểu tượng nào đã đăng ký.');
  }
  
  if (subscriptions.rawStreams.length > 0) {
    console.log('\nRaw streams đã đăng ký:');
    console.log(subscriptions.rawStreams.join(', '));
  } else {
    console.log('Không có raw stream nào đã đăng ký.');
  }
  
  console.log(`\nThị trường hiện tại: ${currentMarket === 'futures' ? 'Futures' : 'Spot'}`);
  
  rl.question('\nNhấn Enter để quay lại...', () => {
    showMainMenu();
  });
}

/**
 * Đăng ký tất cả các biểu tượng
 */
function subscribeAllSymbols() {
  console.log('\n=== ĐĂNG KÝ TẤT CẢ CÁC BIỂU TƯỢNG ===');
  console.log('1. Kline (nến)');
  console.log('2. Ticker (giá hiện tại)');
  console.log('0. Quay lại');
  
  rl.question('Nhập lựa chọn của bạn: ', (choice) => {
    let streamType;
    
    switch (choice) {
      case '1':
        streamType = 'kline';
        rl.question('Nhập khoảng thời gian (1m, 5m, 15m, 1h, 4h, 1d): ', (interval) => {
          if (!interval) {
            interval = '1m'; // Mặc định 1 phút
          }
          
          interval = interval.trim();
          
          const subscription = {
            type: 'subscribe',
            streamType: streamType,
            symbols: ['ALL'],
            options: {
              interval: interval
            }
          };
          
          // Gửi yêu cầu đăng ký
          ws.send(JSON.stringify(subscription));
          
          console.log(`Đang đăng ký ${streamType} ${interval} cho TẤT CẢ các biểu tượng...`);
          console.log('Lưu ý: Đây là một lượng dữ liệu lớn, có thể ảnh hưởng đến hiệu suất!');
          showMainMenu();
        });
        break;
      
      case '2':
        streamType = 'ticker';
        
        const subscription = {
          type: 'subscribe',
          streamType: streamType,
          symbols: ['ALL']
        };
        
        // Gửi yêu cầu đăng ký
        ws.send(JSON.stringify(subscription));
        
        console.log(`Đang đăng ký ${streamType} cho TẤT CẢ các biểu tượng...`);
        console.log('Lưu ý: Đây là một lượng dữ liệu lớn, có thể ảnh hưởng đến hiệu suất!');
        showMainMenu();
        break;
      
      case '0':
        showMainMenu();
        break;
      
      default:
        console.log('Lựa chọn không hợp lệ!');
        subscribeAllSymbols();
        break;
    }
  });
}

// Bắt đầu kết nối
connect();

// Xử lý đóng ứng dụng
rl.on('close', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  process.exit(0);
}); 