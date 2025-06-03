import { WebSocketServer, WebSocket } from 'ws';
import { NATS_SUBJECTS, MESSAGE_TYPES, STREAM_TYPES } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { BinanceService } from '../services/binanceService.js';

const logger = createLogger('WebSocketServer');

/**
 * WebSocket server to handle client connections
 */
export class WSServer {
  constructor(port, natsService, workerManager) {
    this.port = port;
    this.natsService = natsService;
    this.workerManager = workerManager;
    this.server = null;
    this.clients = new Map(); // Map<clientId, { ws, subscriptions }>
    
    // Update subscriptions structure to include options
    // Map<symbol, Map<streamType, Map<optionsKey, Set<clientId>>>>
    // optionsKey is a stringified version of options, e.g. "interval:15m" or "level:1"
    this.subscriptions = new Map();
    
    this.rawSubscriptions = new Map();
  }

  /**
   * Start the WebSocket server
   */
  start() {
    this.server = new WebSocketServer({ port: this.port });
    
    logger.info(`WebSocket server started on port ${this.port}`);
    
    // Setup server event handlers
    this.server.on('connection', this._handleConnection.bind(this));
    this.server.on('error', (error) => {
      logger.error('WebSocket server error', error);
    });
    
    // Subscribe to NATS subjects
    this._subscribeToNatsSubjects();
    
    return this.server;
  }

  /**
   * Handle a new WebSocket connection
   */
  _handleConnection(ws) {
    // Generate a unique client ID
    const clientId = this._generateClientId();
    
    logger.info(`Client connected: ${clientId}`);
    
    // Store client information
    this.clients.set(clientId, {
      ws,
      subscriptions: new Map(), // Map<streamType, Set<symbol>>
      rawSubscriptions: new Set() // Set<rawStreamName>
    });
    
    // Send welcome message
    this._sendToClient(ws, {
      type: 'connection',
      clientId,
      message: 'Connected to Future Socket NATS server'
    });
    
    // Setup client event handlers
    ws.on('message', (message) => this._handleClientMessage(clientId, message));
    
    ws.on('close', () => this._handleClientDisconnect(clientId));
    
    ws.on('error', (error) => {
      logger.error(`Client ${clientId} error`, error);
    });
  }

  /**
   * Handle a message from a client
   */
  _handleClientMessage(clientId, message) {
    try {
      const data = JSON.parse(message.toString());
      logger.debug(`Received message from client ${clientId}`, data);
      
      // Process based on message type
      switch (data.type) {
        case MESSAGE_TYPES.SUBSCRIBE:
          // Check if using raw format (like btcusdt@kline_15m)
          if (data.rawStreams && Array.isArray(data.rawStreams)) {
            this._handleRawSubscribe(clientId, data);
          } else {
            this._handleSubscribe(clientId, data);
          }
          break;
          
        case MESSAGE_TYPES.UNSUBSCRIBE:
          // Check if using raw format
          if (data.rawStreams && Array.isArray(data.rawStreams)) {
            this._handleRawUnsubscribe(clientId, data);
          } else {
            this._handleUnsubscribe(clientId, data);
          }
          break;
          
        case MESSAGE_TYPES.GET_HISTORICAL_KLINES:
          this._handleHistoricalKlinesRequest(clientId, data);
          break;
          
        default:
          logger.warn(`Unknown message type from client ${clientId}: ${data.type}`);
          this._sendErrorToClient(clientId, `Unknown message type: ${data.type}`);
      }
    } catch (error) {
      logger.error(`Error processing message from client ${clientId}`, error);
      this._sendErrorToClient(clientId, 'Invalid message format');
    }
  }

