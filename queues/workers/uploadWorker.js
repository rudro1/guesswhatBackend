// import { Worker } from 'bullmq';
// import IORedis from 'ioredis';
// import fs from 'fs';
// import path from 'path';
// import crypto from 'crypto';
// import redis from '../../config/redis.js';
// import { uploadToCloudinary } from '../../config/cloudinary.js';
// import prisma from '../../config/prisma.js';

// // SSE clients registry - set from server.js
// let sseClients = null;
// export const setSseClients = (clients) => { sseClients = clients; };

// const broadcastProgress = (batchId, fileId, data) => {
//   if (!sseClients) return;
//   const message = JSON.stringify({ batchId, fileId, ...data });
//   sseClients.forEach((client) => {
//     try { client.res.write(`data: ${message}\n\n`); } catch (_) {}
//   });
// };

// const computeMd5 = (filePath) => new Promise((resolve, reject) => {
//   const hash = crypto.createHash('md5');
//   const stream = fs.createReadStream(filePath);
//   stream.on('data', (chunk) => hash.update(chunk));
//   stream.on('end', () => resolve(hash.digest('hex')));
//   stream.on('error', reject);
// });

// const withRetry = async (fn, maxAttempts = 3, label = '') => {
//   let lastErr;
//   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//     try {
//       return await fn();
//     } catch (err) {
//       lastErr = err;
//       console.warn(`[Worker] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
//       if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
//     }
//   }
//   throw lastErr;
// };

// // BullMQ Worker requires its OWN dedicated IORedis connection — cannot share
// const makeWorkerConnection = () => {
//   if (process.env.REDIS_URL) {
//     const url = process.env.REDIS_URL.startsWith('redis://')
//       ? process.env.REDIS_URL.replace('redis://', 'rediss://')
//       : process.env.REDIS_URL;
//     return new IORedis(url, {
//       maxRetriesPerRequest: null,
//       enableReadyCheck: false,
//       tls: {},
//       retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
//     });
//   }
//   const opts = {
//     host: process.env.REDIS_HOST || 'localhost',
//     port: parseInt(process.env.REDIS_PORT || '6379', 10),
//     maxRetriesPerRequest: null,
//     enableReadyCheck: false,
//     retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
//   };
//   if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD;
//   return new IORedis(opts);
// };

// const uploadWorker = new Worker(
//   'audio-upload',
//   async (job) => {
//     const { batchId, fileId, mergedPath, fileName, originalFormat, fileSize, originalChecksum } = job.data;

//     try {
//       // Step 7: Verify merged file MD5
//       broadcastProgress(batchId, fileId, { stage: 'VERIFYING', fileName, progress: 60 });
//       const mergedChecksum = await computeMd5(mergedPath);
//       if (mergedChecksum !== originalChecksum) {
//         throw new Error(`Checksum mismatch for ${fileName}. File may be corrupt.`);
//       }

//       // Step 8: Upload to Cloudinary as-is (no transformation)
//       broadcastProgress(batchId, fileId, { stage: 'UPLOADING_CLOUD', fileName, progress: 70 });
//       const cloudResult = await withRetry(
//         () => uploadToCloudinary(mergedPath, `guess-what/${batchId}/${path.parse(fileName).name}`),
//         3,
//         'Cloudinary upload'
//       );

//       // Step 9-10: Create Task in PostgreSQL
//       broadcastProgress(batchId, fileId, { stage: 'CREATING_TASK', fileName, progress: 90 });
//       const task = await withRetry(
//         () => prisma.task.create({
//           data: {
//             audioUrl: cloudResult.secure_url,
//             fileName,
//             originalFormat,
//             fileSize,
//             checksum: originalChecksum,
//             status: 'PENDING',
//             uploadBatchId: batchId,
//           },
//         }),
//         3,
//         'Task creation'
//       );

//       // Step 11: Redis pipeline update (use shared redis for data ops)
//       try {
//         const pipeline = redis.pipeline();
//         pipeline.hset(`batch:${batchId}:file:${fileId}`, { status: 'DONE', taskId: String(task.id), audioUrl: cloudResult.secure_url });
//         pipeline.hincrby(`batch:${batchId}:stats`, 'completed', 1);
//         await pipeline.exec();
//       } catch (redisErr) {
//         console.warn('[Worker] Redis pipeline update failed (non-fatal):', redisErr.message);
//       }

//       // Step 12: Cleanup temp file
//       fs.unlink(mergedPath, () => {});

//       // Step 13: SSE broadcast
//       broadcastProgress(batchId, fileId, { stage: 'DONE', fileName, progress: 100, taskId: task.id, audioUrl: cloudResult.secure_url });

//       return { taskId: task.id, audioUrl: cloudResult.secure_url };
//     } catch (error) {
//       broadcastProgress(batchId, fileId, { stage: 'FAILED', fileName, progress: 0, error: error.message });
//       try {
//         const pipeline = redis.pipeline();
//         pipeline.hset(`batch:${batchId}:file:${fileId}`, { status: 'FAILED', error: error.message });
//         pipeline.hincrby(`batch:${batchId}:stats`, 'failed', 1);
//         await pipeline.exec();
//       } catch (_) {}
//       if (fs.existsSync(mergedPath)) fs.unlink(mergedPath, () => {});
//       throw error;
//     }
//   },
//   {
//     connection: makeWorkerConnection(),
//     concurrency: 5,
//   }
// );

