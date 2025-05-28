import fetch from 'node-fetch';
import WebSocket from 'ws';
import { 
  BINANCE_API_URL, 
  BINANCE_WS_URL, 
  BINANCE_FUTURES_API_URL, 
  BINANCE_FUTURES_WS_URL, 
  RATE_LIMIT,
  WS_CONNECTION
} from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('BinanceService');

// Theo dõi số lượng kết nối đang mở
let activeConnectionCount = 0;
// Hàng đợi các kết nối đang chờ
const connectionQueue = [];

/**
 * Service to interact with Binance API
 */
export class BinanceService {
  /**
   * Fetch all available symbols from Binance
   * @returns {Promise<string[]>} Array of symbol names (lowercase)
   */
  async fetchSymbols() {
    try {
      logger.info('Fetching available symbols from Binance');
      
      const response = await fetch(`${BINANCE_API_URL}/api/v3/exchangeInfo`);
      const data = await response.json();
      
      if (!data.symbols) {
        throw new Error('Invalid response from Binance API');
      }
      
      // Filter trading pairs (remove those not currently trading)
      const symbols = data.symbols
        .filter(symbol => symbol.status === 'TRADING')
        .map(symbol => symbol.symbol.toLowerCase());
      
      logger.info(`Fetched ${symbols.length} symbols from Binance`);
      return symbols;
    } catch (error) {
      logger.error('Error fetching symbols from Binance', error);
      return [];
    }
  }

  /**
   * Fetch all available futures symbols from Binance
   * @returns {Promise<string[]>} Array of futures symbol names (lowercase)
   */
  async fetchFutureSymbols() {
    try {
      logger.info('Fetching available futures symbols from Binance');
      
      const response = await fetch(`${BINANCE_FUTURES_API_URL}/fapi/v1/exchangeInfo`);
      const data = await response.json();
      
      if (!data.symbols) {
        throw new Error('Invalid response from Binance Futures API');
      }
      
      // Filter trading pairs (remove those not currently trading)
      const symbols = data.symbols
        .filter(symbol => symbol.status === 'TRADING')
        .map(symbol => symbol.symbol.toLowerCase());
      
      logger.info(`Fetched ${symbols.length} futures symbols from Binance`);
      return symbols;
    } catch (error) {
      logger.error('Error fetching futures symbols from Binance', error);
      return [];
    }
  }

