import WebSocket from 'ws';
import readline from 'readline';

// Configuration
const WS_URL = 'ws://localhost:8081';
const DEFAULT_SYMBOLS = ['btcusdt', 'ethusdt', 'bnbusdt', 'solusdt', 'dogeusdt'];
const DEFAULT_STREAM_TYPE = 'kline';

// Stream types
const STREAM_TYPES = {
  SPOT: ['kline', 'depth', 'ticker'],
  FUTURES: ['kline', 'depth', 'ticker', 'markPrice', 'liquidation']
};

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// WebSocket client
let ws;
let clientId;
let subscribedSymbols = [];
let subscribedRawStreams = [];
let currentStreamType = DEFAULT_STREAM_TYPE;
let isFutures = false;
let availableStreamTypes = STREAM_TYPES.SPOT;

/**
 * Connect to the WebSocket server
 */
function connect() {
  console.log(`Connecting to ${WS_URL}...`);
  
  ws = new WebSocket(WS_URL);
  
  // Setup WebSocket event handlers
  ws.on('open', () => {
    console.log('Connected to WebSocket server');
    promptMarketType();
  });
  
  ws.on('message', (data) => {
    handleMessage(JSON.parse(data.toString()));
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
  
  ws.on('close', () => {
    console.log('Connection to server closed');
    process.exit(0);
  });
}

/**
 * Ask user which market type to use
 */
function promptMarketType() {
  console.log('\n--- Select Market Type ---');
  console.log('1. Spot Market');
  console.log('2. Futures Market');
  console.log('-----------------------');
  
  rl.question('Select an option: ', (answer) => {
    switch (answer) {
      case '1':
        isFutures = false;
        availableStreamTypes = STREAM_TYPES.SPOT;
        console.log('Using Spot Market');
        showMenu();
        break;
        
      case '2':
        isFutures = true;
        availableStreamTypes = STREAM_TYPES.FUTURES;
        console.log('Using Futures Market');
        showMenu();
        break;
        
      default:
        console.log('Invalid option');
        promptMarketType();
    }
  });
}

/**
 * Handle messages from the server
 */
function handleMessage(message) {
  switch (message.type) {
    case 'connection':
      clientId = message.clientId;
      console.log(`Connected with client ID: ${clientId}`);
      break;
      
    case 'subscribed':
      if (message.rawStreams) {
        console.log(`Subscribed to raw streams: ${message.rawStreams.join(', ')}`);
        subscribedRawStreams = [...new Set([...subscribedRawStreams, ...message.rawStreams])];
      } else if (message.streamType && message.symbols) {
        console.log(`Subscribed to ${message.streamType} for symbols: ${message.symbols.join(', ')}`);
        subscribedSymbols = [...new Set([...subscribedSymbols, ...message.symbols])];
      }
      break;
      
    case 'unsubscribed':
      if (message.rawStreams) {
        console.log(`Unsubscribed from raw streams: ${message.rawStreams.join(', ')}`);
        subscribedRawStreams = subscribedRawStreams.filter(stream => !message.rawStreams.includes(stream));
      } else if (message.streamType && message.symbols) {
        console.log(`Unsubscribed from ${message.streamType} for symbols: ${message.symbols.join(', ')}`);
        subscribedSymbols = subscribedSymbols.filter(symbol => !message.symbols.includes(symbol));
      }
      break;
      
    case 'error':
      console.error(`Error from server: ${message.message}`);
      break;
      
    case 'kline':
    case 'depth':
    case 'ticker':
    case 'markPrice':
    case 'liquidation':
      // Print a summary of the data to avoid flooding the console
      const data = message.data;
      let symbol, info;
      
      // If message has stream property, it's raw stream data
      if (message.stream) {
        console.log(`[${message.stream}] Received data`);
        
        // Parse symbol from stream
        const parts = message.stream.split('@');
        symbol = parts[0].toUpperCase();
      } else if (data.stream) {
        const parts = data.stream.split('@');
        symbol = parts[0].toUpperCase();
      } else if (data.s) {
        symbol = data.s;
      } else if (message.type === 'liquidation' && data.data && data.data.o) {
        symbol = data.data.o.s;
      } else {
        symbol = 'Unknown';
      }
      
      if (message.type === 'kline' && data.data && data.data.k) {
        const k = data.data.k;
        info = `Open: ${k.o}, Close: ${k.c}, High: ${k.h}, Low: ${k.l}, Volume: ${k.v}`;
      } else if (message.type === 'ticker' && data.data) {
        const t = data.data;
        info = `Price: ${t.c}, 24h Change: ${t.p} (${t.P}%), Volume: ${t.v}`;
      } else if (message.type === 'depth') {
        info = 'Order book update';
      } else if (message.type === 'markPrice' && data.data) {
        const mp = data.data;
        info = `Mark Price: ${mp.p}, Index Price: ${mp.i}, Funding Rate: ${mp.r}`;
      } else if (message.type === 'liquidation' && data.data) {
        const liq = data.data;
        info = `Side: ${liq.o.S}, Quantity: ${liq.o.q}, Price: ${liq.o.p}`;
      } else {
        info = 'Data received';
      }
      
      // Only print detailed info if no stream property (not raw stream)
      if (!message.stream) {
        console.log(`[${message.type}] ${symbol}: ${info}`);
      }
      break;
      
    default:
      console.log('Received message:', message);
  }
}

/**
 * Show the main menu
 */
function showMenu() {
  console.log('\n--- Menu ---');
  console.log('1. Subscribe to symbols');
  console.log('2. Unsubscribe from symbols');
  console.log('3. Change stream type');
  console.log('4. Show current subscriptions');
  console.log('5. Change market type');
  console.log('6. Subscribe to raw streams');
  console.log('7. Unsubscribe from raw streams');
  console.log('8. Exit');
  console.log('-----------');
  
  rl.question('Select an option: ', (answer) => {
    switch (answer) {
      case '1':
        handleSubscribe();
        break;
        
      case '2':
        handleUnsubscribe();
        break;
        
      case '3':
        handleChangeStreamType();
        break;
        
      case '4':
        showSubscriptions();
        break;
        
      case '5':
        promptMarketType();
        break;
        
      case '6':
        handleRawSubscribe();
        break;
        
      case '7':
        handleRawUnsubscribe();
        break;
        
      case '8':
        console.log('Exiting...');
        ws.close();
        rl.close();
        break;
        
      default:
        console.log('Invalid option');
        showMenu();
    }
  });
}

/**
 * Handle subscribing to raw streams
 */
function handleRawSubscribe() {
  console.log('Enter raw streams to subscribe (comma-separated)');
  console.log('Examples: btcusdt@kline_15m, ethusdt@depth20, bnbusdt@ticker');
  console.log('Or enter "examples" to see more examples');
  
  rl.question('Raw streams: ', (answer) => {
    if (answer.trim().toLowerCase() === 'examples') {
      showStreamExamples();
      return;
    }
    
    if (!answer.trim()) {
      showMenu();
      return;
    }
    
    const rawStreams = answer.split(',').map(s => s.trim().toLowerCase());
    
    // Send subscription request
    ws.send(JSON.stringify({
      type: 'subscribe',
      rawStreams
    }));
    
    showMenu();
  });
}

/**
 * Show examples of stream formats
 */
function showStreamExamples() {
  console.log('\n--- Stream Format Examples ---');
  console.log('Kline (Candlestick): symbol@kline_interval');
  console.log('  Examples: btcusdt@kline_1m, ethusdt@kline_15m, bnbusdt@kline_1h');
  console.log('  Intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M');
  
  console.log('\nDepth (Order Book): symbol@depth or symbol@depthN');
  console.log('  Examples: btcusdt@depth, ethusdt@depth20, bnbusdt@depth5');
  console.log('  Levels: 5, 10, 20 (default is 20)');
  
  console.log('\nTicker: symbol@ticker');
  console.log('  Example: btcusdt@ticker');
  
  if (isFutures) {
    console.log('\nMark Price (Futures only): symbol@markPrice');
    console.log('  Example: btcusdt@markPrice');
    
    console.log('\nLiquidation (Futures only): !forceOrder@arr');
    console.log('  Example: !forceOrder@arr (for all symbols)');
  }
  
  rl.question('\nPress Enter to continue...', () => {
    handleRawSubscribe();
  });
}

/**
 * Handle unsubscribing from raw streams
 */
function handleRawUnsubscribe() {
  if (subscribedRawStreams.length === 0) {
    console.log('No active raw stream subscriptions');
    showMenu();
    return;
  }
  
  console.log(`Currently subscribed to raw streams: ${subscribedRawStreams.join(', ')}`);
  
  rl.question('Enter raw streams to unsubscribe (comma-separated, or "all" for all): ', (answer) => {
    if (!answer.trim()) {
      showMenu();
      return;
    }
    
    let rawStreams = answer.toLowerCase() === 'all' 
      ? [...subscribedRawStreams] 
      : answer.split(',').map(s => s.trim().toLowerCase());
    
    // Send unsubscription request
    ws.send(JSON.stringify({
      type: 'unsubscribe',
      rawStreams
    }));
    
    showMenu();
  });
}

/**
 * Handle subscribing to symbols
 */
function handleSubscribe() {
  console.log(`Current stream type: ${currentStreamType}`);
  
  // For liquidation stream, we don't need symbols
  if (currentStreamType === 'liquidation') {
    console.log('Liquidation stream doesn\'t require specific symbols.');
    
    // Send subscription request
    ws.send(JSON.stringify({
      type: 'subscribe',
      streamType: currentStreamType,
      symbols: ['_global_'], // Special value for global streams
      options: {}
    }));
    
    showMenu();
    return;
  }
  
  rl.question('Enter symbols to subscribe (comma-separated, or press enter for defaults): ', (answer) => {
    let symbols = answer.trim() ? answer.split(',').map(s => s.trim().toLowerCase()) : DEFAULT_SYMBOLS;
    
    let options = {};
    if (currentStreamType === 'kline') {
      rl.question('Enter interval (1m, 5m, 15m, 1h, etc.) [default: 1m]: ', (interval) => {
        options = { interval: interval.trim() || '1m' };
        
        // Send subscription request
        ws.send(JSON.stringify({
          type: 'subscribe',
          streamType: currentStreamType,
          symbols,
          options
        }));
        
        showMenu();
      });
    } else if (currentStreamType === 'depth') {
      rl.question('Enter depth level (5, 10, 20) [default: 20]: ', (level) => {
        options = { level: level.trim() || '20' };
        
        // Send subscription request
        ws.send(JSON.stringify({
          type: 'subscribe',
          streamType: currentStreamType,
          symbols,
          options
        }));
        
        showMenu();
      });
    } else if (currentStreamType === 'markPrice' && isFutures) {
      options = { updateSpeed: '1s' };
      
      // Send subscription request
      ws.send(JSON.stringify({
        type: 'subscribe',
        streamType: currentStreamType,
        symbols,
        options
      }));
      
      showMenu();
    } else {
      // Send subscription request
      ws.send(JSON.stringify({
        type: 'subscribe',
        streamType: currentStreamType,
        symbols,
        options
      }));
      
      showMenu();
    }
  });
}

/**
 * Handle unsubscribing from symbols
 */
function handleUnsubscribe() {
  if (subscribedSymbols.length === 0) {
    console.log('No active subscriptions');
    showMenu();
    return;
  }
  
  console.log(`Currently subscribed to: ${subscribedSymbols.join(', ')}`);
  
  rl.question('Enter symbols to unsubscribe (comma-separated, or "all" for all): ', (answer) => {
    if (!answer.trim()) {
      showMenu();
      return;
    }
    
    let symbols = answer.toLowerCase() === 'all' 
      ? [...subscribedSymbols] 
      : answer.split(',').map(s => s.trim().toLowerCase());
    
    // Send unsubscription request
    ws.send(JSON.stringify({
      type: 'unsubscribe',
      streamType: currentStreamType,
      symbols
    }));
    
    showMenu();
  });
}

/**
 * Handle changing the stream type
 */
function handleChangeStreamType() {
  console.log(`Available stream types: ${availableStreamTypes.join(', ')}`);
  console.log(`Current stream type: ${currentStreamType}`);
  
  rl.question('Enter new stream type: ', (answer) => {
    const streamType = answer.trim().toLowerCase();
    
    if (!availableStreamTypes.includes(streamType)) {
      console.log('Invalid stream type');
      showMenu();
      return;
    }
    
    // Unsubscribe from current stream type
    if (subscribedSymbols.length > 0) {
      ws.send(JSON.stringify({
        type: 'unsubscribe',
        streamType: currentStreamType,
        symbols: subscribedSymbols
      }));
    }
    
    // Update current stream type
    currentStreamType = streamType;
    console.log(`Stream type changed to ${currentStreamType}`);
    
    // Clear subscribed symbols
    subscribedSymbols = [];
    
    showMenu();
  });
}

/**
 * Show current subscriptions
 */
function showSubscriptions() {
  console.log(`Market type: ${isFutures ? 'Futures' : 'Spot'}`);
  console.log(`Stream type: ${currentStreamType}`);
  console.log(`Subscribed symbols: ${subscribedSymbols.length > 0 ? subscribedSymbols.join(', ') : 'None'}`);
  console.log(`Subscribed raw streams: ${subscribedRawStreams.length > 0 ? subscribedRawStreams.join(', ') : 'None'}`);
  showMenu();
}

// Start the client
connect(); 