  /**
   * Handle raw subscribe request (format: btcusdt@kline_15m)
   */
  _handleRawSubscribe(clientId, data) {
    const { rawStreams } = data;
    
    if (rawStreams.length === 0) {
      this._sendErrorToClient(clientId, 'Stream list must be non-empty');
      return;
    }
    
    logger.info(`Client ${clientId} raw subscribing to ${rawStreams.length} streams`);
    
    const client = this.clients.get(clientId);
    
    // Group streams by type for worker manager
    const streamsByType = this._parseRawStreams(rawStreams);
    
    // Track which streams are newly subscribed
    const newRawStreams = [];
    
    // Update subscriptions tracking
    for (const stream of rawStreams) {
      // Add to client's raw subscriptions
      if (!client.rawSubscriptions.has(stream)) {
        client.rawSubscriptions.add(stream);
        newRawStreams.push(stream);
      }
      
      // Initialize raw subscriptions for this stream if needed
      if (!this.rawSubscriptions.has(stream)) {
        this.rawSubscriptions.set(stream, new Set());
      }
      
      // Add client to stream's subscribers
      this.rawSubscriptions.get(stream).add(clientId);
    }
    
    // Subscribe to new streams via worker manager for each stream type
    for (const [streamType, typeInfo] of Object.entries(streamsByType)) {
      if (typeInfo.symbols.length > 0) {
        this.workerManager.subscribeToStream(streamType, typeInfo.symbols, typeInfo.options);
      }
    }
    
    // Acknowledge the subscription
    this._sendToClient(client.ws, {
      type: 'subscribed',
      rawStreams
    });
  }

  /**
   * Handle raw unsubscribe request
   */
  _handleRawUnsubscribe(clientId, data) {
    const { rawStreams } = data;
    
    if (rawStreams.length === 0) {
      this._sendErrorToClient(clientId, 'Stream list must be non-empty');
      return;
    }
    
    logger.info(`Client ${clientId} raw unsubscribing from ${rawStreams.length} streams`);
    
    const client = this.clients.get(clientId);
    
    // Group streams by type for worker manager
    const streamsByType = this._parseRawStreams(rawStreams);
    
    // Track which streams need to be unsubscribed at the worker level by type
    const streamsByTypeToUnsubscribe = {};
    
    // Update subscriptions tracking
    for (const stream of rawStreams) {
      // Remove from client's raw subscriptions
      client.rawSubscriptions.delete(stream);
      
      // Check if stream exists in raw subscriptions
      if (this.rawSubscriptions.has(stream)) {
        // Remove client from stream's subscribers
        this.rawSubscriptions.get(stream).delete(clientId);
        
        // If no clients left for this stream, mark for unsubscribe
        if (this.rawSubscriptions.get(stream).size === 0) {
          // Parse stream to get type and symbol
          const parsedStream = this._parseRawStream(stream);
          if (parsedStream) {
            const { streamType, symbol } = parsedStream;
            
            if (!streamsByTypeToUnsubscribe[streamType]) {
              streamsByTypeToUnsubscribe[streamType] = [];
            }
            
            streamsByTypeToUnsubscribe[streamType].push(symbol);
          }
          
          // Remove stream from raw subscriptions
          this.rawSubscriptions.delete(stream);
        }
      }
    }
    
    // Unsubscribe from streams at the worker level by type
    for (const [streamType, symbols] of Object.entries(streamsByTypeToUnsubscribe)) {
      if (symbols.length > 0) {
        this.workerManager.unsubscribeFromStream(streamType, symbols);
      }
    }
    
    // Acknowledge the unsubscription
    this._sendToClient(client.ws, {
      type: 'unsubscribed',
      rawStreams
    });
  }

  /**
   * Parse raw streams into grouped format for worker manager
   * @param {string[]} rawStreams - Array of streams like ["btcusdt@kline_15m", "ethusdt@depth"]
   * @returns {Object} - Grouped streams by type with symbols and options
   */
  _parseRawStreams(rawStreams) {
    const result = {};
    
    for (const stream of rawStreams) {
      const parsed = this._parseRawStream(stream);
      
      if (parsed) {
        const { streamType, symbol, options } = parsed;
        
        if (!result[streamType]) {
          result[streamType] = {
            symbols: [],
            options: options || {}
          };
        }
        
        if (symbol && !result[streamType].symbols.includes(symbol)) {
          result[streamType].symbols.push(symbol);
        }
        
        // Merge options (last one wins for conflicts)
        if (options) {
          result[streamType].options = { ...result[streamType].options, ...options };
        }
      }
    }
    
    return result;
  }

