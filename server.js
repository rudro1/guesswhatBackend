// import 'dotenv/config';
// import express from 'express';
// import cors from 'cors';
// import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
// import connectMongoDB from './config/mongodb.js';
// import prisma from './config/prisma.js';
// import authRoutes from './routes/auth.js';
// import adminRoutes from './routes/admin.js';
// import uploadRoutes, { sseClients } from './routes/upload.js';
// import taskRoutes from './routes/tasks.js';
// import annotationRoutes from './routes/annotations.js';
// import templateRoutes from './routes/templates.js';
// import { errorHandler } from './middleware/errorHandler.js';
// import { setSseClients } from './queues/workers/uploadWorker.js';

// const app = express();
// // Priority sequence for Port and Frontend URL
// const PORT = process.env.PORT || 5000;
// const allowedOrigins = [
//   process.env.FRONTEND_URL,
//   'http://localhost:5173',
//   'http://127.0.0.1:5173'
//   'https://guesswhat-frontend.vercel.app'
// ].filter(Boolean);

// // Security: Helmet needs specific config for Cross-Origin
// app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// // Optimized CORS
// const corsOptions = {
//   origin: (origin, callback) => {
//     if (!origin || allowedOrigins.includes(origin)) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
// };

// app.use(cors(corsOptions));
// app.options('*', cors(corsOptions)); // Enable pre-flight for all routes

// app.use(express.json({ limit: '10mb' }));
// app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 500, // Increased for dev/prod flexibility
//   standardHeaders: true,
//   legacyHeaders: false
// });
// app.use('/api', limiter);

// setSseClients(sseClients);

// // Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/admin', adminRoutes);
// app.use('/api/upload', uploadRoutes);
// app.use('/api/tasks', taskRoutes);
// app.use('/api/annotations', annotationRoutes);
// app.use('/api/templates', templateRoutes);

// app.get('/api/health', (req, res) => {
//   res.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

// app.use(errorHandler);

// const startServer = async () => {
//   try {
//     await connectMongoDB();
//     await prisma.$connect();
//     console.log('[PostgreSQL] Connected via Prisma');

//     app.listen(PORT, () => {
//       console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
//     });
//   } catch (error) {
//     console.error('[Server] Failed to start:', error);
//     process.exit(1);
//   }
// };

// process.on('SIGINT', async () => {
//   await prisma.$disconnect();
//   process.exit(0);
// });

// process.on('SIGTERM', async () => {
//   await prisma.$disconnect();
//   process.exit(0);
// });

// startServer();

// export default app;
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
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

// Setup __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 1. Trust Render's proxy for Rate Limiting
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;

// 2. Optimized CORS Origins
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://guesswhat-frontend.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
].filter(Boolean);

// 3. Security: Helmet with Custom CSP for Fonts & Resources
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "res.cloudinary.com"],
      fontSrc: ["'self'", "https://guesswhatbackend.onrender.com", "data:", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://guesswhatbackend.onrender.com", "https://api.cloudinary.com"],
    },
  },
}));

// 4. CORS Middleware
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
app.options('*', cors(corsOptions));

// 5. Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 6. Static Files (Fixes Font 404 & Loading)
app.use('/resources', express.static(path.join(__dirname, 'resources')));

// 7. Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});
app.use('/api', limiter);

setSseClients(sseClients);

// 8. Root Route (Fixes Base URL 404)
app.get('/', (req, res) => {
  res.json({ 
    message: "Guess What API is live", 
    status: "active",
    docs: "/api/health" 
  });
});

// 9. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/annotations', annotationRoutes);
app.use('/api/templates', templateRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString() 
  });
});

app.use(errorHandler);

// 10. Server Initialization
const startServer = async () => {
  try {
    await connectMongoDB();
    await prisma.$connect();
    console.log('[PostgreSQL] Connected via Prisma');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
};

// Graceful Shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();

export default app;