// uploadWorker.on('completed', (job, result) => {
//   console.log(`[Worker] Job ${job.id} completed. Task ID: ${result.taskId}`);
// });

// uploadWorker.on('failed', (job, err) => {
//   console.error(`[Worker] Job ${job.id} failed: ${err.message}`);
// });

// uploadWorker.on('error', (err) => {
//   console.error('[Worker] Worker error:', err.message);
// });

// export default uploadWorker;

// const broadcastProgress = (batchId, fileId, data) => {
//   if (!sseClients) return;
//   const message = JSON.stringify({ batchId, fileId, ...data });
//   sseClients.forEach((client) => {
//     try {
//       client.res.write(`data: ${message}\n\n`);
//     } catch (_) {}
//   });
// };

// const computeMd5 = (filePath) => new Promise((resolve, reject) => {
//   const hash = crypto.createHash('md5');
//   const stream = fs.createReadStream(filePath);
//   stream.on('data', (chunk) => hash.update(chunk));
//   stream.on('end', () => resolve(hash.digest('hex')));
//   stream.on('error', reject);
// });

// const withRetry = async (fn, maxAttempts = 3, label = '') => {
//   let lastErr;
//   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//     try {
//       return await fn();
//     } catch (err) {
//       lastErr = err;
//       console.warn(`[Worker] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
//       if (attempt < maxAttempts) {
//         await new Promise((r) => setTimeout(r, 1000 * attempt));
//       }
//     }
//   }
//   throw lastErr;
// };

// const uploadWorker = new Worker(
//   'audio-upload',
//   async (job) => {
//     const { batchId, fileId, mergedPath, fileName, originalFormat, fileSize, originalChecksum } = job.data;

//     try {
//       // Step 7: Verify merged file MD5
//       broadcastProgress(batchId, fileId, { stage: 'VERIFYING', fileName, progress: 60 });
//       const mergedChecksum = await computeMd5(mergedPath);
//       if (mergedChecksum !== originalChecksum) {
//         throw new Error(`Checksum mismatch for ${fileName}. File may be corrupt.`);
//       }

//       // Step 8: Upload to Cloudinary as-is
//       broadcastProgress(batchId, fileId, { stage: 'UPLOADING_CLOUD', fileName, progress: 70 });
//       const cloudResult = await withRetry(
//         () => uploadToCloudinary(mergedPath, `guess-what/${batchId}/${path.parse(fileName).name}`),
//         3,
//         'Cloudinary upload'
//       );

//       // Step 9: Cloudinary confirmed
//       broadcastProgress(batchId, fileId, { stage: 'CREATING_TASK', fileName, progress: 90 });

//       // Step 10: Create Task in PostgreSQL
//       const task = await withRetry(
//         () => prisma.task.create({
//           data: {
//             audioUrl: cloudResult.secure_url,
//             fileName,
//             originalFormat,
//             fileSize,
//             checksum: originalChecksum,
//             status: 'PENDING',
//             uploadBatchId: batchId
//           }
//         }),
//         3,
//         'Task creation'
//       );

//       // Step 11: Redis pipeline update
//       const pipeline = redis.pipeline();
//       pipeline.hset(`batch:${batchId}:file:${fileId}`, {
//         status: 'DONE',
//         taskId: task.id,
//         audioUrl: cloudResult.secure_url
//       });
//       pipeline.hincrby(`batch:${batchId}:stats`, 'completed', 1);
//       await pipeline.exec();

//       // Step 12: Cleanup temp file
//       fs.unlink(mergedPath, () => {});

//       // Step 13: SSE final progress
//       broadcastProgress(batchId, fileId, {
//         stage: 'DONE',
//         fileName,
//         progress: 100,
//         taskId: task.id,
//         audioUrl: cloudResult.secure_url
//       });

//       return { taskId: task.id, audioUrl: cloudResult.secure_url };
//     } catch (error) {
//       broadcastProgress(batchId, fileId, {
//         stage: 'FAILED',
//         fileName,
//         progress: 0,
//         error: error.message
//       });

//       const pipeline = redis.pipeline();
//       pipeline.hset(`batch:${batchId}:file:${fileId}`, { status: 'FAILED', error: error.message });
//       pipeline.hincrby(`batch:${batchId}:stats`, 'failed', 1);
//       await pipeline.exec();

//       if (fs.existsSync(mergedPath)) fs.unlink(mergedPath, () => {});
//       throw error;
//     }
//   },
//   {
//     connection: redis,
//     concurrency: 5
//   }
// );

// uploadWorker.on('completed', (job, result) => {
//   console.log(`[Worker] Job ${job.id} completed. Task ID: ${result.taskId}`);
// });

// uploadWorker.on('failed', (job, err) => {
//   console.error(`[Worker] Job ${job.id} failed: ${err.message}`);
// });

