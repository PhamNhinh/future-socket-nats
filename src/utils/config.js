import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Get the current directory path
const __dirname = dirname(fileURLToPath(import.meta.url));

// Server configuration
export const WS_PORT = process.env.WS_PORT || 8080;
export const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

// Binance API Configuration
export const SYMBOLS_PER_WORKER = parseInt(process.env.SYMBOLS_PER_WORKER || '100', 10);
export const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';
export const BINANCE_API_URL = 'https://api.binance.com/api/v3';

// Binance Futures API Configuration
export const BINANCE_FUTURES_WS_URL = 'wss://fstream.binance.com/ws';
export const BINANCE_FUTURES_API_URL = 'https://fapi.binance.com/fapi/v1';

// Use futures market instead of spot
export const USE_FUTURES = process.env.USE_FUTURES === 'true';

// NATS Subjects
export const NATS_SUBJECTS = {
  KLINE: 'market.kline',
  DEPTH: 'market.depth',
  TICKER: 'market.ticker',
  MARK_PRICE: 'market.markPrice',
  LIQUIDATION: 'market.liquidation',
  CONTROL: 'market.control'
};

// Log levels
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Message types for client communication
export const MESSAGE_TYPES = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  KLINE: 'kline',
  DEPTH: 'depth',
  TICKER: 'ticker',
  MARK_PRICE: 'markPrice',
  LIQUIDATION: 'liquidation',
  ERROR: 'error'
};

// Supported stream types
export const STREAM_TYPES = ['kline', 'depth', 'ticker', 'markPrice', 'liquidation'];

// Supported stream types for specific markets
export const SPOT_STREAM_TYPES = ['kline', 'depth', 'ticker'];
export const FUTURES_STREAM_TYPES = ['kline', 'depth', 'ticker', 'markPrice', 'liquidation']; 