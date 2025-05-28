import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { SYMBOLS_PER_WORKER, BATCH_PROCESSING } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { BinanceService } from '../services/binanceService.js';

const logger = createLogger('WorkerManager');

// Get the current directory path
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Path to worker script
const WORKER_PATH = path.resolve(__dirname, '../workers/binanceWorker.js');

// Maximum symbols to process in a single batch
const MAX_BATCH_SIZE = BATCH_PROCESSING.MAX_BATCH_SIZE;

/**
 * Manages worker threads for processing Binance data
 */
export class WorkerManager {
  constructor() {
    this.workers = new Map();
    this.workerReady = new Map();
    this.symbolToWorker = new Map();
    this.isFutures = false;
    
    // Request batching and queuing
    this.pendingSubscribeRequests = new Map(); // Map<streamType, Set<symbol>>
    this.pendingUnsubscribeRequests = new Map(); // Map<streamType, Set<symbol>>
    this.processingBatch = false;
    this.batchProcessTimer = null;
  }

  /**
   * Initialize workers with available symbols
   */
  async initializeWorkers(symbols, streamTypes, isFutures = false) {
    logger.info(`Initializing ${isFutures ? 'futures' : 'spot'} workers for ${symbols.length} symbols`);
    
    this.isFutures = isFutures;
    
    // Divide symbols into groups
    const symbolGroups = this._divideSymbolsIntoGroups(symbols);
    
    logger.info(`Created ${symbolGroups.length} symbol groups`);
    
    // Create and initialize workers for each group
    const workerPromises = symbolGroups.map((symbolGroup, index) => 
      this._createWorker(index, symbolGroup, streamTypes, isFutures)
    );
    
    // Wait for all workers to be ready
    await Promise.all(workerPromises);
    
    logger.info('All workers initialized successfully');
    
    // Start batch processing timer
    this._startBatchProcessor();
  }
  
  /**
   * Start the batch processor for processing subscribe/unsubscribe requests in batches
   */
  _startBatchProcessor() {
    // Clear any existing timer
    if (this.batchProcessTimer) {
      clearInterval(this.batchProcessTimer);
    }
    
    // Set up interval to process batches every 1 second
    this.batchProcessTimer = setInterval(() => {
      this._processPendingRequests();
    }, BATCH_PROCESSING.BATCH_INTERVAL_MS);
    
    logger.info(`Started batch request processor with interval ${BATCH_PROCESSING.BATCH_INTERVAL_MS}ms`);
  }
  
  /**
   * Process pending subscribe and unsubscribe requests in batches
   */
  async _processPendingRequests() {
    // Skip if already processing a batch
    if (this.processingBatch) {
      return;
    }
    
    this.processingBatch = true;
    
    try {
      // Process subscribe requests first
      for (const [streamType, symbols] of this.pendingSubscribeRequests.entries()) {
        if (symbols.size === 0) continue;
        
        logger.info(`Processing batch of ${symbols.size} pending subscribe requests for ${streamType}`);
        
        // Convert set to array for processing
        const symbolsArray = Array.from(symbols);
        
        // Process in batches of MAX_BATCH_SIZE
        for (let i = 0; i < symbolsArray.length; i += MAX_BATCH_SIZE) {
          const batch = symbolsArray.slice(i, i + MAX_BATCH_SIZE);
          logger.info(`Processing subscribe batch ${Math.floor(i / MAX_BATCH_SIZE) + 1}/${Math.ceil(symbolsArray.length / MAX_BATCH_SIZE)} for ${streamType} (${batch.length} symbols)`);
          
          // Process this batch
          await this._processSubscribeBatch(streamType, batch);
          
          // Introduce a small delay between batches to avoid overwhelming the connection
          if (i + MAX_BATCH_SIZE < symbolsArray.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_PROCESSING.BATCH_DELAY_MS));
          }
        }
        
        // Clear processed symbols
        symbols.clear();
      }
      