  /**
   * Parse a single raw stream string
   * @param {string} stream - Stream string like "btcusdt@kline_15m"
   * @returns {Object|null} - Parsed stream info or null if invalid
   */
  _parseRawStream(stream) {
    // Handle special streams like !forceOrder@arr
    if (stream === '!forceOrder@arr') {
      return {
        streamType: 'liquidation',
        symbol: null
      };
    }
    
    const parts = stream.split('@');
    if (parts.length < 2) {
      return null;
    }
    
    const symbol = parts[0].toLowerCase();
    const typeInfo = parts[1];
    
    // Handle different stream types
    if (typeInfo.startsWith('kline_')) {
      const interval = typeInfo.substring(6); // Remove 'kline_'
      return {
        streamType: 'kline',
        symbol,
        options: { interval }
      };
    } else if (typeInfo.startsWith('depth')) {
      // Could be depth5, depth10, depth20, etc.
      const level = typeInfo.replace('depth', '') || '20';
      return {
        streamType: 'depth',
        symbol,
        options: { level }
      };
    } else if (typeInfo === 'ticker') {
      return {
        streamType: 'ticker',
        symbol
      };
    } else if (typeInfo.startsWith('markPrice')) {
      // Format could be markPrice@1s
      const parts = typeInfo.split('@');
      const updateSpeed = parts.length > 1 ? parts[1] : '1s';
      return {
        streamType: 'markPrice',
        symbol,
        options: { updateSpeed }
      };
    }
    
    // Unknown stream type
    return null;
  }

  /**
   * Handle subscribe request
   */
  _handleSubscribe(clientId, data) {
    const { streamType, symbols = [], options = {} } = data;
    
    // Validate stream type
    if (!Object.values(STREAM_TYPES).includes(streamType)) {
      this._sendErrorToClient(clientId, `Invalid stream type: ${streamType}`);
      return;
    }
    
    // Special case for global streams like liquidation
    if (symbols.length === 1 && symbols[0] === '_global_') {
      logger.info(`Client ${clientId} subscribing to global ${streamType} stream`);
      
      const client = this.clients.get(clientId);
      
      // Initialize client's subscriptions for this stream type if needed
      if (!client.subscriptions.has(streamType)) {
        client.subscriptions.set(streamType, new Set());
      }
      
      // Add special symbol to client's subscriptions
      client.subscriptions.get(streamType).add('_global_');
      
      // Initialize subscriptions for this symbol if needed
      const key = `${streamType}:_global_`;
      if (!this.subscriptions.has(key)) {
        this.subscriptions.set(key, new Set());
      }
      
      // Add client to symbol's subscribers
      this.subscriptions.get(key).add(clientId);
      
      // Subscribe via worker manager
      this.workerManager.subscribeToStream(streamType, ['_global_'], options);
      
      // Acknowledge the subscription
      this._sendToClient(client.ws, {
        type: MESSAGE_TYPES.SUBSCRIBED,
        streamType,
        symbols: ['_global_']
      });
      
      return;
    }

    // Special case for subscribing to ALL symbols
    if (symbols.length === 1 && symbols[0].toUpperCase() === 'ALL') {
      logger.info(`Client ${clientId} subscribing to ALL symbols for ${streamType}`);
      
      const client = this.clients.get(clientId);
      
      // Initialize client's subscriptions for this stream type if needed
      if (!client.subscriptions.has(streamType)) {
        client.subscriptions.set(streamType, new Set());
      }
      
      // Add special ALL symbol to client's subscriptions (using lowercase for consistency)
      client.subscriptions.get(streamType).add('all');
      
      // Initialize subscriptions for this symbol if needed
      const key = `${streamType}:all`;
      if (!this.subscriptions.has(key)) {
        this.subscriptions.set(key, new Set());
      }
      
      // Add client to symbol's subscribers
      this.subscriptions.get(key).add(clientId);
      
      // Subscribe to ALL symbols via worker manager
      logger.info(`Requesting worker manager to subscribe to ALL symbols for ${streamType}`);
      this.workerManager.subscribeToAllSymbols(streamType, options)
        .then(symbols => {
          logger.info(`Successfully subscribed to ${symbols.length} symbols for ${streamType}`);
        })
        .catch(err => {
          logger.error(`Failed to subscribe to ALL symbols: ${err.message}`);
        });
      
      // Acknowledge the subscription
      this._sendToClient(client.ws, {
        type: 'subscribed',
        streamType,
        symbols: ['ALL']
      });
      
      return;
    }
    
    // Regular symbol subscription
    if (symbols.length === 0) {
      this._sendErrorToClient(clientId, 'Symbol list must be non-empty');
      return;
    }
    
    logger.info(`Client ${clientId} subscribing to ${streamType} for ${symbols.length} symbols with options:`, options);
    
    const client = this.clients.get(clientId);
    
    // Initialize client's subscriptions if needed
    if (!client.subscriptions.has(streamType)) {
      client.subscriptions.set(streamType, new Map());
    }
    
    // Generate options key for tracking
    const optionsKey = this._generateOptionsKey(streamType, options);
    
    // Track which symbols are newly subscribed
    const newSymbols = [];
    
    // Update subscriptions tracking
    symbols.forEach(symbol => {
      const lowercaseSymbol = symbol.toLowerCase();
      
      // Initialize symbol in client's subscriptions
      const clientStreamSubs = client.subscriptions.get(streamType);
      if (!clientStreamSubs.has(lowercaseSymbol)) {
        clientStreamSubs.set(lowercaseSymbol, new Set());
      }
      clientStreamSubs.get(lowercaseSymbol).add(optionsKey);
      
      // Initialize global subscriptions tracking
      if (!this.subscriptions.has(lowercaseSymbol)) {
        this.subscriptions.set(lowercaseSymbol, new Map());
      }
      
      const symbolSubs = this.subscriptions.get(lowercaseSymbol);
      if (!symbolSubs.has(streamType)) {
        symbolSubs.set(streamType, new Map());
      }
      
      const streamTypeSubs = symbolSubs.get(streamType);
      if (!streamTypeSubs.has(optionsKey)) {
        streamTypeSubs.set(optionsKey, new Set());
        newSymbols.push(lowercaseSymbol);
      }
      
      // Add client to subscribers
      streamTypeSubs.get(optionsKey).add(clientId);
    });
    
    // Subscribe to new symbols via worker manager
    if (newSymbols.length > 0) {
      this.workerManager.subscribeToStream(streamType, newSymbols, options);
    }
    
    // Acknowledge the subscription
    this._sendToClient(client.ws, {
      type: 'subscribed',
      streamType,
      symbols,
      options
    });
  }

