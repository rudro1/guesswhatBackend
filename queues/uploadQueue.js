import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const getConnectionOptions = () => {
  if (process.env.REDIS_URL) {
    const url = process.env.REDIS_URL.startsWith('redis://')
      ? process.env.REDIS_URL.replace('redis://', 'rediss://')
      : process.env.REDIS_URL;
    return {
      connection: new IORedis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        tls: {},
        retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
      }),
    };
  }

  const opts = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
  };
  if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD;

  return { connection: new IORedis(opts) };
};

export const uploadQueue = new Queue('audio-upload', {
  ...getConnectionOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

uploadQueue.on('error', (err) => {
  console.error('[UploadQueue] Queue error:', err.message);
});

export default uploadQueue;
