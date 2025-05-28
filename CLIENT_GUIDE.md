# Hướng dẫn kết nối Client đến Future Socket NATS Server

Tài liệu này cung cấp hướng dẫn chi tiết về cách kết nối và sử dụng Future Socket NATS Server để nhận dữ liệu thị trường từ Binance.

## Mục lục

1. [Tổng quan](#tổng-quan)
2. [Thông tin kết nối](#thông-tin-kết-nối)
3. [Giao thức WebSocket](#giao-thức-websocket)
4. [Đăng ký và hủy đăng ký dữ liệu](#đăng-ký-và-hủy-đăng-ký-dữ-liệu)
5. [Định dạng dữ liệu](#định-dạng-dữ-liệu)
6. [Lấy dữ liệu lịch sử](#lấy-dữ-liệu-lịch-sử)
7. [Mã nguồn ví dụ](#mã-nguồn-ví-dụ)
8. [Xử lý lỗi và khắc phục sự cố](#xử-lý-lỗi-và-khắc-phục-sự-cố)

## Tổng quan

Future Socket NATS Server là một dịch vụ proxy WebSocket giúp tối ưu hóa kết nối đến Binance WebSocket API. Hệ thống này cho phép client:

- Đăng ký nhận dữ liệu theo thời gian thực từ thị trường Spot và Futures của Binance
- Đăng ký theo biểu tượng cụ thể hoặc tất cả các biểu tượng
- Sử dụng các định dạng đăng ký tương thích với Binance API
- Lấy dữ liệu lịch sử (historical kline data)

Hệ thống được thiết kế để xử lý số lượng lớn kết nối đồng thời và đảm bảo độ ổn định cao.

## Thông tin kết nối

- **WebSocket URL**: `ws://server-address:8081`
- **Cổng mặc định**: 8080
- **Giao thức**: WebSocket (ws:// hoặc wss:// nếu hỗ trợ SSL)

## Giao thức WebSocket

### Thiết lập kết nối

Để kết nối đến server, hãy sử dụng thư viện WebSocket của ngôn ngữ lập trình bạn đang sử dụng. Ví dụ với JavaScript:

```javascript
const ws = new WebSocket('ws://server-address:8081');

ws.onopen = () => {
  console.log('Kết nối thành công');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Nhận dữ liệu:', data);
};

ws.onerror = (error) => {
  console.error('Lỗi kết nối:', error);
};

ws.onclose = () => {
  console.log('Kết nối đã đóng');
};
```

### Tin nhắn chào mừng

Khi kết nối thành công, server sẽ gửi tin nhắn chào mừng:

```json
{
  "type": "connection",
  "clientId": "client_1620000000000_abc123",
  "message": "Connected to Future Socket NATS server"
}
```

Lưu lại `clientId` để debug sau này nếu cần.

## Đăng ký và hủy đăng ký dữ liệu

### Các loại stream hỗ trợ

- **Spot Market**: `kline`, `depth`, `ticker`
- **Futures Market**: `kline`, `depth`, `ticker`, `markPrice`, `liquidation`

### Phương thức 1: Đăng ký theo loại stream và biểu tượng

#### Đăng ký dữ liệu

```json
{
  "type": "subscribe",
  "streamType": "kline",
  "symbols": ["btcusdt", "ethusdt"],
  "options": {
    "interval": "1m"
  }
}
```

Các tùy chọn (options) tùy thuộc vào loại stream:
- **kline**: `interval` (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M)
- **depth**: `level` (5, 10, 20)
- **markPrice**: `updateSpeed` (1s, 3s)

#### Đăng ký tất cả biểu tượng

```json
{
  "type": "subscribe",
  "streamType": "kline",
  "symbols": ["ALL"],
  "options": {
    "interval": "1m"
  }
}
```

#### Hủy đăng ký

```json
{
  "type": "unsubscribe",
  "streamType": "kline",
  "symbols": ["btcusdt", "ethusdt"]
}
```

### Phương thức 2: Đăng ký theo định dạng Binance

#### Đăng ký dữ liệu raw stream

```json
{
  "type": "subscribe",
  "rawStreams": [
    "btcusdt@kline_1m",
    "ethusdt@depth20",
    "bnbusdt@ticker"
  ]
}
```

#### Hủy đăng ký raw stream

```json
{
  "type": "unsubscribe",
  "rawStreams": [
    "btcusdt@kline_1m",
    "ethusdt@depth20"
  ]
}
```

### Phản hồi đăng ký

Khi đăng ký thành công:

```json
{
  "type": "subscribed",
  "streamType": "kline",
  "symbols": ["btcusdt", "ethusdt"]
}
```

Hoặc với raw streams:

```json
{
  "type": "subscribed",
  "rawStreams": ["btcusdt@kline_1m", "ethusdt@depth20"]
}
```

## Định dạng dữ liệu

### Kline (Biểu đồ nến)

```json
{
  "type": "kline",
  "data": {
    "e": "kline",
    "E": 1589437156346,
    "s": "BTCUSDT",
    "k": {
      "t": 1589437140000,
      "T": 1589437199999,
      "s": "BTCUSDT",
      "i": "1m",
      "f": 202753789,
      "L": 202754116,
      "o": "9327.00000000",
      "c": "9327.05000000",
      "h": "9327.05000000",
      "l": "9326.96000000",
      "v": "9.52393800",
      "n": 328,
      "x": false,
      "q": "88819.85657275",
      "V": "5.06840800",
      "Q": "47277.40733798",
      "B": "0"
    }
  }
}
```

### Depth (Độ sâu thị trường)

```json
{
  "type": "depth",
  "data": {
    "e": "depthUpdate",
    "E": 1589437156346,
    "s": "BTCUSDT",
    "U": 1234567,
    "u": 1234568,
    "b": [
      ["9326.96000000", "0.15200000"],
      ["9326.80000000", "0.55900000"]
    ],
    "a": [
      ["9327.00000000", "0.05000000"],
      ["9327.05000000", "2.47400000"]
    ]
  }
}
```

### Ticker (Giá hiện tại)

```json
{
  "type": "ticker",
  "data": {
    "e": "24hrTicker",
    "E": 1589437156346,
    "s": "BTCUSDT",
    "p": "259.50000000",
    "P": "2.84",
    "w": "9341.80415785",
    "c": "9327.05000000",
    "Q": "0.10300000",
    "o": "9067.55000000",
    "h": "9575.00000000",
    "l": "9033.19000000",
    "v": "141837.02586600",
    "q": "1324601591.94850372",
    "O": 1589350756325,
    "C": 1589437156325,
    "F": 201376490,
    "L": 202754152,
    "n": 1377663
  }
}
```

### Raw Stream

```json
{
  "stream": "btcusdt@kline_1m",
  "data": {
    "e": "kline",
    "E": 1589437156346,
    "s": "BTCUSDT",
    "k": {
      "t": 1589437140000,
      "T": 1589437199999,
      "s": "BTCUSDT",
      "i": "1m",
      "f": 202753789,
      "L": 202754116,
      "o": "9327.00000000",
      "c": "9327.05000000",
      "h": "9327.05000000",
      "l": "9326.96000000",
      "v": "9.52393800",
      "n": 328,
      "x": false,
      "q": "88819.85657275",
      "V": "5.06840800",
      "Q": "47277.40733798",
      "B": "0"
    }
  }
}
```

## Lấy dữ liệu lịch sử

### Yêu cầu lấy dữ liệu lịch sử

```json
{
  "type": "getHistoricalKlines",
  "symbol": "btcusdt",
  "interval": "1m",
  "limit": 500,
  "startTime": 1620000000000,
  "endTime": 1620100000000,
  "isFutures": false
}
```

Các tham số:
- `symbol`: Biểu tượng cần lấy dữ liệu
- `interval`: Khoảng thời gian (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M)
- `limit`: Số lượng nến (tối đa 1000)
- `startTime`: Thời gian bắt đầu (milliseconds)
- `endTime`: Thời gian kết thúc (milliseconds)
- `isFutures`: `true` cho thị trường Futures, `false` cho thị trường Spot

### Phản hồi dữ liệu lịch sử

```json
{
  "type": "historicalKlines",
  "symbol": "btcusdt",
  "interval": "1m",
  "klines": [
    [
      1620000000000,  // Thời gian mở nến
      "54321.00000000",  // Giá mở
      "54350.00000000",  // Giá cao nhất
      "54300.00000000",  // Giá thấp nhất
      "54330.00000000",  // Giá đóng
      "15.54400000",  // Khối lượng
      1620059999999,  // Thời gian đóng nến
      "844000.30000000",  // Khối lượng tính bằng tài sản trích dẫn
      60,  // Số lượng giao dịch
      "7.22400000",  // Khối lượng mua tính bằng tài sản cơ bản
      "392000.00000000",  // Khối lượng mua tính bằng tài sản trích dẫn
      "0"  // Bỏ qua
    ],
    // ... các nến khác
  ]
}
```

## Mã nguồn ví dụ

### JavaScript/Node.js

```javascript
const WebSocket = require('ws');

// Kết nối đến server
const ws = new WebSocket('ws://server-address:8080');

// Xử lý sự kiện kết nối
ws.on('open', () => {
  console.log('Kết nối thành công');
  
  // Đăng ký kline cho BTC và ETH với khoảng thời gian 1m
  ws.send(JSON.stringify({
    type: 'subscribe',
    streamType: 'kline',
    symbols: ['btcusdt', 'ethusdt'],
    options: {
      interval: '1m'
    }
  }));
  
  // Hoặc đăng ký theo định dạng raw
  ws.send(JSON.stringify({
    type: 'subscribe',
    rawStreams: ['btcusdt@kline_1m', 'ethusdt@kline_1m']
  }));
});

// Xử lý dữ liệu nhận được
ws.on('message', (data) => {
  const message = JSON.parse(data);
  
  switch (message.type) {
    case 'connection':
      console.log('Client ID:', message.clientId);
      break;
      
    case 'subscribed':
      console.log('Đăng ký thành công:', message);
      break;
      
    case 'kline':
      const kline = message.data.k;
      console.log(`${message.data.s}: Giá mở ${kline.o}, Giá đóng ${kline.c}, Cao ${kline.h}, Thấp ${kline.l}`);
      break;
      
    case 'historicalKlines':
      console.log(`Nhận ${message.klines.length} nến lịch sử cho ${message.symbol}`);
      // Xử lý dữ liệu lịch sử
      break;
      
    default:
      if (message.stream && message.stream.includes('@kline_')) {
        const kline = message.data.k;
        console.log(`[Raw] ${message.data.s}: Giá mở ${kline.o}, Giá đóng ${kline.c}`);
      } else {
        console.log('Nhận dữ liệu:', message);
      }
  }
});

// Xử lý lỗi và đóng kết nối
ws.on('error', (error) => {
  console.error('Lỗi kết nối:', error);
});

ws.on('close', () => {
  console.log('Kết nối đã đóng');
});

// Hàm hủy đăng ký
function unsubscribe() {
  ws.send(JSON.stringify({
    type: 'unsubscribe',
    streamType: 'kline',
    symbols: ['btcusdt', 'ethusdt']
  }));
}

// Hàm lấy dữ liệu lịch sử
function getHistoricalData() {
  ws.send(JSON.stringify({
    type: 'getHistoricalKlines',
    symbol: 'btcusdt',
    interval: '1m',
    limit: 500
  }));
}
```

### Python

```python
import json
import websocket
import threading
import time

def on_message(ws, message):
    data = json.loads(message)
    
    if data.get('type') == 'kline':
        kline = data['data']['k']
        print(f"{data['data']['s']}: Giá mở {kline['o']}, Giá đóng {kline['c']}")
    elif data.get('type') == 'connection':
        print(f"Kết nối thành công, Client ID: {data['clientId']}")
        # Đăng ký sau khi kết nối thành công
        subscribe_kline(ws)
    else:
        print(f"Nhận dữ liệu: {data}")

def on_error(ws, error):
    print(f"Lỗi: {error}")

def on_close(ws, close_status_code, close_msg):
    print("Kết nối đóng")

def on_open(ws):
    print("Kết nối đã mở")

def subscribe_kline(ws):
    subscription = {
        "type": "subscribe",
        "streamType": "kline",
        "symbols": ["btcusdt", "ethusdt"],
        "options": {
            "interval": "1m"
        }
    }
    ws.send(json.dumps(subscription))
    print("Đã gửi yêu cầu đăng ký")

def get_historical_data(ws):
    request = {
        "type": "getHistoricalKlines",
        "symbol": "btcusdt",
        "interval": "1m",
        "limit": 500
    }
    ws.send(json.dumps(request))
    print("Đã gửi yêu cầu lấy dữ liệu lịch sử")

if __name__ == "__main__":
    # Thiết lập WebSocket
    websocket.enableTrace(False)
    ws = websocket.WebSocketApp("ws://server-address:8080",
                              on_open=on_open,
                              on_message=on_message,
                              on_error=on_error,
                              on_close=on_close)

    # Chạy WebSocket trong một thread riêng
    wst = threading.Thread(target=ws.run_forever)
    wst.daemon = True
    wst.start()
    
    # Cho phép kết nối thiết lập
    time.sleep(2)
    
    # Giữ chương trình chạy
    try:
        while True:
            cmd = input("Nhập lệnh (h: lịch sử, q: thoát): ")
            if cmd == 'h':
                get_historical_data(ws)
            elif cmd == 'q':
                break
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    
    # Đóng kết nối
    ws.close()
```

## Xử lý lỗi và khắc phục sự cố

### Mã lỗi phổ biến

- **Lỗi định dạng**: Kiểm tra cú pháp JSON và các trường bắt buộc
- **Biểu tượng không hợp lệ**: Đảm bảo biểu tượng đang được giao dịch trên Binance
- **Loại stream không hỗ trợ**: Đảm bảo sử dụng loại stream được hỗ trợ cho thị trường tương ứng

### Kết nối lại tự động

Triển khai logic kết nối lại tự động khi kết nối bị đóng:

```javascript
function connect() {
  const ws = new WebSocket('ws://server-address:8080');
  
  ws.onclose = () => {
    console.log('Kết nối bị đóng, thử kết nối lại sau 5 giây');
    setTimeout(connect, 5000);
  };
  
  // Thiết lập các xử lý sự kiện khác
}
```

### Kiểm tra kết nối

Gửi định kỳ các gói ping để đảm bảo kết nối vẫn còn hoạt động:

```javascript
// Gửi ping mỗi 30 giây
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);
```

---

Để được hỗ trợ thêm, vui lòng liên hệ với đội ngũ kỹ thuật hoặc tạo issue trên repository. 