  /**
   * Create a WebSocket connection to Binance for multiple streams
   * Includes retry mechanism and connection pooling
   * @param {string[]} streams - Array of stream names
   * @param {boolean} isFuture - Whether to connect to futures API
   * @param {number} retryCount - Current retry count (internal use)
   * @returns {Promise<WebSocket>} WebSocket connection
   */
  static async createWebSocketConnection(streams, isFuture = false, retryCount = 0) {
    if (!streams || streams.length === 0) {
      logger.error('No streams provided for WebSocket connection');
      throw new Error('No streams provided for WebSocket connection');
    }

    // Limit the number of streams per connection to avoid URL length issues
    if (streams.length > WS_CONNECTION.MAX_STREAMS_PER_CONNECTION) {
      logger.warn(`Too many streams (${streams.length}) for one connection, splitting into multiple connections`);
      const streamBatches = [];
      for (let i = 0; i < streams.length; i += WS_CONNECTION.MAX_STREAMS_PER_CONNECTION) {
        streamBatches.push(streams.slice(i, i + WS_CONNECTION.MAX_STREAMS_PER_CONNECTION));
      }
      
      // Create a combined connection that proxies events from all the batched connections
      const combinedConnection = new WebSocket.EventEmitter();
      let openedConnections = 0;
      let closedConnections = 0;
      
      for (const batch of streamBatches) {
        try {
          const conn = await this.createWebSocketConnection(batch, isFuture);
          
          // Forward events from each connection to the combined one
          conn.on('open', () => {
            openedConnections++;
            if (openedConnections === streamBatches.length) {
              combinedConnection.emit('open');
            }
          });
          
          conn.on('message', (data) => {
            combinedConnection.emit('message', data);
          });
          
          conn.on('error', (error) => {
            combinedConnection.emit('error', error);
          });
          
          conn.on('close', () => {
            closedConnections++;
            if (closedConnections === streamBatches.length) {
              combinedConnection.emit('close');
            }
          });
          
          // Add a method to close all connections
          if (!combinedConnection.close) {
            combinedConnection.close = () => {
              streamBatches.forEach(async (_, index) => {
                try {
                  const conn = await this.createWebSocketConnection(streamBatches[index], isFuture);
                  conn.close();
                } catch (e) {
                  // Ignore errors on close
                }
              });
            };
          }
        } catch (error) {
          logger.error(`Error creating WebSocket connection for batch: ${error.message}`);
          // Continue with other batches even if one fails
        }
      }
      
      return combinedConnection;
    }

    // If too many active connections, queue this request
    if (activeConnectionCount >= WS_CONNECTION.MAX_CONCURRENT_CONNECTIONS) {
      logger.debug(`Max connections reached (${activeConnectionCount}), queueing connection request`);
      return new Promise((resolve, reject) => {
        connectionQueue.push({ streams, isFuture, resolve, reject });
      });
    }

    // Increment active connection count
    activeConnectionCount++;

    return new Promise((resolve, reject) => {
      try {
        // Format for spot: wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m
        // Format for futures: wss://fstream.binance.com/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m
        const baseUrl = isFuture ? 'wss://fstream.binance.com' : BINANCE_WS_URL;
        const url = `${baseUrl}/stream?streams=${streams.join('/')}`;
        logger.debug(`Creating WebSocket connection to: ${url}`);
        
        const ws = new WebSocket(url);
        let connectionEstablished = false;
        
        // Handle connection open
        ws.on('open', () => {
          // Send a ping to test the connection
          logger.debug(`WebSocket connection opened for ${streams.length} streams, sending ping to verify`);
          
          try {
            ws.ping();
          } catch (error) {
            // If ping fails, consider connection not established
            logger.error(`Failed to ping new connection: ${error.message}`);
            return;
          }
        });
        
        // Handle pong response to confirm connection is truly ready
        ws.on('pong', () => {
          logger.debug(`Received pong, connection is confirmed ready for ${streams.length} streams`);
          connectionEstablished = true;
          resolve(ws);
          
          // Process next queued connection if any
          processNextQueuedConnection();
        });
        
        // Handle connection error
        ws.on('error', (error) => {
          // If connection was already established, don't retry
          if (connectionEstablished) return;
          
          // If max retries reached, reject the promise
          if (retryCount >= WS_CONNECTION.MAX_RETRIES) {
            activeConnectionCount--;
            logger.error(`WebSocket connection failed after ${WS_CONNECTION.MAX_RETRIES} retries: ${error.message}`);
            reject(new Error(`Failed to connect after ${WS_CONNECTION.MAX_RETRIES} retries: ${error.message}`));
            
            // Process next queued connection if any
            processNextQueuedConnection();
            return;
          }
          
          // Otherwise retry after delay
          logger.warn(`WebSocket connection error, retrying (${retryCount + 1}/${WS_CONNECTION.MAX_RETRIES}): ${error.message}`);
          setTimeout(() => {
            // Don't decrement activeConnectionCount here because we're retrying
            this.createWebSocketConnection(streams, isFuture, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, WS_CONNECTION.RETRY_DELAY_MS * (retryCount + 1));
        });
        
        // Handle connection close
        ws.on('close', () => {
          // Only decrement if connection was established
          if (connectionEstablished) {
            activeConnectionCount--;
            // Process next queued connection if any
            processNextQueuedConnection();
          }
        });
        
        // Set connection timeout
        setTimeout(() => {
          if (!connectionEstablished) {
            ws.terminate();
            
            // If max retries reached, reject the promise
            if (retryCount >= WS_CONNECTION.MAX_RETRIES) {
              activeConnectionCount--;
              logger.error(`WebSocket connection timeout after ${WS_CONNECTION.MAX_RETRIES} retries`);
              reject(new Error(`Connection timeout after ${WS_CONNECTION.MAX_RETRIES} retries`));
              
              // Process next queued connection if any
              processNextQueuedConnection();
              return;
            }
            
            // Otherwise retry after delay
            logger.warn(`WebSocket connection timeout, retrying (${retryCount + 1}/${WS_CONNECTION.MAX_RETRIES})`);
            setTimeout(() => {
              // Don't decrement activeConnectionCount here because we're retrying
              this.createWebSocketConnection(streams, isFuture, retryCount + 1)
                .then(resolve)
                .catch(reject);
            }, WS_CONNECTION.RETRY_DELAY_MS * (retryCount + 1));
          }
        }, WS_CONNECTION.CONNECTION_TIMEOUT_MS);
        
      } catch (error) {
        activeConnectionCount--;
        logger.error(`Error creating WebSocket connection: ${error.message}`);
        reject(error);
        
        // Process next queued connection if any
        processNextQueuedConnection();
      }
    });
  }

  /**
   * Format kline stream name for a symbol
   */
  static getKlineStreamName(symbol, interval = '1m') {
    return `${symbol}@kline_${interval}`;
  }

  /**
   * Format depth stream name for a symbol
   */
  static getDepthStreamName(symbol, level = '20') {
    return `${symbol}@depth${level}`;
  }

  /**
   * Format ticker stream name for a symbol
   */
  static getTickerStreamName(symbol) {
    return `${symbol}@ticker`;
  }

  /**
   * Format mark price stream name for a futures symbol
   */
  static getMarkPriceStreamName(symbol, updateSpeed = '1s') {
    return `${symbol}@markPrice@${updateSpeed}`;
  }

  /**
   * Format liquidation stream name
   */
  static getLiquidationStreamName() {
    return `!forceOrder@arr`;
  }

  /**
   * Get stream name based on stream type and symbol
   */
  static getStreamName(streamType, symbol, options = {}) {
    switch (streamType) {
      case 'kline':
        return this.getKlineStreamName(symbol, options.interval);
      case 'depth':
        return this.getDepthStreamName(symbol, options.level);
      case 'ticker':
        return this.getTickerStreamName(symbol);
      case 'markPrice':
        return this.getMarkPriceStreamName(symbol, options.updateSpeed);
      case 'liquidation':
        return this.getLiquidationStreamName();
      default:
        throw new Error(`Unknown stream type: ${streamType}`);
    }
  }

  /**
   * Fetch historical kline data with rate limit handling
   * @param {string} symbol - Trading pair symbol (e.g. 'btcusdt')
   * @param {string} interval - Kline interval (e.g. '1m', '5m', '1h', '1d')
   * @param {number} limit - Number of candles to fetch (max 1000)
   * @param {number} startTime - Optional start time in milliseconds
   * @param {number} endTime - Optional end time in milliseconds
   * @param {boolean} isFutures - Whether to fetch from futures API
   * @returns {Promise<Array>} Array of kline data
   */
  async fetchHistoricalKlines(symbol, interval, limit = 1000, startTime = null, endTime = null, isFutures = false) {
    try {
      const baseUrl = isFutures ? BINANCE_FUTURES_API_URL : BINANCE_API_URL;
      const endpoint = isFutures ? '/fapi/v1/klines' : '/api/v3/klines';
      
      // Build query parameters
      const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        interval,
        limit: Math.min(limit, 1000) // Enforce maximum limit of 1000
      });
      
      if (startTime) params.append('startTime', startTime);
      if (endTime) params.append('endTime', endTime);
      
      const url = `${baseUrl}${endpoint}?${params.toString()}`;
      
      logger.debug(`Fetching historical klines for ${symbol} (${interval}) from ${isFutures ? 'futures' : 'spot'}`);
      
      // Implement basic rate limiting
      await this._applyRateLimit(true);
      
      const response = await fetch(url);
      
      // Handle API response status
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Binance API error: ${errorData.msg || response.statusText}`);
      }
      
      const data = await response.json();
      logger.debug(`Fetched ${data.length} historical klines for ${symbol}`);
      
      return data;
    } catch (error) {
      logger.error(`Error fetching historical klines for ${symbol}`, error);
      throw error;
    }
  }
  
  /**
   * Apply rate limiting to avoid Binance API limits
   * Binance has a weight-based rate limit system
   * @param {boolean} isHistorical - Whether this is for historical data requests (which have stricter limits)
   */
  async _applyRateLimit(isHistorical = false) {
    // Track last request time and request count
    if (!this.constructor._lastRequestTime) {
      this.constructor._lastRequestTime = Date.now();
      this.constructor._requestCount = 0;
      this.constructor._historicalRequestCount = 0;
    }
    
    const now = Date.now();
    const elapsed = now - this.constructor._lastRequestTime;
    
    // Reset counter if more than a minute has passed
    if (elapsed > RATE_LIMIT.RATE_LIMIT_WINDOW_MS) {
      this.constructor._lastRequestTime = now;
      this.constructor._requestCount = 0;
      this.constructor._historicalRequestCount = 0;
      return;
    }
    
    // Track different counters for different types of requests
    if (isHistorical) {
      this.constructor._historicalRequestCount++;
    } else {
      this.constructor._requestCount++;
    }
    
    // Apply appropriate rate limit based on request type
    const maxRequests = isHistorical 
      ? RATE_LIMIT.MAX_HISTORICAL_REQUESTS_PER_MINUTE 
      : RATE_LIMIT.MAX_REQUESTS_PER_MINUTE;
    
    const requestCount = isHistorical 
      ? this.constructor._historicalRequestCount 
      : this.constructor._requestCount;
    
    // If we've made too many requests in the window, delay
    if (requestCount > maxRequests) {
      // Calculate delay to spread requests evenly within the minute
      const segmentMs = RATE_LIMIT.RATE_LIMIT_WINDOW_MS / maxRequests;
      const delay = Math.max(0, segmentMs - (elapsed % segmentMs));
      
      logger.debug(`Rate limiting applied for ${isHistorical ? 'historical' : 'regular'} request, waiting ${delay}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Update time after waiting
      this.constructor._lastRequestTime = Date.now();
      
      // Reset appropriate counter
      if (isHistorical) {
        this.constructor._historicalRequestCount = 0;
      } else {
        this.constructor._requestCount = 0;
      }
    }
  }
}

/**
 * Process the next queued connection request if available
 */
function processNextQueuedConnection() {
  if (connectionQueue.length > 0 && activeConnectionCount < WS_CONNECTION.MAX_CONCURRENT_CONNECTIONS) {
    const { streams, isFuture, resolve, reject } = connectionQueue.shift();
    logger.debug(`Processing queued connection request, ${connectionQueue.length} remaining in queue`);
    
    BinanceService.createWebSocketConnection(streams, isFuture)
      .then(resolve)
      .catch(reject);
  }
} 