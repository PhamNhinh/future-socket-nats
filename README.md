# Future Socket NATS

A real-time cryptocurrency data service that streams market data from Binance to clients using WebSocket, with NATS as the messaging backbone and worker threads for scalable processing.

## Architecture Overview

This system implements a scalable architecture for streaming cryptocurrency market data:

1. **Data Flow**: Binance API → Worker Threads → NATS → Server → WebSocket → Client
2. **Worker Distribution**: Automatically divides trading symbols into groups (100 symbols per worker)
3. **Supported Data Types**: Kline (candlestick), Depth (order book), Ticker (price summary)

## Features

- **Real-time Data**: Streams market data in real-time from Binance
- **Multiple Stream Types**: Support for kline, depth, and ticker streams
- **Dynamic Subscriptions**: Clients can subscribe/unsubscribe to specific symbols and stream types
- **Scalable Architecture**: Worker threads process data in parallel
- **Efficient Messaging**: NATS provides high-throughput messaging between components

## Prerequisites

- Node.js (v14+)
- NATS Server

## Installation

### Standard Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/future-socket-nats.git
   cd future-socket-nats
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start a NATS server (if not already running):
   ```bash
   # Using Docker
   docker run -p 4222:4222 -p 8222:8222 nats
   ```

4. Configure environment variables (optional):
   ```bash
   # Copy the example .env file
   cp .env.example .env
   # Edit the .env file to customize settings
   ```

### Docker Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/future-socket-nats.git
   cd future-socket-nats
   ```

2. Build and start the services using Docker Compose:
   ```bash
   # Chạy script tự động
   ./start-docker.sh
   
   # Hoặc chạy trực tiếp với docker-compose
   docker-compose up -d
   ```

3. Check logs:
   ```bash
   # For the application
   docker-compose logs -f app
   
   # For NATS server
   docker-compose logs -f nats
   ```

4. Stop the services:
   ```bash
   docker-compose down
   ```

5. Access the monitoring interface (Portainer):
   ```
   http://localhost:9000
   ```
   Truy cập lần đầu tiên bạn sẽ cần tạo tài khoản admin.

### Docker Services

- **WebSocket Server**: Chạy trên cổng 8080
- **NATS Server**: Chạy trên cổng 4222
- **Portainer**: Giao diện quản lý Docker, chạy trên cổng 9000

### PM2 Monitoring

Hệ thống sử dụng PM2 để quản lý quy trình Node.js trong Docker. PM2 cung cấp các tính năng:
- Tự động khởi động lại khi gặp lỗi
- Quản lý bộ nhớ tối đa (1GB)
- Ghi log tập trung

Logs được lưu trong thư mục `logs` và được liên kết vào container.

## Usage

### Start the Server

```bash
npm start
```

### Run the Example Client

```bash
npm run client
```

The example client provides a simple CLI interface to:
- Subscribe to symbols
- Unsubscribe from symbols
- Change stream types
- View current subscriptions

## Project Structure

```
├── src/
│   ├── index.js            # Main server entry point
│   ├── services/           # Core services
│   │   ├── binanceService.js  # Binance API interactions
│   │   ├── natsService.js     # NATS messaging service
│   │   ├── workerManager.js   # Manages worker threads
│   │   └── wsServer.js        # WebSocket server for clients
│   ├── utils/              # Utilities
│   │   ├── config.js          # Configuration settings
│   │   └── logger.js          # Logging utility
│   └── workers/            # Worker thread implementations
│       └── binanceWorker.js   # Worker for processing Binance data
├── client.js              # Example client implementation
├── .env                   # Environment configuration
├── Dockerfile             # Docker configuration
├── docker-compose.yml     # Docker Compose configuration
├── package.json           # Project metadata and dependencies
└── README.md              # Project documentation
```

## Client API

### Connecting

Connect to the WebSocket server:
```javascript
const ws = new WebSocket('ws://localhost:8080');
```

### Subscribing to Data

Send a subscription message:
```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  streamType: 'kline', // 'kline', 'depth', or 'ticker'
  symbols: ['btcusdt', 'ethusdt'], // Array of symbols
  options: { interval: '1m' } // Optional parameters
}));
```

### Unsubscribing from Data

Send an unsubscription message:
```javascript
ws.send(JSON.stringify({
  type: 'unsubscribe',
  streamType: 'kline',
  symbols: ['btcusdt', 'ethusdt']
}));
```

### Message Format

Incoming messages follow this structure:
```javascript
// Kline data example
{
  type: 'kline',
  data: {
    // Binance WebSocket data format
    stream: 'btcusdt@kline_1m',
    data: {
      e: 'kline',
      E: 1672576800000,
      s: 'BTCUSDT',
      k: {
        t: 1672576800000,
        T: 1672576859999,
        s: 'BTCUSDT',
        i: '1m',
        f: 100,
        L: 200,
        o: '16500.00',
        c: '16510.00',
        h: '16515.00',
        l: '16499.00',
        v: '10.5',
        n: 100,
        x: false,
        q: '173250.00',
        V: '5.5',
        Q: '90775.00',
        B: '0'
      }
    }
  }
}
```

## License

MIT

## Contributing

Contributions welcome! Please feel free to submit a Pull Request. 