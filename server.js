import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import connectMongoDB from './config/mongodb.js';
import prisma from './config/prisma.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes, { sseClients } from './routes/upload.js';
import taskRoutes from './routes/tasks.js';
import annotationRoutes from './routes/annotations.js';
import templateRoutes from './routes/templates.js';
import { errorHandler } from './middleware/errorHandler.js';
import { setSseClients } from './queues/workers/uploadWorker.js';

const app = express();
// Priority sequence for Port and Frontend URL
const PORT = process.env.PORT || 5000;
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
].filter(Boolean);

// Security: Helmet needs specific config for Cross-Origin
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Optimized CORS
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Enable pre-flight for all routes

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // Increased for dev/prod flexibility
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', limiter);

setSseClients(sseClients);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/annotations', annotationRoutes);
app.use('/api/templates', templateRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

const startServer = async () => {
  try {
    await connectMongoDB();
    await prisma.$connect();
    console.log('[PostgreSQL] Connected via Prisma');

    app.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

startServer();

export default app;