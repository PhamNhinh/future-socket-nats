#!/bin/bash

# Tạo thư mục logs nếu chưa tồn tại
mkdir -p logs

# Dừng và xóa các container cũ (nếu có)
echo "Dừng các container cũ nếu có..."
docker-compose down

# Xây dựng và khởi động các container
echo "Xây dựng và khởi động dịch vụ..."
docker-compose up -d --build

# Hiển thị trạng thái
echo "Trạng thái các container:"
docker-compose ps

echo ""
echo "WebSocket server đang chạy tại: http://localhost:8081"
echo "NATS server đang chạy tại: localhost:4222"
echo "Portainer (Giao diện quản lý) đang chạy tại: http://localhost:9000"
echo ""
echo "Để xem logs, chạy lệnh: docker-compose logs -f app"
echo "Để dừng dịch vụ, chạy lệnh: docker-compose down" 