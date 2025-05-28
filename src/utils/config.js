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
export const BINANCE_WS_URL = process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws';
export const BINANCE_API_URL = process.env.BINANCE_API_URL || 'https://api.binance.com';

// Binance Futures API Configuration
export const BINANCE_FUTURES_WS_URL = process.env.BINANCE_FUTURES_WS_URL || 'wss://fstream.binance.com/ws';
export const BINANCE_FUTURES_API_URL = process.env.BINANCE_FUTURES_API_URL || 'https://fapi.binance.com';

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
  ERROR: 'error',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
  GET_HISTORICAL_KLINES: 'getHistoricalKlines',
  HISTORICAL_KLINES: 'historicalKlines'
};

// Supported stream types
export const STREAM_TYPES = ['kline', 'depth', 'ticker', 'markPrice', 'liquidation'];

// Supported stream types for specific markets
export const SPOT_STREAM_TYPES = ['kline', 'depth', 'ticker'];
export const FUTURES_STREAM_TYPES = ['kline', 'depth', 'ticker', 'markPrice', 'liquidation'];

// Rate limiting configuration
export const RATE_LIMIT = {
  MAX_REQUESTS_PER_MINUTE: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '30', 10),
  MAX_HISTORICAL_REQUESTS_PER_MINUTE: parseInt(process.env.MAX_HISTORICAL_REQUESTS_PER_MINUTE || '10', 10),
  RATE_LIMIT_WINDOW_MS: 60000
};

// WebSocket connection management
export const WS_CONNECTION = {
  MAX_CONCURRENT_CONNECTIONS: parseInt(process.env.MAX_CONCURRENT_CONNECTIONS || '10', 10),
  MAX_STREAMS_PER_CONNECTION: parseInt(process.env.MAX_STREAMS_PER_CONNECTION || '200', 10),
  CONNECTION_TIMEOUT_MS: parseInt(process.env.CONNECTION_TIMEOUT_MS || '10000', 10),
  RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS || '1000', 10),
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),
  CONNECTION_SWITCH_DELAY_MS: parseInt(process.env.CONNECTION_SWITCH_DELAY_MS || '2000', 10)
};

// Batch processing configuration
export const BATCH_PROCESSING = {
  MAX_BATCH_SIZE: parseInt(process.env.MAX_BATCH_SIZE || '100', 10),
  BATCH_INTERVAL_MS: parseInt(process.env.BATCH_INTERVAL_MS || '1000', 10),
  BATCH_DELAY_MS: parseInt(process.env.BATCH_DELAY_MS || '2000', 10)
}; 