  /**
   * Generate a unique key for tracking options
   */
  _generateOptionsKey(streamType, options) {
    const parts = [];
    
    switch (streamType) {
      case 'kline':
        if (options.interval) parts.push(`interval:${options.interval}`);
        break;
      case 'depth':
        if (options.level) parts.push(`level:${options.level}`);
        break;
      case 'markPrice':
        if (options.updateSpeed) parts.push(`speed:${options.updateSpeed}`);
        break;
      // Add other stream types as needed
    }
    
    return parts.length > 0 ? parts.join('|') : 'default';
  }

  /**
   * Handle a client's unsubscribe request
   */
  _handleUnsubscribe(clientId, data) {
    const { streamType, symbols, options = {} } = data;
    
    // Validate inputs
    if (!this._validateUnsubscribeInput(clientId, streamType, symbols)) {
      return;
    }
    
    logger.info(`Client ${clientId} unsubscribing from ${streamType} for ${symbols.length} symbols`);
    
    const client = this.clients.get(clientId);
    const clientStreamSubs = client.subscriptions.get(streamType);
    const optionsKey = this._generateOptionsKey(streamType, options);
    
    // Process unsubscriptions and collect symbols that need worker updates
    const symbolsToUnsubscribe = this._processUnsubscriptions(
      symbols, 
      clientId,
      streamType,
      clientStreamSubs,
      optionsKey
    );
    
    // Update worker subscriptions if needed
    if (symbolsToUnsubscribe.length > 0) {
      this.workerManager.unsubscribeFromStream(streamType, symbolsToUnsubscribe, options);
    }
    
    this._sendToClient(client.ws, {
      type: 'unsubscribed',
      streamType,
      symbols,
      options
    });
  }

