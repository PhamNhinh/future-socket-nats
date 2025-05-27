import { connect } from 'nats';
import { NATS_URL, NATS_SUBJECTS } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('NatsService');

/**
 * Service to handle NATS connection and messaging
 */
export class NatsService {
  constructor() {
    this.client = null;
    this.subscribers = new Map();
  }

  /**
   * Connect to NATS server
   */
  async connect() {
    try {
      logger.info(`Connecting to NATS server at ${NATS_URL}`);
      this.client = await connect({ servers: NATS_URL });
      logger.info('Successfully connected to NATS');
      
      // Setup connection close handler
      this.client.closed().then(() => {
        logger.info('NATS connection closed');
      });
      
      return this.client;
    } catch (error) {
      logger.error('Failed to connect to NATS', error);
      throw error;
    }
  }

  /**
   * Publish message to a subject
   */
  publish(subject, data) {
    if (!this.client) {
      logger.error('Cannot publish: NATS client not connected');
      return false;
    }

    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.client.publish(subject, message);
      return true;
    } catch (error) {
      logger.error(`Error publishing to ${subject}`, error);
      return false;
    }
  }

  /**
   * Subscribe to a subject
   */
  subscribe(subject, callback) {
    if (!this.client) {
      logger.error('Cannot subscribe: NATS client not connected');
      return null;
    }

    try {
      logger.info(`Subscribing to ${subject}`);
      const subscription = this.client.subscribe(subject);
      
      // Store the subscription
      this.subscribers.set(subject, subscription);
      
      // Process messages
      (async () => {
        for await (const message of subscription) {
          try {
            const data = message.string();
            const parsedData = JSON.parse(data);
            callback(parsedData);
          } catch (error) {
            logger.error(`Error processing message from ${subject}`, error);
          }
        }
      })();
      
      return subscription;
    } catch (error) {
      logger.error(`Error subscribing to ${subject}`, error);
      return null;
    }
  }

  /**
   * Unsubscribe from a subject
   */
  unsubscribe(subject) {
    if (this.subscribers.has(subject)) {
      const subscription = this.subscribers.get(subject);
      subscription.unsubscribe();
      this.subscribers.delete(subject);
      logger.info(`Unsubscribed from ${subject}`);
      return true;
    }
    return false;
  }

  /**
   * Close NATS connection
   */
  async close() {
    if (this.client) {
      logger.info('Closing NATS connection');
      await this.client.drain();
      this.client = null;
      this.subscribers.clear();
    }
  }
} 