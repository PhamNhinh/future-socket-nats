import { parentPort, workerData } from 'worker_threads';
import { BinanceService } from '../services/binanceService.js';
import { NatsService } from '../services/natsService.js';
import { NATS_SUBJECTS, STREAM_TYPES, WS_CONNECTION } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('BinanceWorker');

// Extract worker data
const { workerId, symbols, streamTypes = ['kline'], isFutures = false } = workerData;

// Store active WebSocket connections
const activeConnections = new Map();
// Store active subscriptions
const activeSubscriptions = new Map();

// Initialize NATS service
const natsService = new NatsService();

/**
 * Initialize the worker
 */
async function initialize() {
  try {
    const marketType = isFutures ? 'Futures' : 'Spot';
    logger.info(`${marketType} Worker ${workerId} starting with ${symbols.length} symbols`);
    
    // Connect to NATS
    await natsService.connect();
    
    // Subscribe to control messages
    subscribeToControlMessages();
    
    // Notify parent that worker is ready
    parentPort.postMessage({ type: 'ready', workerId });
    
    logger.info(`Worker ${workerId} initialized successfully`);
  } catch (error) {
    logger.error(`Failed to initialize worker ${workerId}`, error);
    parentPort.postMessage({ type: 'error', workerId, error: error.message });
    process.exit(1);
  }
}

/**
 * Subscribe to control messages from the main thread
 */
function subscribeToControlMessages() {
  natsService.subscribe(NATS_SUBJECTS.CONTROL, handleControlMessage);
  
  // Listen for messages from the parent thread
  parentPort.on('message', (message) => {
    logger.debug(`Received message from parent`, message);
    
    if (message.type === 'subscribe') {
      handleSubscribeRequest(message);
    } else if (message.type === 'unsubscribe') {
      handleUnsubscribeRequest(message);
    } else if (message.type === 'shutdown') {
      handleShutdown();
    }
  });
}

/**
 * Handle control messages from NATS
 */
function handleControlMessage(message) {
  logger.debug(`Received control message from NATS`, message);
  
  // Process message based on symbols managed by this worker
  if (message.symbols && message.symbols.some(symbol => symbols.includes(symbol))) {
    if (message.action === 'subscribe') {
      handleSubscribeRequest({
        type: 'subscribe',
        streamType: message.streamType,
        symbols: message.symbols.filter(symbol => symbols.includes(symbol)),
        options: message.options
      });
    } else if (message.action === 'unsubscribe') {
      handleUnsubscribeRequest({
        type: 'unsubscribe',
        streamType: message.streamType,
        symbols: message.symbols.filter(symbol => symbols.includes(symbol))
      });
    }
  }
}

/**
 * Handle subscribe request
 */
async function handleSubscribeRequest(message) {
  const { streamType, symbols: requestedSymbols, options } = message;
  
  if (!STREAM_TYPES.includes(streamType)) {
    logger.error(`Invalid stream type: ${streamType}`);
    return;
  }
  
  // Filter symbols that are managed by this worker
  const symbolsToSubscribe = requestedSymbols.filter(symbol => 
    symbols.includes(symbol.toLowerCase())
  );
  
  if (symbolsToSubscribe.length === 0) {
    logger.warn('No symbols to subscribe for this worker');
    return;
  }
  
  logger.info(`Subscribing to ${streamType} for ${symbolsToSubscribe.length} symbols`);
  
  // Create streams list
  let streams;
  if (streamType === 'liquidation' && isFutures) {
    // Liquidation stream is a single stream for all symbols
    streams = [BinanceService.getLiquidationStreamName()];
  } else {
    streams = symbolsToSubscribe.map(symbol => 
      BinanceService.getStreamName(streamType, symbol, options)
    );
  }
  
  try {
    // Check if we already have a connection for this stream type
    if (!activeConnections.has(streamType)) {
      // Create new WebSocket connection
      logger.info(`Creating new WebSocket connection for ${streamType} with ${streams.length} streams`);
      const ws = await BinanceService.createWebSocketConnection(streams, isFutures);
      
      // Setup WebSocket event handlers
      setupWebSocketHandlers(ws, streamType);
      
      // Store the connection
      activeConnections.set(streamType, ws);
      
      // Initialize subscriptions map for this stream type
      activeSubscriptions.set(streamType, new Set(symbolsToSubscribe));
      
    } else {
      // We need to modify the existing connection
      logger.info(`Updating existing ${streamType} connection for ${symbolsToSubscribe.length} new symbols`);
      
      const existingConnection = activeConnections.get(streamType);
      const existingSubscriptions = activeSubscriptions.get(streamType);
      
      // Add new symbols to the subscriptions
      symbolsToSubscribe.forEach(symbol => existingSubscriptions.add(symbol));
      
      // Create new streams list with all subscribed symbols
      let allStreams;
      if (streamType === 'liquidation' && isFutures) {
        // Liquidation stream is a single stream for all symbols
        allStreams = [BinanceService.getLiquidationStreamName()];
      } else {
        allStreams = Array.from(existingSubscriptions).map(symbol => 
          BinanceService.getStreamName(streamType, symbol, options)
        );
      }
      
      logger.info(`Recreating WebSocket connection for ${streamType} with ${allStreams.length} total streams`);
      
      try {
        // Create new WebSocket connection with all streams
        const newWs = await BinanceService.createWebSocketConnection(allStreams, isFutures);
        
        // Setup WebSocket event handlers
        setupWebSocketHandlers(newWs, streamType);
        
        // Add a delay before closing old connection to ensure new one is fully established
        logger.info(`New connection established, waiting before closing old connection for ${streamType}`);
        
        // Wait for a short time to ensure connection is fully established and ready
        await new Promise(resolve => setTimeout(resolve, WS_CONNECTION.CONNECTION_SWITCH_DELAY_MS));
        
        // Close existing connection AFTER new one is established and short delay
        logger.info(`Closing old connection for ${streamType}`);
        existingConnection.close();
        
        // Update the connection
        activeConnections.set(streamType, newWs);
      } catch (error) {
        logger.error(`Failed to update connection for ${streamType}, keeping existing connection: ${error.message}`);
        // Keep the existing connection
      }
    }
  } catch (error) {
    logger.error(`Error creating WebSocket connection for ${streamType}: ${error.message}`);
  }
}

