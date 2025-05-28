import { WS_PORT, USE_FUTURES, FUTURES_STREAM_TYPES, SPOT_STREAM_TYPES } from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { BinanceService } from './services/binanceService.js';
import { NatsService } from './services/natsService.js';
import { WorkerManager } from './services/workerManager.js';
import { WSServer } from './services/wsServer.js';

const logger = createLogger('Main');

// Store the server components
let natsService;
let workerManager;
let wsServer;

/**
 * Initialize the server
 */
async function initializeServer() {
  try {
    const marketType = USE_FUTURES ? 'Futures' : 'Spot';
    logger.info(`Starting Binance ${marketType} WebSocket server with NATS`);
    
    // Fetch available trading symbols from Binance
    let symbols;
    const binanceService = new BinanceService();
    
    if (USE_FUTURES) {
      symbols = await binanceService.fetchFutureSymbols();
      logger.info(`Loaded ${symbols.length} future trading symbols from Binance`);
    } else {
      symbols = await binanceService.fetchSymbols();
      logger.info(`Loaded ${symbols.length} spot trading symbols from Binance`);
    }
    
    // Initialize NATS service
    logger.info('Initializing NATS service');
    natsService = new NatsService();
    await natsService.connect();
    
    // Initialize worker manager with appropriate stream types
    logger.info('Initializing worker manager');
    workerManager = new WorkerManager();
    const streamTypes = USE_FUTURES ? FUTURES_STREAM_TYPES : SPOT_STREAM_TYPES;
    await workerManager.initializeWorkers(symbols, streamTypes, USE_FUTURES);
    
    // Initialize WebSocket server
    logger.info(`Starting WebSocket server on port ${WS_PORT}`);
    wsServer = new WSServer(WS_PORT, natsService, workerManager);
    wsServer.start();
    
    logger.info('Server started successfully');
    
    // Setup cleanup on process exit
    setupCleanupHandlers();
    
  } catch (error) {
    logger.error('Failed to initialize server', error);
    process.exit(1);
  }
}

/**
 * Set up cleanup handlers for graceful shutdown
 */
function setupCleanupHandlers() {
  // Handle ctrl+c
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal, shutting down...');
    await shutdownServer();
    process.exit(0);
  });
  
  // Handle kill signal
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal, shutting down...');
    await shutdownServer();
    process.exit(0);
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception', error);
    await shutdownServer();
    process.exit(1);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled promise rejection', reason);
    await shutdownServer();
    process.exit(1);
  });
}

/**
 * Shutdown the server components
 */
async function shutdownServer() {
  logger.info('Shutting down server components');
  
  // Shutdown in reverse order of initialization
  
  // Stop WebSocket server
  if (wsServer) {
    logger.info('Stopping WebSocket server');
    wsServer.stop();
  }
  
  // Shutdown worker threads
  if (workerManager) {
    logger.info('Shutting down worker manager');
    await workerManager.shutdownWorkers();
  }
  
  // Close NATS connection
  if (natsService) {
    logger.info('Closing NATS connection');
    await natsService.close();
  }
  
  logger.info('Server shutdown complete');
}

// Start the server
initializeServer(); 