  /**
   * Validate unsubscribe request inputs
   */
  _validateUnsubscribeInput(clientId, streamType, symbols) {
    if (!Object.values(STREAM_TYPES).includes(streamType)) {
      this._sendErrorToClient(clientId, `Invalid stream type: ${streamType}`);
      return false;
    }
    
    if (!Array.isArray(symbols) || symbols.length === 0) {
      this._sendErrorToClient(clientId, 'Symbols must be a non-empty array');
      return false;
    }
    
    const client = this.clients.get(clientId);
    if (!client.subscriptions.has(streamType)) {
      this._sendErrorToClient(clientId, `Not subscribed to stream type: ${streamType}`);
      return false;
    }
    
    return true;
  }

  /**
   * Process unsubscriptions and return symbols needing worker updates
   */
  _processUnsubscriptions(symbols, clientId, streamType, clientStreamSubs, optionsKey) {
    const symbolsToUnsubscribe = new Set();

    symbols.forEach(symbol => {
      const lowercaseSymbol = symbol.toLowerCase();
      
      // Remove from client's subscriptions
      this._removeClientSubscription(clientStreamSubs, lowercaseSymbol, optionsKey);
      
      // Update global subscriptions and check if worker update needed
      if (this._removeGlobalSubscription(lowercaseSymbol, streamType, clientId, optionsKey)) {
        symbolsToUnsubscribe.add(lowercaseSymbol);
      }
    });

    return Array.from(symbolsToUnsubscribe);
  }

  /**
   * Remove subscription from client's tracking
   */
  _removeClientSubscription(clientStreamSubs, symbol, optionsKey) {
    if (!clientStreamSubs.has(symbol)) return;
    
    const optionSets = clientStreamSubs.get(symbol);
    optionSets.delete(optionsKey);
    
    if (optionSets.size === 0) {
      clientStreamSubs.delete(symbol);
    }
  }

  /**
   * Remove subscription from global tracking
   * Returns true if worker update needed
   */
  _removeGlobalSubscription(symbol, streamType, clientId, optionsKey) {
    if (!this.subscriptions.has(symbol)) return false;
    
    const symbolSubs = this.subscriptions.get(symbol);
    if (!symbolSubs.has(streamType)) return false;
    
    const streamTypeSubs = symbolSubs.get(streamType);
    if (!streamTypeSubs.has(optionsKey)) return false;
    
    const subscribers = streamTypeSubs.get(optionsKey);
    subscribers.delete(clientId);
    
    if (subscribers.size === 0) {
      streamTypeSubs.delete(optionsKey);
      
      if (streamTypeSubs.size === 0) {
        symbolSubs.delete(streamType);
        if (symbolSubs.size === 0) {
          this.subscriptions.delete(symbol);
        }
        return true;
      }
    }
    
    return false;
  }

  /**
   * Handle a client disconnection
   */
  _handleClientDisconnect(clientId) {
    logger.info(`Client disconnected: ${clientId}`);
    
    const client = this.clients.get(clientId);
    if (!client) return;

    // Process standard subscriptions
    this._cleanupClientSubscriptions(client, clientId);
    
    // Process raw subscriptions
    this._cleanupRawSubscriptions(client, clientId);
    
    // Remove client
    this.clients.delete(clientId);
  }

  /**
   * Clean up client's standard subscriptions
   */
  _cleanupClientSubscriptions(client, clientId) {
    // Group unsubscriptions by stream type and options
    const unsubscribeGroups = new Map(); // Map<streamType, Map<optionsKey, Set<symbol>>>

    for (const [streamType, symbolMap] of client.subscriptions.entries()) {
      for (const [symbol, optionSets] of symbolMap.entries()) {
        for (const optionsKey of optionSets) {
          if (this._removeGlobalSubscription(symbol, streamType, clientId, optionsKey)) {
            // Add to unsubscribe group
            if (!unsubscribeGroups.has(streamType)) {
              unsubscribeGroups.set(streamType, new Map());
            }
            const streamGroup = unsubscribeGroups.get(streamType);
            if (!streamGroup.has(optionsKey)) {
              streamGroup.set(optionsKey, new Set());
            }
            streamGroup.get(optionsKey).add(symbol);
          }
        }
      }
    }

    // Process unsubscribe groups
    for (const [streamType, optionsMap] of unsubscribeGroups.entries()) {
      for (const [optionsKey, symbols] of optionsMap.entries()) {
        if (symbols.size > 0) {
          const options = this._parseOptionsFromKey(optionsKey);
          this.workerManager.unsubscribeFromStream(streamType, Array.from(symbols), options);
        }
      }
    }
  }

