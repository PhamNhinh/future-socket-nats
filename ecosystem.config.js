module.exports = {
  apps: [
    {
      name: "future-socket-nats",
      script: "src/index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "development",
        WS_PORT: 8080,
        NATS_URL: "nats://localhost:4222",
        SYMBOLS_PER_WORKER: 100,
        LOG_LEVEL: "info",
        USE_FUTURES: "true"
      },
      env_production: {
        NODE_ENV: "production",
        WS_PORT: 8080,
        NATS_URL: "nats://localhost:4222",
        SYMBOLS_PER_WORKER: 100,
        LOG_LEVEL: "error",
        USE_FUTURES: "true"
      }
    }
  ]
}; 