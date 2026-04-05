import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import redis from '../config/redis.js';
import uploadQueue from '../queues/uploadQueue.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

const ACCEPTED_FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'webm', 'aac'];
const CHUNK_DIR = path.join(process.cwd(), 'temp_chunks');
const MERGE_DIR = path.join(process.cwd(), 'temp_merged');

[CHUNK_DIR, MERGE_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const batchId = req.body?.batchId;
    const fileId = req.body?.fileId;
    if (!batchId || !fileId || typeof batchId !== 'string' || typeof fileId !== 'string') {
      const e = new Error('batchId and fileId are required');
      e.status = 400;
      return cb(e);
    }
    const chunkDir = path.join(CHUNK_DIR, batchId, fileId);
    if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });
    cb(null, chunkDir);
  },
  filename: (req, file, cb) => {
    const idx = req.body?.chunkIndex ?? '0';
    cb(null, `chunk_${String(idx).padStart(6, '0')}`);
  },
});

const chunkUpload = multer({
  storage: chunkStorage,
  limits: { fileSize: 6 * 1024 * 1024 },
});

function handleChunkUpload(req, res, next) {
  chunkUpload.single('chunk')(req, res, (err) => {
    if (!err) return next();
    if (err.name === 'MulterError') {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Chunk exceeds maximum allowed size (6MB per chunk)' });
      }
      return res.status(400).json({ error: err.message || 'Multipart upload error' });
    }
    if (err.status === 400) {
      return res.status(400).json({ error: err.message || 'Invalid upload request' });
    }
    return next(err);
  });
}

async function sha256HexFromPath(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

router.post(
  '/chunk',
  authenticate,
  authorize('ADMIN'),
  handleChunkUpload,
  async (req, res, next) => {
    try {
      const {
        batchId,
        fileId,
        chunkIndex,
        chunkMd5,
        totalChunks,
        fileName,
        fileSize,
        originalMd5,
        mimeType,
      } = req.body;

      if (!req.file?.path) {
        return res.status(400).json({ error: 'No chunk received' });
      }
      if (!batchId || !fileId || typeof batchId !== 'string' || typeof fileId !== 'string') {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'batchId and fileId are required' });
      }

      const ext = path.extname(fileName || '').toLowerCase().replace('.', '');
      if (!fileName || !ACCEPTED_FORMATS.includes(ext)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: `Format .${ext || '?'} not accepted` });
      }

      const actualHash = await sha256HexFromPath(req.file.path);
      if (actualHash !== chunkMd5) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: `Chunk ${chunkIndex} integrity mismatch` });
      }

      const pipelineRedis = redis.pipeline();
      pipelineRedis.hset(`batch:${batchId}:file:${fileId}:meta`, {
        fileName,
        fileSize,
        originalMd5,
        mimeType,
        totalChunks,
      });
      pipelineRedis.sadd(`batch:${batchId}:file:${fileId}:chunks`, String(chunkIndex));
      await pipelineRedis.exec();

      res.json({ received: true, chunkIndex });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/merge', authenticate, authorize('ADMIN'), async (req, res, next) => {
  const safeUnlinkMerged = (p) => {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
  };

  let mergedPath;
  let writeStream;

  try {
    const { batchId, fileId } = req.body;
    if (!batchId || !fileId || typeof batchId !== 'string' || typeof fileId !== 'string') {
      return res.status(400).json({ error: 'batchId and fileId are required' });
    }

    const meta = await redis.hgetall(`batch:${batchId}:file:${fileId}:meta`);
    if (!meta || !meta.fileName) {
      return res.status(400).json({ error: 'File metadata not found' });
    }

    const { fileName, fileSize, originalMd5, mimeType, totalChunks } = meta;
    const totalChunksNum = parseInt(totalChunks, 10);
    if (Number.isNaN(totalChunksNum) || totalChunksNum < 1) {
      return res.status(400).json({ error: 'Invalid totalChunks in metadata' });
    }

    const receivedChunks = await redis.smembers(`batch:${batchId}:file:${fileId}:chunks`);
    if (receivedChunks.length !== totalChunksNum) {
      return res.status(400).json({
        error: `Missing chunks: expected ${totalChunksNum}, got ${receivedChunks.length}`,
      });
    }

    const chunkDir = path.join(CHUNK_DIR, batchId, fileId);
    const diskExt = path.extname(fileName) || '.bin';
    mergedPath = path.join(MERGE_DIR, `${batchId}_${fileId}${diskExt}`);
    const extNoDot = path.extname(fileName).toLowerCase().replace('.', '');
    const mimePart = typeof mimeType === 'string' ? mimeType.split('/')[1] : '';
    const originalFormat = ACCEPTED_FORMATS.includes(extNoDot) ? extNoDot : mimePart || 'unknown';

    writeStream = fs.createWriteStream(mergedPath);

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (err) {
          try {
            writeStream.destroy();
          } catch (_) {}
          safeUnlinkMerged(mergedPath);
          reject(err);
          return;
        }
        resolve();
      };

      writeStream.once('error', (err) => finish(err));

      writeStream.once('finish', () => {
        void (async () => {
          try {
            fs.rmSync(chunkDir, { recursive: true, force: true });
            const projectName = (await redis.hget(`batch:${batchId}:stats`, 'projectName')) || '';
            await uploadQueue.add(
              'process-audio',
              {
                batchId,
                fileId,
                mergedPath,
                fileName,
                originalFormat,
                fileSize: parseInt(fileSize, 10),
                originalChecksum: originalMd5,
                projectName,
              },
              { jobId: `${batchId}-${fileId}` }
            );
            res.json({ queued: true, fileId, fileName });
            finish();
          } catch (err) {
            safeUnlinkMerged(mergedPath);
            finish(err);
          }
        })();
      });

      void (async () => {
        try {
          for (let i = 0; i < totalChunksNum; i++) {
            const chunkPath = path.join(chunkDir, `chunk_${String(i).padStart(6, '0')}`);
            if (!fs.existsSync(chunkPath)) {
              throw new Error(`Missing chunk file ${i}`);
            }
            await pipeline(fs.createReadStream(chunkPath), writeStream, { end: false });
          }
          writeStream.end();
        } catch (err) {
          finish(err);
        }
      })();
    });
  } catch (error) {
    try {
      writeStream?.destroy();
    } catch (_) {}
    safeUnlinkMerged(mergedPath);
    next(error);
  }
});

