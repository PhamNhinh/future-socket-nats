import { LOG_LEVEL } from './config.js';

// Log levels in order of verbosity
const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Get numeric value of configured log level
const configuredLevel = LEVELS[LOG_LEVEL] || LEVELS.info;

/**
 * Logger utility for consistent logging across the application
 */
class Logger {
  constructor(context) {
    this.context = context;
  }

  /**
   * Format log message with timestamp and context
   */
  _formatMessage(message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${this.context}] ${message}`;
  }

  /**
   * Log error message
   */
  error(message, error) {
    if (configuredLevel >= LEVELS.error) {
      console.error(this._formatMessage(`ERROR: ${message}`), error || '');
    }
  }

  /**
   * Log warning message
   */
  warn(message) {
    if (configuredLevel >= LEVELS.warn) {
      console.warn(this._formatMessage(`WARNING: ${message}`));
    }
  }

  /**
   * Log info message
   */
  info(message) {
    if (configuredLevel >= LEVELS.info) {
      console.info(this._formatMessage(`INFO: ${message}`));
    }
  }

  /**
   * Log debug message
   */
  debug(message, data) {
    if (configuredLevel >= LEVELS.debug) {
      console.debug(this._formatMessage(`DEBUG: ${message}`), data || '');
    }
  }
}

/**
 * Create a logger instance for a specific context
 */
export const createLogger = (context) => new Logger(context); 