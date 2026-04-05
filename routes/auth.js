// import express from 'express';
// import bcrypt from 'bcryptjs';
// import jwt from 'jsonwebtoken';
// import prisma from '../config/prisma.js';

// const router = express.Router();

// router.post('/login', async (req, res, next) => {
//   try {
//     const { email, password } = req.body;

//     if (!email || !password) {
//       return res.status(400).json({ error: 'Email and password are required' });
//     }

//     const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
//     if (!user) {
//       return res.status(401).json({ error: 'Invalid credentials' });
//     }

//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) {
//       return res.status(401).json({ error: 'Invalid credentials' });
//     }

//     const accessToken = jwt.sign(
//       { userId: user.id, role: user.role, email: user.email, name: user.name },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
//     );

//     const refreshToken = jwt.sign(
//       { userId: user.id },
//       process.env.JWT_REFRESH_SECRET,
//       { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
//     );

//     res.json({
//       token: accessToken,
//       refreshToken,
//       user: { id: user.id, email: user.email, name: user.name, role: user.role }
//     });
//   } catch (error) {
//     next(error);
//   }
// });

// router.post('/refresh', async (req, res, next) => {
//   try {
//     const { refreshToken } = req.body;
//     if (!refreshToken) {
//       return res.status(400).json({ error: 'Refresh token required' });
//     }

//     const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
//     const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
//     if (!user) {
//       return res.status(401).json({ error: 'User not found' });
//     }

//     const accessToken = jwt.sign(
//       { userId: user.id, role: user.role, email: user.email, name: user.name },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
//     );

//     res.json({ token: accessToken });
//   } catch (error) {
//     if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
//       return res.status(401).json({ error: 'Invalid or expired refresh token' });
//     }
//     next(error);
//   }
// });

// export default router;
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import AccessRequest from '../models/AccessRequest.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// ── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = jwt.sign(
      { userId: user.id, role: user.role, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
    );

    res.json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (error) {
    next(error);
  }
});

// ── Refresh token ─────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const accessToken = jwt.sign(
      { userId: user.id, role: user.role, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({ token: accessToken });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    next(error);
  }
});

// ── Submit access request (public — no auth needed) ───────────────────────────
router.post('/request-access', async (req, res, next) => {
  try {
    const { name, email, role, note } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    if (role && !['ANNOTATOR', 'REVIEWER'].includes(role)) {
      return res.status(400).json({ error: 'Role must be ANNOTATOR or REVIEWER' });
    }

    // Check if email already has an account
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }

    // Check for duplicate pending request
    const dup = await AccessRequest.findOne({ email: email.toLowerCase().trim(), status: 'PENDING' });
    if (dup) {
      return res.status(409).json({ error: 'A pending request for this email already exists.' });
    }

    await AccessRequest.create({ name: name.trim(), email: email.toLowerCase().trim(), role: role || 'ANNOTATOR', note: note || '' });
    res.status(201).json({ message: 'Access request submitted. Your admin will create your account.' });
  } catch (error) {
    next(error);
  }
});

// ── Get all access requests (admin only) ─────────────────────────────────────
router.get('/request-access', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const raw = await AccessRequest.find().sort({ createdAt: -1 }).lean();
    res.json(
      raw.map((r) => ({
        ...r,
        id: String(r._id),
      }))
    );
  } catch (error) {
    next(error);
  }
});

// ── Dismiss / delete a request (admin only) ───────────────────────────────────
router.delete('/request-access/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined') {
      return res.status(400).json({ error: 'Request id is required' });
    }
    const deleted = await AccessRequest.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Access request not found' });
    }
    res.json({ message: 'Request removed' });
  } catch (error) {
    next(error);
  }
});

export default router;