      // Then process unsubscribe requests
      for (const [streamType, symbols] of this.pendingUnsubscribeRequests.entries()) {
        if (symbols.size === 0) continue;
        
        logger.info(`Processing batch of ${symbols.size} pending unsubscribe requests for ${streamType}`);
        
        // Convert set to array for processing
        const symbolsArray = Array.from(symbols);
        
        // Process in batches of MAX_BATCH_SIZE
        for (let i = 0; i < symbolsArray.length; i += MAX_BATCH_SIZE) {
          const batch = symbolsArray.slice(i, i + MAX_BATCH_SIZE);
          logger.info(`Processing unsubscribe batch ${Math.floor(i / MAX_BATCH_SIZE) + 1}/${Math.ceil(symbolsArray.length / MAX_BATCH_SIZE)} for ${streamType} (${batch.length} symbols)`);
          
          // Process this batch
          await this._processUnsubscribeBatch(streamType, batch);
          
          // Introduce a small delay between batches to avoid overwhelming the connection
          if (i + MAX_BATCH_SIZE < symbolsArray.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_PROCESSING.BATCH_DELAY_MS));
          }
        }
        
        // Clear processed symbols
        symbols.clear();
      }
    } catch (error) {
      logger.error('Error processing batch requests', error);
    } finally {
      this.processingBatch = false;
    }
  }
  
  /**
   * Process a batch of subscribe requests
   */
  async _processSubscribeBatch(streamType, symbols, options = {}) {
    if (symbols.length === 0) return;
    
    // Send actual subscribe requests to workers
    this._assignSymbolsToWorkers(streamType, symbols, options);
  }
  
  /**
   * Process a batch of unsubscribe requests
   */
  async _processUnsubscribeBatch(streamType, symbols) {
    if (symbols.length === 0) return;
    
    // Send actual unsubscribe requests to workers
    this.sendMessageToWorkers('unsubscribe', streamType, symbols);
  }

  /**
   * Divide symbols into groups based on SYMBOLS_PER_WORKER
   */
  _divideSymbolsIntoGroups(symbols) {
    const groups = [];
    const totalSymbols = symbols.length;
    
    for (let i = 0; i < totalSymbols; i += SYMBOLS_PER_WORKER) {
      groups.push(symbols.slice(i, i + SYMBOLS_PER_WORKER));
    }
    
    return groups;
  }

  /**
   * Create a worker for a group of symbols
   */
  _createWorker(workerId, symbols, streamTypes, isFutures) {
    return new Promise((resolve, reject) => {
      try {
        logger.info(`Creating worker ${workerId} for ${symbols.length} symbols`);
        
        // Create worker with data
        const worker = new Worker(WORKER_PATH, {
          workerData: {
            workerId,
            symbols,
            streamTypes,
            isFutures
          }
        });
        
        // Store worker
        this.workers.set(workerId, worker);
        this.workerReady.set(workerId, false);
        
        // Map symbols to this worker
        symbols.forEach(symbol => {
          this.symbolToWorker.set(symbol, workerId);
        });
        
        // Setup message handler
        worker.on('message', (message) => {
          if (message.type === 'ready') {
            logger.info(`Worker ${workerId} is ready`);
            this.workerReady.set(workerId, true);
            resolve();
          } else if (message.type === 'error') {
            logger.error(`Worker ${workerId} error: ${message.error}`);
            reject(new Error(message.error));
          }
        });
        
        // Setup error handler
        worker.on('error', (error) => {
          logger.error(`Worker ${workerId} error`, error);
          reject(error);
        });
        
        // Setup exit handler
        worker.on('exit', (code) => {
          if (code !== 0) {
            logger.error(`Worker ${workerId} exited with code ${code}`);
            this.workers.delete(workerId);
            this.workerReady.delete(workerId);
            
            // Remove symbols mapping
            symbols.forEach(symbol => {
              this.symbolToWorker.delete(symbol);
            });
            
            reject(new Error(`Worker ${workerId} exited with code ${code}`));
          } else {
            logger.info(`Worker ${workerId} exited successfully`);
            this.workers.delete(workerId);
            this.workerReady.delete(workerId);
            
            // Remove symbols mapping
            symbols.forEach(symbol => {
              this.symbolToWorker.delete(symbol);
            });
          }
        });
        
      } catch (error) {
        logger.error(`Failed to create worker ${workerId}`, error);
        reject(error);
      }
    });
  }

  /**
   * Send message to worker(s) based on symbols
   */
  sendMessageToWorkers(type, streamType, symbols, options = {}) {
    // For liquidation stream in futures mode, send to all workers
    if (streamType === 'liquidation' && this.isFutures) {
      for (const [workerId, worker] of this.workers.entries()) {
        if (this.workerReady.get(workerId)) {
          worker.postMessage({
            type,
            streamType,
            symbols: [], // Empty because liquidation is a global stream
            options
          });
          
          logger.debug(`Sent ${type} message for ${streamType} to worker ${workerId}`);
        }
      }
      return;
    }
    
    // Group symbols by worker
    const workerSymbols = new Map();
    
    symbols.forEach(symbol => {
      const workerId = this.symbolToWorker.get(symbol);
      
      if (workerId !== undefined) {
        if (!workerSymbols.has(workerId)) {
          workerSymbols.set(workerId, []);
        }
        workerSymbols.get(workerId).push(symbol);
      } else {
        logger.warn(`No worker found for symbol: ${symbol}`);
      }
    });
    
    // Send message to each worker
    for (const [workerId, workerSymbolList] of workerSymbols.entries()) {
      const worker = this.workers.get(workerId);
      
      if (worker && this.workerReady.get(workerId)) {
        worker.postMessage({
          type,
          streamType,
          symbols: workerSymbolList,
          options
        });
        
        logger.debug(`Sent ${type} message to worker ${workerId} for ${workerSymbolList.length} symbols`);
      } else {
        logger.warn(`Worker ${workerId} not ready for message`);
      }
    }
  }

  /**
   * Subscribe to a stream type for specific symbols
   * Instead of processing immediately, queue for batch processing
   */
  subscribeToStream(streamType, symbols, options = {}) {
    logger.info(`Queueing subscription to ${streamType} for ${symbols.length} symbols`);
    
    // Initialize pending requests for this stream type if needed
    if (!this.pendingSubscribeRequests.has(streamType)) {
      this.pendingSubscribeRequests.set(streamType, new Set());
    }
    
    // Add symbols to pending requests
    const pendingSymbols = this.pendingSubscribeRequests.get(streamType);
    symbols.forEach(symbol => pendingSymbols.add(symbol));
    
    // Store options for this stream type
    this.streamOptions = this.streamOptions || {};
    this.streamOptions[streamType] = options;
    
    // If it's a special case like ALL symbols, process immediately
    if (symbols.length === 1 && (symbols[0].toLowerCase() === 'all')) {
      logger.info(`Special case: Subscribing to ALL symbols for ${streamType} immediately`);
      // This will be handled by _assignSymbolsToWorkers directly
      this._assignSymbolsToWorkers(streamType, symbols, options);
      // Remove from pending since we processed it
      pendingSymbols.delete('all');
    }
  }

  /**
   * Subscribe to ALL available symbols for a specific stream type
   * This will fetch all available symbols and subscribe to them
   */
  async subscribeToAllSymbols(streamType, options = {}) {
    logger.info(`Subscribing to ALL symbols for ${streamType}`);
    
    try {
      // Get all available symbols
      let allSymbols;
      
      const isFutures = this.isFutures;
      const binanceService = new BinanceService();
      
      if (isFutures) {
        allSymbols = await binanceService.fetchFutureSymbols();
      } else {
        allSymbols = await binanceService.fetchSymbols();
      }
      
      logger.info(`Subscribing to ${allSymbols.length} symbols for ${streamType}`);
      
      // Queue subscription for batch processing
      this.subscribeToStream(streamType, allSymbols, options);
      
      return allSymbols;
    } catch (error) {
      logger.error(`Error subscribing to all symbols for ${streamType}`, error);
      return [];
    }
  }

  /**
   * Assign symbols to worker threads based on the SYMBOLS_PER_WORKER configuration
   * This is called by the batch processor
   */
  _assignSymbolsToWorkers(streamType, symbols, options = {}) {
    // Handle special case for global streams (like liquidation in futures)
    if (symbols.length === 1 && symbols[0] === '_global_') {
      this.sendMessageToWorkers('subscribe', streamType, symbols, options);
      return;
    }
    
    // Handle special case for ALL symbols
    if (symbols.length === 1 && (symbols[0].toLowerCase() === 'all')) {
      logger.info(`Subscribing to ALL symbols for ${streamType}`);
      this.subscribeToAllSymbols(streamType, options);
      return;
    }
    
    // Normal case: group symbols by workers
    const symbolGroups = [];
    const symbolsPerWorker = parseInt(process.env.SYMBOLS_PER_WORKER || '100', 10);
    
    // Divide symbols into groups
    for (let i = 0; i < symbols.length; i += symbolsPerWorker) {
      symbolGroups.push(symbols.slice(i, i + symbolsPerWorker));
    }
    
    logger.info(`Divided ${symbols.length} symbols into ${symbolGroups.length} worker groups`);
    
    // Ensure we have enough workers
    this._ensureWorkers(symbolGroups.length);
    
    // Assign symbol groups to workers
    for (let i = 0; i < symbolGroups.length; i++) {
      const workerIndex = i % this.workers.size;
      const worker = Array.from(this.workers.values())[workerIndex];
      
      // Send subscribe message to worker
      worker.postMessage({
        type: 'subscribe',
        streamType,
        symbols: symbolGroups[i],
        options
      });
      
      logger.debug(`Assigned ${symbolGroups[i].length} symbols to worker ${workerIndex}`);
    }
  }

  /**
   * Unsubscribe from stream for symbols
   * Instead of processing immediately, queue for batch processing
   */
  unsubscribeFromStream(streamType, symbols) {
    logger.info(`Queueing unsubscription from ${streamType} for ${symbols.length} symbols`);
    
    // Initialize pending requests for this stream type if needed
    if (!this.pendingUnsubscribeRequests.has(streamType)) {
      this.pendingUnsubscribeRequests.set(streamType, new Set());
    }
    
    // Add symbols to pending requests
    const pendingSymbols = this.pendingUnsubscribeRequests.get(streamType);
    symbols.forEach(symbol => pendingSymbols.add(symbol));
  }

  /**
   * Shutdown all workers
   */
  async shutdownWorkers() {
    logger.info('Shutting down all workers');
    
    // Clear batch processor
    if (this.batchProcessTimer) {
      clearInterval(this.batchProcessTimer);
      this.batchProcessTimer = null;
    }
    
    const shutdownPromises = Array.from(this.workers.entries()).map(([workerId, worker]) => {
      return new Promise((resolve) => {
        // Set up one-time exit listener
        worker.once('exit', () => {
          resolve();
        });
        
        // Send shutdown message
        worker.postMessage({ type: 'shutdown' });
      });
    });
    
    // Wait for all workers to shut down
    await Promise.all(shutdownPromises);
    
    logger.info('All workers shut down successfully');
  }

  /**
   * Ensure there are enough worker threads
   * @param {number} neededWorkers - Number of worker threads needed
   */
  _ensureWorkers(neededWorkers) {
    const currentWorkers = this.workers.size;
    
    // If we already have enough workers, do nothing
    if (currentWorkers >= neededWorkers) {
      return;
    }
    
    logger.info(`Creating ${neededWorkers - currentWorkers} additional worker threads`);
    
    // Create additional workers
    for (let i = currentWorkers; i < neededWorkers; i++) {
      this._createWorker(i, [], [], this.isFutures);
    }
  }
} 