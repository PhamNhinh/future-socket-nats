import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { SYMBOLS_PER_WORKER } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WorkerManager');

// Get the current directory path
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Path to worker script
const WORKER_PATH = path.resolve(__dirname, '../workers/binanceWorker.js');

/**
 * Manages worker threads for processing Binance data
 */
export class WorkerManager {
  constructor() {
    this.workers = new Map();
    this.workerReady = new Map();
    this.symbolToWorker = new Map();
    this.isFutures = false;
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
   * Subscribe to stream for symbols
   */
  subscribeToStream(streamType, symbols, options = {}) {
    this.sendMessageToWorkers('subscribe', streamType, symbols, options);
  }

  /**
   * Unsubscribe from stream for symbols
   */
  unsubscribeFromStream(streamType, symbols) {
    this.sendMessageToWorkers('unsubscribe', streamType, symbols);
  }

  /**
   * Shutdown all workers
   */
  async shutdownWorkers() {
    logger.info('Shutting down all workers');
    
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
} 