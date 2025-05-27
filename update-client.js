/**
 * Script cập nhật client để kết nối qua WSS
 */
import fs from 'fs';
import path from 'path';

// Đường dẫn đến file client
const clientPath = './client.js';

// Đọc nội dung file
console.log('Đọc file client...');
let clientContent = fs.readFileSync(clientPath, 'utf8');

// Cập nhật URL kết nối
console.log('Cập nhật URL kết nối...');
clientContent = clientContent.replace(
  /const WS_URL = ['"]ws:\/\/localhost:8081['"];/,
  'const WS_URL = \'wss://bnb-socket.docserver.name\';'
);

// Ghi lại file
console.log('Ghi lại file...');
fs.writeFileSync(clientPath, clientContent);

console.log('Hoàn tất! Client đã được cập nhật để kết nối qua wss://bnb-socket.docserver.name');
console.log('Để chạy client: node client.js'); 