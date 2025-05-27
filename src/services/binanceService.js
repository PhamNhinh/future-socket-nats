import fetch from 'node-fetch';
import WebSocket from 'ws';
import { BINANCE_API_URL, BINANCE_WS_URL } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('BinanceService');

/**
 * Service to interact with Binance API
 */
export class BinanceService {
  /**
   * Fetch all available trading symbols from Binance
   */
  static async fetchSymbols() {
    try {
      logger.info('Fetching available symbols from Binance');
      const response = await fetch(`${BINANCE_API_URL}/exchangeInfo`);
      
      if (!response.ok) {
        throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const symbols = data.symbols
        .filter(symbol => symbol.status === 'TRADING')
        .map(symbol => symbol.symbol.toLowerCase());
      
      logger.info(`Successfully fetched ${symbols.length} trading symbols`);
      return symbols;
    } catch (error) {
      logger.error('Failed to fetch symbols from Binance', error);
      throw error;
    }
  }

  /**
   * Fetch all available future trading symbols from Binance
   */
  static async fetchFutureSymbols() {
    try {
      logger.info('Fetching available future symbols from Binance');
      const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
      
      if (!response.ok) {
        throw new Error(`Binance Futures API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const symbols = data.symbols
        .filter(symbol => symbol.status === 'TRADING')
        .map(symbol => symbol.symbol.toLowerCase());
      
      logger.info(`Successfully fetched ${symbols.length} future trading symbols`);
      return symbols;
    } catch (error) {
      logger.error('Failed to fetch future symbols from Binance', error);
      throw error;
    }
  }

  /**
   * Create a WebSocket connection to Binance for multiple streams
   */
  static createWebSocketConnection(streams, isFuture = false) {
    if (!streams || streams.length === 0) {
      logger.error('No streams provided for WebSocket connection');
      throw new Error('No streams provided for WebSocket connection');
    }

    // Format for spot: wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m
    // Format for futures: wss://fstream.binance.com/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m
    const baseUrl = isFuture ? 'wss://fstream.binance.com' : BINANCE_WS_URL;
    const url = `${baseUrl}/stream?streams=${streams.join('/')}`;
    logger.debug(`Creating WebSocket connection to: ${url}`);
    
    const ws = new WebSocket(url);
    
    return ws;
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
} 