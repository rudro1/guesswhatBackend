import IORedis from 'ioredis';

const createRedisClient = () => {
  // If a full REDIS_URL is provided (Upstash style), use it directly.
  // Upstash requires TLS — swap redis:// → rediss:// if not already set.
  if (process.env.REDIS_URL) {
    const url = process.env.REDIS_URL.startsWith('redis://')
      ? process.env.REDIS_URL.replace('redis://', 'rediss://')
      : process.env.REDIS_URL;

    return new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      tls: {},                    // required for Upstash TLS
      connectTimeout: 10000,
      retryStrategy: (times) => {
        if (times > 5) return null; // stop retrying after 5 attempts
        return Math.min(times * 500, 3000);
      },
    });
  }

  // Local / non-TLS Redis
  const config = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 5) return null;
      return Math.min(times * 500, 3000);
    },
  };

  if (process.env.REDIS_PASSWORD) {
    config.password = process.env.REDIS_PASSWORD;
  }

  return new IORedis(config);
};

const redis = createRedisClient();

let connected = false;
redis.on('connect', () => {
  if (!connected) {
    connected = true;
    console.log('[Redis] Connected');
  }
});

redis.on('error', (err) => {
  // Only log once per error type to avoid spam
  console.error('[Redis] Connection error:', err.message);
});

redis.on('reconnecting', () => {
  connected = false;
});

export default redis;