  /**
   * Clean up client's raw subscriptions
   */
  _cleanupRawSubscriptions(client, clientId) {
    if (client.rawSubscriptions.size === 0) return;
    
    const unsubscribeByType = new Map(); // Map<streamType, Set<symbol>>
    
    for (const stream of client.rawSubscriptions) {
      if (!this.rawSubscriptions.has(stream)) continue;
      
      const subscribers = this.rawSubscriptions.get(stream);
      subscribers.delete(clientId);
      
      if (subscribers.size === 0) {
        const parsed = this._parseRawStream(stream);
        if (!parsed) continue;
        
        const { streamType, symbol } = parsed;
        if (!unsubscribeByType.has(streamType)) {
          unsubscribeByType.set(streamType, new Set());
        }
        if (symbol) {
          unsubscribeByType.get(streamType).add(symbol);
        }
        
        this.rawSubscriptions.delete(stream);
      }
    }
    
    // Process unsubscriptions by stream type
    for (const [streamType, symbols] of unsubscribeByType.entries()) {
      if (symbols.size > 0) {
        this.workerManager.unsubscribeFromStream(streamType, Array.from(symbols));
      }
    }
  }

  /**
   * Subscribe to NATS subjects
   */
  _subscribeToNatsSubjects() {
    // Subscribe to kline data
    this.natsService.subscribe(NATS_SUBJECTS.KLINE, (data) => {
      this._handleMarketData('kline', data);
    });
    
    // Subscribe to depth data
    this.natsService.subscribe(NATS_SUBJECTS.DEPTH, (data) => {
      this._handleMarketData('depth', data);
    });
    
    // Subscribe to ticker data
    this.natsService.subscribe(NATS_SUBJECTS.TICKER, (data) => {
      this._handleMarketData('ticker', data);
    });
    
    // Subscribe to mark price data
    this.natsService.subscribe(NATS_SUBJECTS.MARK_PRICE, (data) => {
      this._handleMarketData('markPrice', data);
    });
    
    // Subscribe to liquidation data
    this.natsService.subscribe(NATS_SUBJECTS.LIQUIDATION, (data) => {
      this._handleMarketData('liquidation', data);
    });
  }

  /**
   * Handle market data from NATS
   */
  _handleMarketData(streamType, data) {
    // Extract symbol from data
    let symbol = '';
    
    try {
      if (data.s) {
        symbol = data.s.toLowerCase();
      } else if (data.data && data.data.s) {
        symbol = data.data.s.toLowerCase();
      } else if (data.stream) {
        // Extract symbol from stream name (e.g., btcusdt@kline_1m)
        const parts = data.stream.split('@');
        symbol = parts[0].toLowerCase();
      } else if (streamType === 'liquidation' && data.data && data.data.o && data.data.o.s) {
        // Liquidation data
        symbol = data.data.o.s.toLowerCase();
      } else {
        logger.warn('Could not extract symbol from data');
        return;
      }
      
      // Extract options from data
      const options = this._parseOptions(streamType, data);
      const optionsKey = this._generateOptionsKey(streamType, options);
      
      // Check subscriptions and send to relevant clients
      if (this.subscriptions.has(symbol)) {
        const symbolSubs = this.subscriptions.get(symbol);
        if (symbolSubs.has(streamType)) {
          const streamTypeSubs = symbolSubs.get(streamType);
          
          // Send to clients subscribed with matching options
          if (streamTypeSubs.has(optionsKey)) {
            const clients = streamTypeSubs.get(optionsKey);
            for (const clientId of clients) {
              const client = this.clients.get(clientId);
              if (client?.ws?.readyState === WebSocket.OPEN) {
                this._sendToClient(client.ws, {
                  type: streamType,
                  data
                });
              }
            }
          }
        }
      }
      
      // Send to clients subscribed to ALL symbols
      const allKey = `${streamType}:all`;
      
      if (this.subscriptions.has(allKey)) {
        const clients = this.subscriptions.get(allKey);
        logger.debug(`Sending ${streamType} data for ${symbol} to ${clients.size} clients subscribed to ALL symbols`);
        
        for (const clientId of clients) {
          const client = this.clients.get(clientId);
          
          if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
            this._sendToClient(client.ws, {
              type: streamType,
              data
            });
          }
        }
      }
      
      // Send to clients with raw subscriptions
      // Check if any clients are subscribed to the raw stream
      if (data.stream) {
        const rawStream = data.stream;
        
        if (this.rawSubscriptions.has(rawStream)) {
          const clients = this.rawSubscriptions.get(rawStream);
          
          for (const clientId of clients) {
            const client = this.clients.get(clientId);
            
            if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
              this._sendToClient(client.ws, {
                stream: rawStream,
                data
              });
            }
          }
        }
      }
      
