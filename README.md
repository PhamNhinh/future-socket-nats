# Future Socket NATS Server

Dịch vụ WebSocket proxy cho dữ liệu thị trường Binance, sử dụng NATS để xử lý phân phối dữ liệu tối ưu.

## Tính năng

- Kết nối WebSocket proxy tối ưu đến Binance API
- Hỗ trợ cả thị trường Spot và Futures
- Xử lý nhiều kết nối đồng thời với hiệu suất cao
- Đăng ký theo từng cặp giao dịch hoặc tất cả cặp
- Hỗ trợ đăng ký raw stream theo định dạng Binance
- Tích hợp NATS để phân phối dữ liệu hiệu quả
- Quản lý quy trình với PM2

## Yêu cầu hệ thống

- Node.js 18.x trở lên
- NATS Server
- Docker & Docker Compose (tùy chọn)

## Cài đặt

### Cài đặt thông thường

1. Clone repository:
```bash
git clone https://github.com/your-username/future-socket-nats.git
cd future-socket-nats
```

2. Cài đặt các phụ thuộc:
```bash
npm install
```

3. Cài đặt PM2 (tùy chọn):
```bash
npm install pm2 -g
```

4. Cấu hình ứng dụng:
   - Sao chép file `.env.example` thành `.env`
   - Chỉnh sửa cấu hình theo môi trường của bạn

### Sử dụng Docker

1. Clone repository:
```bash
git clone https://github.com/your-username/future-socket-nats.git
cd future-socket-nats
```

2. Cấu hình ứng dụng:
   - Sao chép file `.env.example` thành `.env`
   - Chỉnh sửa cấu hình theo môi trường của bạn

3. Khởi động với Docker Compose:
```bash
docker-compose up -d
```

## Cấu hình

Các biến môi trường có thể được thiết lập trong file `.env`:

| Biến | Mô tả | Mặc định |
|------|-------|----------|
| NODE_ENV | Môi trường chạy | development |
| WS_PORT | Cổng WebSocket server | 8080 |
| NATS_URL | URL kết nối đến NATS | nats://localhost:4222 |
| SYMBOLS_PER_WORKER | Số lượng cặp giao dịch mỗi worker | 100 |
| LOG_LEVEL | Mức độ log | info |
| USE_FUTURES | Sử dụng thị trường Futures | false |

## Chạy ứng dụng

### Sử dụng Node.js

```bash
# Chạy trong môi trường phát triển
npm run dev

# Chạy trong môi trường sản xuất
npm start
```

### Sử dụng PM2

```bash
# Chạy trong môi trường phát triển
npm run pm2:start

# Chạy trong môi trường sản xuất
npm run pm2:start:prod

# Dừng ứng dụng
npm run pm2:stop

# Khởi động lại ứng dụng
npm run pm2:restart

# Xem logs
npm run pm2:logs

# Giám sát ứng dụng
npm run pm2:monitor
```

### Sử dụng Docker Compose

```bash
# Khởi động ứng dụng
docker-compose up -d

# Xem logs
docker-compose logs -f app

# Dừng ứng dụng
docker-compose down
```

## Hướng dẫn client

Vui lòng xem file [CLIENT_GUIDE.md](CLIENT_GUIDE.md) để biết hướng dẫn chi tiết về cách kết nối client đến server.

## Giấy phép

[MIT](LICENSE) 