// uploadWorker.on('error', (err) => {
//   console.error('[Worker] Worker error:', err.message);
// });

// export default uploadWorker;
import { Worker, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import redis from '../../config/redis.js';
import { uploadToCloudinary } from '../../config/cloudinary.js';
import prisma from '../../config/prisma.js';

// SSE clients registry
let sseClients = null;
export const setSseClients = (clients) => { sseClients = clients; };

const broadcastProgress = (batchId, fileId, data) => {
  if (!sseClients) return;
  const message = JSON.stringify({ batchId, fileId, ...data });
  sseClients.forEach((client) => {
    try { client.res.write(`data: ${message}\n\n`); } catch (_) {}
  });
};

// Must match frontend BulkUpload: SHA-256 hex of full file (field is still named originalMd5 in Redis).
const computeSha256Hex = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
  stream.on('error', reject);
});

const withRetry = async (fn, maxAttempts = 3, label = '') => {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[Worker] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
};

const makeWorkerConnection = () => {
  if (process.env.REDIS_URL) {
    const url = process.env.REDIS_URL.startsWith('redis://')
      ? process.env.REDIS_URL.replace('redis://', 'rediss://')
      : process.env.REDIS_URL;
    return new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: {},
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
    });
  }
  const opts = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
  };
  if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD;
  return new IORedis(opts);
};

const uploadWorker = new Worker(
  'audio-upload',
  async (job) => {
    const {
      batchId,
      fileId,
      mergedPath,
      fileName,
      originalFormat,
      fileSize,
      originalChecksum,
      projectName: jobProjectName,
    } = job.data;

    try {
      if (!mergedPath || typeof mergedPath !== 'string') {
        throw new UnrecoverableError('Invalid job: missing mergedPath');
      }
      if (!fs.existsSync(mergedPath)) {
        throw new UnrecoverableError(
          'Merged file is missing (upload may have already failed and cleaned up; re-merge from client if needed).'
        );
      }

      broadcastProgress(batchId, fileId, { stage: 'VERIFYING', fileName, progress: 60 });
      const mergedChecksum = await computeSha256Hex(mergedPath);
      if (mergedChecksum !== originalChecksum) {
        throw new UnrecoverableError(`Checksum mismatch for ${fileName}. File may be corrupt.`);
      }

      broadcastProgress(batchId, fileId, { stage: 'UPLOADING_CLOUD', fileName, progress: 70 });
      const cloudResult = await withRetry(
        () => uploadToCloudinary(mergedPath, `guess-what/${batchId}/${path.parse(fileName).name}`),
        3,
        'Cloudinary upload'
      );

      broadcastProgress(batchId, fileId, { stage: 'CREATING_TASK', fileName, progress: 90 });
      let projectName = typeof jobProjectName === 'string' && jobProjectName.trim() ? jobProjectName.trim().slice(0, 200) : null;
      if (!projectName) {
        try {
          const fromRedis = await redis.hget(`batch:${batchId}:stats`, 'projectName');
          if (fromRedis && String(fromRedis).trim()) projectName = String(fromRedis).trim().slice(0, 200);
        } catch (_) {}
      }
      const task = await withRetry(
        () => prisma.task.create({
          data: {
            audioUrl: cloudResult.secure_url,
            fileName,
            originalFormat,
            fileSize,
            checksum: originalChecksum,
            status: 'PENDING',
            uploadBatchId: batchId,
            ...(projectName ? { projectName } : {}),
          },
        }),
        3,
        'Task creation'
      );

      try {
        const pipeline = redis.pipeline();
        pipeline.hset(`batch:${batchId}:file:${fileId}`, { status: 'DONE', taskId: String(task.id), audioUrl: cloudResult.secure_url });
        pipeline.hincrby(`batch:${batchId}:stats`, 'completed', 1);
        await pipeline.exec();
      } catch (redisErr) {
        console.warn('[Worker] Redis pipeline update failed:', redisErr.message);
      }

      if (fs.existsSync(mergedPath)) fs.unlink(mergedPath, () => {});

      broadcastProgress(batchId, fileId, { stage: 'DONE', fileName, progress: 100, taskId: task.id, audioUrl: cloudResult.secure_url });

      return { taskId: task.id, audioUrl: cloudResult.secure_url };
    } catch (error) {
      broadcastProgress(batchId, fileId, { stage: 'FAILED', fileName, progress: 0, error: error.message });
      try {
        const pipeline = redis.pipeline();
        pipeline.hset(`batch:${batchId}:file:${fileId}`, { status: 'FAILED', error: error.message });
        pipeline.hincrby(`batch:${batchId}:stats`, 'failed', 1);
        await pipeline.exec();
      } catch (_) {}
      if (fs.existsSync(mergedPath)) fs.unlink(mergedPath, () => {});
      throw error;
    }
  },
  {
    connection: makeWorkerConnection(),
    concurrency: 5,
  }
);

uploadWorker.on('completed', (job, result) => {
  console.log(`[Worker] Job ${job.id} completed.`);
});

uploadWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} failed: ${err.message}`);
});

export default uploadWorker;