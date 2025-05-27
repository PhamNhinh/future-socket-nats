import { WebSocketServer } from 'ws';
import { NATS_SUBJECTS, MESSAGE_TYPES, STREAM_TYPES } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

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
    this.subscriptions = new Map(); // Map<symbol, Set<clientId>>
    this.rawSubscriptions = new Map(); // Map<rawStreamName, Set<clientId>>
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
   * Handle a client's subscription request
   */
  _handleSubscribe(clientId, data) {
    const { streamType, symbols, options } = data;
    
    // Validate stream type
    if (!STREAM_TYPES.includes(streamType)) {
      this._sendErrorToClient(clientId, `Invalid stream type: ${streamType}`);
      return;
    }
    
    // Validate symbols
    if (!Array.isArray(symbols) || symbols.length === 0) {
      this._sendErrorToClient(clientId, 'Symbols must be a non-empty array');
      return;
    }
    
    logger.info(`Client ${clientId} subscribing to ${streamType} for ${symbols.length} symbols`);
    
    const client = this.clients.get(clientId);
    
    // Initialize client's subscriptions for this stream type if needed
    if (!client.subscriptions.has(streamType)) {
      client.subscriptions.set(streamType, new Set());
    }
    
    const clientStreamSubscriptions = client.subscriptions.get(streamType);
    
    // Track which symbols are newly subscribed
    const newSymbols = [];
    
    // Update subscriptions tracking
    symbols.forEach(symbol => {
      const lowercaseSymbol = symbol.toLowerCase();
      
      // Add to client's subscriptions
      if (!clientStreamSubscriptions.has(lowercaseSymbol)) {
        clientStreamSubscriptions.add(lowercaseSymbol);
        newSymbols.push(lowercaseSymbol);
      }
      
      // Initialize symbol subscriptions if needed
      if (!this.subscriptions.has(lowercaseSymbol)) {
        this.subscriptions.set(lowercaseSymbol, new Map());
      }
      
      const symbolSubscriptions = this.subscriptions.get(lowercaseSymbol);
      
      // Initialize stream type for this symbol if needed
      if (!symbolSubscriptions.has(streamType)) {
        symbolSubscriptions.set(streamType, new Set());
      }
      
      // Add client to symbol's subscribers
      symbolSubscriptions.get(streamType).add(clientId);
    });
    
    // Subscribe to new symbols via worker manager
    if (newSymbols.length > 0) {
      this.workerManager.subscribeToStream(streamType, newSymbols, options);
    }
    
    // Acknowledge the subscription
    this._sendToClient(client.ws, {
      type: 'subscribed',
      streamType,
      symbols
    });
  }

  /**
   * Handle a client's unsubscribe request
   */
  _handleUnsubscribe(clientId, data) {
    const { streamType, symbols } = data;
    
    // Validate stream type
    if (!STREAM_TYPES.includes(streamType)) {
      this._sendErrorToClient(clientId, `Invalid stream type: ${streamType}`);
      return;
    }
    
    // Validate symbols
    if (!Array.isArray(symbols) || symbols.length === 0) {
      this._sendErrorToClient(clientId, 'Symbols must be a non-empty array');
      return;
    }
    
    logger.info(`Client ${clientId} unsubscribing from ${streamType} for ${symbols.length} symbols`);
    
    const client = this.clients.get(clientId);
    
    // Check if client is subscribed to this stream type
    if (!client.subscriptions.has(streamType)) {
      this._sendErrorToClient(clientId, `Not subscribed to stream type: ${streamType}`);
      return;
    }
    
    const clientStreamSubscriptions = client.subscriptions.get(streamType);
    
    // Track which symbols need to be unsubscribed at the worker level
    const symbolsToUnsubscribe = [];
    
    // Update subscriptions tracking
    symbols.forEach(symbol => {
      const lowercaseSymbol = symbol.toLowerCase();
      
      // Remove from client's subscriptions
      clientStreamSubscriptions.delete(lowercaseSymbol);
      
      // Check if symbol exists in subscriptions
      if (this.subscriptions.has(lowercaseSymbol)) {
        const symbolSubscriptions = this.subscriptions.get(lowercaseSymbol);
        
        // Check if stream type exists for this symbol
        if (symbolSubscriptions.has(streamType)) {
          // Remove client from symbol's subscribers
          symbolSubscriptions.get(streamType).delete(clientId);
          
          // If no clients left for this stream type, mark for unsubscribe
          if (symbolSubscriptions.get(streamType).size === 0) {
            symbolsToUnsubscribe.push(lowercaseSymbol);
            symbolSubscriptions.delete(streamType);
          }
          
          // If no stream types left for this symbol, remove symbol
          if (symbolSubscriptions.size === 0) {
            this.subscriptions.delete(lowercaseSymbol);
          }
        }
      }
    });
    
    // Unsubscribe from symbols at the worker level
    if (symbolsToUnsubscribe.length > 0) {
      this.workerManager.unsubscribeFromStream(streamType, symbolsToUnsubscribe);
    }
    
    // Acknowledge the unsubscription
    this._sendToClient(client.ws, {
      type: 'unsubscribed',
      streamType,
      symbols
    });
  }

  /**
   * Handle a client disconnection
   */
  _handleClientDisconnect(clientId) {
    logger.info(`Client disconnected: ${clientId}`);
    
    const client = this.clients.get(clientId);
    
    if (!client) {
      return;
    }
    
    // Handle standard subscriptions
    for (const [streamType, symbols] of client.subscriptions.entries()) {
      // Track which symbols need to be unsubscribed at the worker level
      const symbolsToUnsubscribe = [];
      
      // For each symbol in this stream type
      for (const symbol of symbols) {
        // Check if symbol exists in subscriptions
        if (this.subscriptions.has(symbol)) {
          const symbolSubscriptions = this.subscriptions.get(symbol);
          
          // Check if stream type exists for this symbol
          if (symbolSubscriptions.has(streamType)) {
            // Remove client from symbol's subscribers
            symbolSubscriptions.get(streamType).delete(clientId);
            
            // If no clients left for this stream type, mark for unsubscribe
            if (symbolSubscriptions.get(streamType).size === 0) {
              symbolsToUnsubscribe.push(symbol);
              symbolSubscriptions.delete(streamType);
            }
            
            // If no stream types left for this symbol, remove symbol
            if (symbolSubscriptions.size === 0) {
              this.subscriptions.delete(symbol);
            }
          }
        }
      }
      
      // Unsubscribe from symbols at the worker level
      if (symbolsToUnsubscribe.length > 0) {
        this.workerManager.unsubscribeFromStream(streamType, symbolsToUnsubscribe);
      }
    }
    
    // Handle raw subscriptions
    if (client.rawSubscriptions.size > 0) {
      const rawStreamsToUnsubscribe = new Map(); // Map<streamType, symbol[]>
      
      for (const stream of client.rawSubscriptions) {
        if (this.rawSubscriptions.has(stream)) {
          // Remove client from raw stream's subscribers
          this.rawSubscriptions.get(stream).delete(clientId);
          
          // If no clients left for this stream, unsubscribe
          if (this.rawSubscriptions.get(stream).size === 0) {
            const parsedStream = this._parseRawStream(stream);
            if (parsedStream) {
              const { streamType, symbol } = parsedStream;
              
              if (!rawStreamsToUnsubscribe.has(streamType)) {
                rawStreamsToUnsubscribe.set(streamType, []);
              }
              
              if (symbol) {
                rawStreamsToUnsubscribe.get(streamType).push(symbol);
              }
            }
            
            // Remove stream from raw subscriptions
            this.rawSubscriptions.delete(stream);
          }
        }
      }
      
      // Unsubscribe from raw streams at the worker level
      for (const [streamType, symbols] of rawStreamsToUnsubscribe.entries()) {
        if (symbols.length > 0) {
          this.workerManager.unsubscribeFromStream(streamType, symbols);
        }
      }
    }
    
    // Remove client
    this.clients.delete(clientId);
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
    let symbol;
    let rawStream;
    
    if (data.stream) {
      // Raw stream format (e.g., "btcusdt@kline_1m")
      rawStream = data.stream;
      
      // Extract symbol from stream field (e.g., "btcusdt@kline_1m")
      const parts = data.stream.split('@');
      symbol = parts[0];
    } else if (data.s) {
      // Extract from symbol field (e.g., data.s = "BTCUSDT")
      symbol = data.s.toLowerCase();
      
      // Create raw stream name
      if (streamType === 'kline' && data.k && data.k.i) {
        rawStream = `${symbol}@kline_${data.k.i}`;
      } else if (streamType === 'depth') {
        rawStream = `${symbol}@depth`;
      } else if (streamType === 'ticker') {
        rawStream = `${symbol}@ticker`;
      } else if (streamType === 'markPrice') {
        rawStream = `${symbol}@markPrice`;
      }
    } else if (streamType === 'liquidation') {
      rawStream = '!forceOrder@arr';
      // For liquidation events, get symbol from the order
      if (data.data && data.data.o && data.data.o.s) {
        symbol = data.data.o.s.toLowerCase();
      }
    }
    
    if (!symbol && !rawStream) {
      logger.warn(`Cannot extract symbol from ${streamType} data`);
      return;
    }
    
    // Handle raw stream subscriptions
    if (rawStream && this.rawSubscriptions.has(rawStream)) {
      const subscribers = this.rawSubscriptions.get(rawStream);
      
      // Send data to all subscribed clients
      for (const clientId of subscribers) {
        const client = this.clients.get(clientId);
        
        if (client && client.ws.readyState === 1) { // 1 = OPEN
          this._sendToClient(client.ws, {
            type: streamType,
            stream: rawStream,
            data
          });
        }
      }
    }
    
    // Handle regular subscriptions
    if (symbol) {
      // Check if any clients are subscribed to this symbol and stream type
      if (this.subscriptions.has(symbol) && 
          this.subscriptions.get(symbol).has(streamType)) {
        
        const subscribers = this.subscriptions.get(symbol).get(streamType);
        
        // Send data to all subscribed clients
        for (const clientId of subscribers) {
          const client = this.clients.get(clientId);
          
          if (client && client.ws.readyState === 1) { // 1 = OPEN
            this._sendToClient(client.ws, {
              type: streamType,
              data
            });
          }
        }
      }
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
} 