FROM node:18-alpine

# Cài đặt PM2 toàn cục
RUN npm install pm2 -g

WORKDIR /app

# Copy package files và cài đặt dependencies
COPY package*.json ./
RUN npm install

# Copy mã nguồn và cấu hình
COPY . .

# Mở port để WebSocket server có thể lắng nghe
EXPOSE 8080

# Khởi động ứng dụng với PM2 - sửa lại command
CMD ["pm2-runtime", "src/index.js"] 