/**
 * Handle unsubscribe request
 */
async function handleUnsubscribeRequest(message) {
  const { streamType, symbols: symbolsToUnsubscribe } = message;
  
  if (!activeConnections.has(streamType)) {
    logger.warn(`No active connection for ${streamType}`);
    return;
  }
  
  logger.info(`Unsubscribing from ${streamType} for ${symbolsToUnsubscribe.length} symbols`);
  
  const existingConnection = activeConnections.get(streamType);
  const existingSubscriptions = activeSubscriptions.get(streamType);
  
  // Remove symbols from subscriptions
  symbolsToUnsubscribe.forEach(symbol => existingSubscriptions.delete(symbol));
  
  // If no symbols left, close and remove the connection
  if (existingSubscriptions.size === 0) {
    logger.info(`No symbols left for ${streamType}, closing connection`);
    existingConnection.close();
    activeConnections.delete(streamType);
    activeSubscriptions.delete(streamType);
    return;
  }
  
  // For liquidation stream in futures, we don't need to update the connection
  // as it's a global stream for all symbols
  if (streamType === 'liquidation' && isFutures) {
    return;
  }
  
  try {
    // Create new streams list with remaining subscribed symbols
    const remainingStreams = Array.from(existingSubscriptions).map(symbol => 
      BinanceService.getStreamName(streamType, symbol)
    );
    
    logger.info(`Recreating WebSocket connection for ${streamType} with ${remainingStreams.length} remaining streams`);
    
    // Create new WebSocket connection with remaining streams
    const newWs = await BinanceService.createWebSocketConnection(remainingStreams, isFutures);
    
    // Setup WebSocket event handlers
    setupWebSocketHandlers(newWs, streamType);
    
    // Add a delay before closing old connection to ensure new one is fully established
    logger.info(`New connection established, waiting before closing old connection for ${streamType}`);
    
    // Wait for a short time to ensure connection is fully established and ready
    await new Promise(resolve => setTimeout(resolve, WS_CONNECTION.CONNECTION_SWITCH_DELAY_MS));
    
    // Close existing connection AFTER new one is established and short delay
    logger.info(`Closing old connection for ${streamType}`);
    existingConnection.close();
    
    // Update the connection
    activeConnections.set(streamType, newWs);
  } catch (error) {
    logger.error(`Failed to update connection for ${streamType} after unsubscribe, keeping existing connection: ${error.message}`);
    // Keep the existing connection
  }
}

/**
 * Setup WebSocket event handlers
 */
function setupWebSocketHandlers(ws, streamType) {
  ws.on('open', () => {
    logger.info(`WebSocket connection opened for ${streamType}`);
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Extract the data and publish to NATS
      publishToNats(streamType, message);
      
    } catch (error) {
      logger.error(`Error processing WebSocket message for ${streamType}`, error);
    }
  });
  
  ws.on('error', (error) => {
    logger.error(`WebSocket error for ${streamType}`, error);
  });
  
  ws.on('close', () => {
    logger.info(`WebSocket connection closed for ${streamType}`);
  });
}

/**
 * Publish data to NATS
 */
function publishToNats(streamType, data) {
  let subject;
  
  switch (streamType) {
    case 'kline':
      subject = NATS_SUBJECTS.KLINE;
      break;
    case 'depth':
      subject = NATS_SUBJECTS.DEPTH;
      break;
    case 'ticker':
      subject = NATS_SUBJECTS.TICKER;
      break;
    case 'markPrice':
      subject = NATS_SUBJECTS.MARK_PRICE;
      break;
    case 'liquidation':
      subject = NATS_SUBJECTS.LIQUIDATION;
      break;
    default:
      logger.error(`Unknown stream type: ${streamType}`);
      return;
  }
  
  natsService.publish(subject, data);
}

/**
 * Handle worker shutdown
 */
async function handleShutdown() {
  logger.info(`Worker ${workerId} shutting down`);
  
  // Close all WebSocket connections
  for (const [streamType, connection] of activeConnections.entries()) {
    logger.info(`Closing WebSocket connection for ${streamType}`);
    connection.close();
  }
  
  // Close NATS connection
  await natsService.close();
  
  // Notify parent that worker is shutting down
  parentPort.postMessage({ type: 'shutdown', workerId });
  
  // Exit the worker
  process.exit(0);
}

// Initialize the worker
initialize(); 