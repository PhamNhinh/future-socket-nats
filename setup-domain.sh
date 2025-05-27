#!/bin/bash

# Kiểm tra quyền root
if [[ $EUID -ne 0 ]]; then
   echo "Script này yêu cầu quyền root. Vui lòng chạy với sudo."
   exit 1
fi

# Cài đặt Nginx nếu chưa có
apt update
if ! dpkg -l | grep -q nginx; then
  echo "Cài đặt Nginx..."
  apt install -y nginx
fi

# Cài đặt Certbot nếu chưa có
if ! dpkg -l | grep -q certbot; then
  echo "Cài đặt Certbot..."
  apt install -y certbot python3-certbot-nginx
fi

# Di chuyển file cấu hình Nginx
echo "Cấu hình Nginx cho WebSocket..."
cp nginx-websocket.conf /etc/nginx/sites-available/bnb-socket.conf

# Tạo symbolic link
ln -sf /etc/nginx/sites-available/bnb-socket.conf /etc/nginx/sites-enabled/

# Kiểm tra cấu hình Nginx
nginx -t

# Nếu cấu hình hợp lệ, khởi động lại Nginx
if [ $? -eq 0 ]; then
  systemctl restart nginx
  echo "Đã khởi động lại Nginx."
else
  echo "Lỗi cấu hình Nginx. Vui lòng kiểm tra lại."
  exit 1
fi

# Lấy chứng chỉ SSL từ Let's Encrypt
echo "Bạn có muốn lấy chứng chỉ SSL từ Let's Encrypt không? (y/n)"
read -p "Trả lời: " answer

if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
  echo "Đang lấy chứng chỉ SSL..."
  certbot --nginx -d bnb-socket.docserver.name
  
  if [ $? -eq 0 ]; then
    echo "Đã cài đặt SSL thành công!"
  else
    echo "Lỗi khi lấy chứng chỉ SSL. Vui lòng kiểm tra lại."
    exit 1
  fi
fi

echo ""
echo "Hoàn tất cấu hình! WebSocket server của bạn có thể truy cập qua:"
echo "wss://bnb-socket.docserver.name"
echo ""
echo "Lưu ý: Đảm bảo rằng:"
echo "1. DNS của domain đã được cấu hình đúng"
echo "2. Cổng 80 và 443 đã được mở trong tường lửa"
echo "3. WebSocket server của bạn đang chạy trên cổng 8081" 