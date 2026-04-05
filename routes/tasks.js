import express from 'express';
import prisma from '../config/prisma.js';
import Annotation from '../models/Annotation.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Get all tasks (admin)
router.get('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, batchId, page = 1, limit = 50 } = req.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (batchId) where.uploadBatchId = batchId;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { id: 'asc' }
      }),
      prisma.task.count({ where })
    ]);

    res.json({ tasks, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    next(error);
  }
});

// Get next pending task for annotator
router.get('/next', authenticate, authorize('ANNOTATOR'), async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const assignment = await prisma.assignment.findFirst({ where: { userId } });
    if (!assignment) {
      return res.status(404).json({ error: 'No assignment found for this user' });
    }

    // Get all submitted task IDs from MongoDB
    const submittedAnnotations = await Annotation.find({
      annotatorId: userId,
      status: { $in: ['SUBMITTED', 'REVIEWED'] }
    }).select('taskId');
    const submittedIds = submittedAnnotations.map((a) => a.taskId);

    // Find first PENDING task in user's range not yet submitted
    const task = await prisma.task.findFirst({
      where: {
        id: {
          gte: assignment.startTaskId,
          lte: assignment.endTaskId,
          notIn: submittedIds.length ? submittedIds : [-1],
        },
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      orderBy: { id: 'asc' },
    });

    if (!task) {
      return res.status(404).json({ error: 'No pending tasks remaining', allDone: true });
    }

    const completedCount = submittedIds.length;
    const totalCount = assignment.endTaskId - assignment.startTaskId + 1;

    res.json({ task, progress: { completed: completedCount, total: totalCount } });
  } catch (error) {
    next(error);
  }
});

// Get single task
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // ANNOTATOR: verify it's within their assignment
    if (req.user.role === 'ANNOTATOR') {
      const assignment = await prisma.assignment.findFirst({ where: { userId: req.user.userId } });
      if (!assignment || id < assignment.startTaskId || id > assignment.endTaskId) {
        return res.status(403).json({ error: 'Task not in your assignment range' });
      }
    }

    res.json(task);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'REVIEWED'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const task = await prisma.task.update({ where: { id }, data: { status } });
    res.json(task);
  } catch (error) {
    next(error);
  }
});

export default router;