      // For liquidation events, send to clients subscribed to the global liquidation stream
      if (streamType === 'liquidation') {
        const globalKey = `liquidation:_global_`;
        
        if (this.subscriptions.has(globalKey)) {
          const clients = this.subscriptions.get(globalKey);
          
          for (const clientId of clients) {
            const client = this.clients.get(clientId);
            
            if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
              this._sendToClient(client.ws, {
                type: 'liquidation',
                data
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error handling market data for ${streamType}`, error);
    }
  }

  /**
   * Send data to a client
   */
  _sendToClient(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch (error) {
      logger.error('Error sending data to client', error);
    }
  }

  /**
   * Send error message to a client
   */
  _sendErrorToClient(clientId, message) {
    const client = this.clients.get(clientId);
    
    if (client && client.ws.readyState === 1) { // 1 = OPEN
      this._sendToClient(client.ws, {
        type: MESSAGE_TYPES.ERROR,
        message
      });
    }
  }

  /**
   * Generate a unique client ID
   */
  _generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Stop the WebSocket server
   */
  stop() {
    if (this.server) {
      logger.info('Stopping WebSocket server');
      
      // Close all client connections
      for (const [clientId, client] of this.clients.entries()) {
        client.ws.close();
      }
      
      // Clear subscriptions
      this.clients.clear();
      this.subscriptions.clear();
      this.rawSubscriptions.clear();
      
      // Close server
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Handle request for historical klines data
   */
  async _handleHistoricalKlinesRequest(clientId, data) {
    const { symbol, interval, limit, startTime, endTime, isFutures } = data;
    
    // Validate required parameters
    if (!symbol) {
      this._sendErrorToClient(clientId, 'Symbol is required');
      return;
    }
    
    if (!interval) {
      this._sendErrorToClient(clientId, 'Interval is required');
      return;
    }
    
    logger.info(`Client ${clientId} requesting historical klines for ${symbol} (${interval})`);
    
    const client = this.clients.get(clientId);
    
    try {
      // Create a BinanceService instance to fetch historical data
      const binanceService = new BinanceService();
      
      // Enforce lower limit to reduce load
      const actualLimit = Math.min(limit || 1000, 1000);
      
      // Fetch historical data
      const klines = await binanceService.fetchHistoricalKlines(
        symbol, 
        interval, 
        actualLimit, 
        startTime, 
        endTime, 
        isFutures
      );
      
      // Send response to client
      this._sendToClient(client.ws, {
        type: MESSAGE_TYPES.HISTORICAL_KLINES,
        symbol,
        interval,
        klines
      });
      
      logger.info(`Sent ${klines.length} historical klines to client ${clientId}`);
    } catch (error) {
      logger.error(`Error fetching historical klines for client ${clientId}`, error);
      this._sendErrorToClient(clientId, `Failed to fetch historical klines: ${error.message}`);
    }
  }

  _parseOptions(streamType, data) {
    switch (streamType) {
      case 'kline':
        return { interval: data.data.k.i }; 
      case 'depth':
        return { level: data.level };
      case 'markPrice':
        return { updateSpeed: data.updateSpeed };
      case 'liquidation':
        return {};
        
    }
  }

  /**
   * Parse options from an options key
   * @private
   */
  _parseOptionsFromKey(optionsKey) {
    if (optionsKey === 'default') return {};
    
    const options = {};
    const parts = optionsKey.split('|');
    
    parts.forEach(part => {
      const [key, value] = part.split(':');
      switch (key) {
        case 'interval':
          options.interval = value;
          break;
        case 'level':
          options.level = parseInt(value);
          break;
        case 'speed':
          options.updateSpeed = value;
          break;
      }
    });
    
    return options;
  }
} 