const sseClients = new Map();

export { sseClients };

router.get('/progress/:batchId', authenticate, (req, res) => {
  const { batchId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.flushHeaders();

  const clientId = uuidv4();
  sseClients.set(clientId, { res, batchId });

  res.write(`data: ${JSON.stringify({ type: 'connected', batchId })}\n\n`);

  req.on('close', () => {
    sseClients.delete(clientId);
  });
});

router.post('/batch/init', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const uploadBatchId = uuidv4();
    const { files, projectName } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files must be a non-empty array with fileId and fileName per item' });
    }

    for (const f of files) {
      if (!f || typeof f.fileId !== 'string' || typeof f.fileName !== 'string') {
        return res.status(400).json({ error: 'Each file entry requires string fileId and fileName' });
      }
    }

    const batchId = uploadBatchId;
    const name =
      typeof projectName === 'string' && projectName.trim()
        ? projectName.trim().slice(0, 200)
        : '';

    const pipelineRedis = redis.pipeline();
    pipelineRedis.hset(`batch:${batchId}:stats`, {
      total: files.length,
      completed: 0,
      failed: 0,
      createdAt: Date.now(),
      ...(name ? { projectName: name } : {}),
    });
    pipelineRedis.expire(`batch:${batchId}:stats`, 86400);

    for (const file of files) {
      pipelineRedis.hset(`batch:${batchId}:file:${file.fileId}`, {
        status: 'PENDING',
        fileName: file.fileName,
      });
    }

    await pipelineRedis.exec();
    res.json({ batchId, uploadBatchId: batchId });
  } catch (error) {
    console.error('DB_ERROR:', error.message);
    next(error);
  }
});

export default router;
