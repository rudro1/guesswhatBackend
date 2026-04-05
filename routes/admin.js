// import express from 'express';
// import bcrypt from 'bcryptjs';
// import prisma from '../config/prisma.js';
// import Annotation from '../models/Annotation.js';
// import { authenticate, authorize } from '../middleware/auth.js';

// const router = express.Router();

// // Create user (admin only)
// router.post('/users', authenticate, authorize('ADMIN'), async (req, res, next) => {
//   try {
//     const { email, password, name, role } = req.body;

//     if (!email || !password || !name || !role) {
//       return res.status(400).json({ error: 'email, password, name, and role are required' });
//     }

//     if (!['ANNOTATOR', 'REVIEWER'].includes(role.toUpperCase())) {
//       return res.status(400).json({ error: 'Role must be ANNOTATOR or REVIEWER' });
//     }

//     const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
//     if (existing) {
//       return res.status(409).json({ error: 'User already exists with this email' });
//     }

//     const hashed = await bcrypt.hash(password, 12);
//     const user = await prisma.user.create({
//       data: {
//         email: email.toLowerCase().trim(),
//         password: hashed,
//         name: name.trim(),
//         role: role.toUpperCase()
//       }
//     });

//     res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt });
//   } catch (error) {
//     next(error);
//   }
// });

// // Get all users with progress (admin only)
// router.get('/users', authenticate, authorize('ADMIN'), async (req, res, next) => {
//   try {
//     const users = await prisma.user.findMany({
//       select: { id: true, email: true, name: true, role: true, createdAt: true, assignments: true }
//     });

//     const usersWithProgress = await Promise.all(users.map(async (u) => {
//       const assignment = u.assignments[0];
//       let completed = 0;
//       let total = 0;

//       if (assignment) {
//         total = assignment.endTaskId - assignment.startTaskId + 1;
//         const annotations = await Annotation.countDocuments({
//           annotatorId: u.id,
//           status: { $in: ['SUBMITTED', 'REVIEWED'] }
//         });
//         completed = annotations;
//       }

//       return {
//         id: u.id,
//         email: u.email,
//         name: u.name,
//         role: u.role,
//         createdAt: u.createdAt,
//         assignment: assignment
//           ? { startTaskId: assignment.startTaskId, endTaskId: assignment.endTaskId }
//           : null,
//         progress: { completed, total }
//       };
//     }));

//     res.json(usersWithProgress);
//   } catch (error) {
//     next(error);
//   }
// });

// // Assign task range to user
// router.post('/assign', authenticate, authorize('ADMIN'), async (req, res, next) => {
//   try {
//     const { userId, startTaskId, endTaskId } = req.body;

//     if (!userId || !startTaskId || !endTaskId) {
//       return res.status(400).json({ error: 'userId, startTaskId, and endTaskId are required' });
//     }

//     if (startTaskId > endTaskId) {
//       return res.status(400).json({ error: 'startTaskId must be less than or equal to endTaskId' });
//     }

//     const user = await prisma.user.findUnique({ where: { id: userId } });
//     if (!user) {
//       return res.status(404).json({ error: 'User not found' });
//     }

//     // Check that tasks exist in this range
//     const taskCount = await prisma.task.count({
//       where: { id: { gte: startTaskId, lte: endTaskId } }
//     });

//     if (taskCount === 0) {
//       return res.status(400).json({ error: 'No tasks found in this range' });
//     }

//     // Delete existing assignments for user and create new
//     await prisma.assignment.deleteMany({ where: { userId } });

//     const assignment = await prisma.assignment.create({
//       data: { userId, startTaskId, endTaskId }
//     });

//     res.json({
//       message: `Assigned tasks ${startTaskId} to ${endTaskId} (${taskCount} tasks) to ${user.name}`,
//       assignment
//     });
//   } catch (error) {
//     next(error);
//   }
// });

// // Dashboard stats
// router.get('/stats', authenticate, authorize('ADMIN'), async (req, res, next) => {
//   try {
//     const [totalTasks, pendingTasks, completedTasks, reviewedTasks, totalAnnotators] = await Promise.all([
//       prisma.task.count(),
//       prisma.task.count({ where: { status: 'PENDING' } }),
//       prisma.task.count({ where: { status: 'COMPLETED' } }),
//       prisma.task.count({ where: { status: 'REVIEWED' } }),
//       prisma.user.count({ where: { role: 'ANNOTATOR' } })
//     ]);

//     const recentAnnotations = await Annotation.find()
//       .sort({ updatedAt: -1 })
//       .limit(10)
//       .select('taskId annotatorId status updatedAt');

//     res.json({
//       tasks: { total: totalTasks, pending: pendingTasks, completed: completedTasks, reviewed: reviewedTasks },
//       annotators: totalAnnotators,
//       recent: recentAnnotations
//     });
//   } catch (error) {
//     next(error);
//   }
// });

// export default router;
import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import Annotation from '../models/Annotation.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { buildExportData, buildSegmentAuditTrail, sha256Json } from '../utils/annotationExport.js';
import { segmentsToTrainingArray } from '../utils/clientTrainingExport.js';

const router = express.Router();

// Create user (admin only)
router.post('/users', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'email, password, name, and role are required' });
    }

    if (!['ANNOTATOR', 'REVIEWER'].includes(role.toUpperCase())) {
      return res.status(400).json({ error: 'Role must be ANNOTATOR or REVIEWER' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(409).json({ error: 'User already exists with this email' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: hashed,
        name: name.trim(),
        role: role.toUpperCase()
      }
    });

    res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt });
  } catch (error) {
    next(error);
  }
});

// Get all users with progress (admin only)
router.get('/users', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true, assignments: true }
    });

    const usersWithProgress = await Promise.all(users.map(async (u) => {
      const assignment = u.assignments[0];
      let completed = 0;
      let total = 0;

      if (assignment) {
        total = assignment.endTaskId - assignment.startTaskId + 1;
        const annotations = await Annotation.countDocuments({
          annotatorId: u.id,
          status: { $in: ['SUBMITTED', 'REVIEWED'] }
        });
        completed = annotations;
      }

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt,
        assignment: assignment
          ? { startTaskId: assignment.startTaskId, endTaskId: assignment.endTaskId }
          : null,
        progress: { completed, total }
      };
    }));

    res.json(usersWithProgress);
  } catch (error) {
    next(error);
  }
});

// Assign task range to user
router.post('/assign', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { userId, startTaskId, endTaskId } = req.body;

    if (!userId || !startTaskId || !endTaskId) {
      return res.status(400).json({ error: 'userId, startTaskId, and endTaskId are required' });
    }

    if (startTaskId > endTaskId) {
      return res.status(400).json({ error: 'startTaskId must be less than or equal to endTaskId' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check that tasks exist in this range
    const taskCount = await prisma.task.count({
      where: { id: { gte: startTaskId, lte: endTaskId } }
    });

    if (taskCount === 0) {
      return res.status(400).json({ error: 'No tasks found in this range' });
    }

    // Delete existing assignments for user and create new
    await prisma.assignment.deleteMany({ where: { userId } });

    const assignment = await prisma.assignment.create({
      data: { userId, startTaskId, endTaskId }
    });

    res.json({
      message: `Assigned tasks ${startTaskId} to ${endTaskId} (${taskCount} tasks) to ${user.name}`,
      assignment
    });
  } catch (error) {
    next(error);
  }
});

// Dashboard stats
router.get('/stats', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const [totalTasks, pendingTasks, completedTasks, reviewedTasks, totalAnnotators] = await Promise.all([
      prisma.task.count(),
      prisma.task.count({ where: { status: 'PENDING' } }),
      prisma.task.count({ where: { status: 'COMPLETED' } }),
      prisma.task.count({ where: { status: 'REVIEWED' } }),
      prisma.user.count({ where: { role: 'ANNOTATOR' } })
    ]);

    const recentAnnotations = await Annotation.find()
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('taskId annotatorId status updatedAt');

    res.json({
      tasks: { total: totalTasks, pending: pendingTasks, completed: completedTasks, reviewed: reviewedTasks },
      annotators: totalAnnotators,
      recent: recentAnnotations
    });
  } catch (error) {
    next(error);
  }
});

router.get('/batches', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        t."uploadBatchId" AS "uploadBatchId",
        COUNT(*)::integer AS "totalTasks",
        COUNT(*) FILTER (WHERE t.status::text IN ('COMPLETED', 'REVIEWED'))::integer AS "annotatedCount",
        COUNT(*) FILTER (WHERE t.status::text = 'REVIEWED')::integer AS "reviewedCount",
        COUNT(*) FILTER (WHERE t.status::text IN ('PENDING', 'IN_PROGRESS'))::integer AS "remainingCount",
        MAX(t."projectName") AS "projectName"
      FROM "Task" t
      GROUP BY t."uploadBatchId"
      ORDER BY MIN(t.id) ASC
    `;
    const batches = rows.map((r) => {
      const total = Number(r.totalTasks) || 0;
      const reviewed = Number(r.reviewedCount) || 0;
      const batchName = r.projectName || r.uploadBatchId || 'Unnamed batch';
      const clientReadinessPct = total > 0 ? Math.round((reviewed / total) * 1000) / 10 : 0;
      const fullyReviewed = total > 0 && reviewed === total;
      return {
        uploadBatchId: r.uploadBatchId,
        batchName,
        totalTasks: total,
        annotatedCount: Number(r.annotatedCount) || 0,
        reviewedCount: reviewed,
        remainingCount: Number(r.remainingCount) || 0,
        clientReadinessPct,
        fullyReviewed,
      };
    });
    res.json({ batches });
  } catch (error) {
    next(error);
  }
});

router.get('/monitoring-tasks', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const batchId =
      typeof req.query.batchId === 'string' && req.query.batchId.trim() ? req.query.batchId.trim() : null;
    const where = batchId ? { uploadBatchId: batchId } : {};
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: 'asc' },
      }),
      prisma.task.count({ where }),
    ]);
    const taskIds = tasks.map((t) => t.id);
    const annotations = await Annotation.find({ taskId: { $in: taskIds } }).lean();
    const annByTask = new Map(annotations.map((a) => [a.taskId, a]));
    const userIds = [...new Set(annotations.flatMap((a) => [a.annotatorId, a.reviewerId].filter(Boolean)))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const rows = tasks.map((t) => {
      const a = annByTask.get(t.id);
      const annot = a?.annotatorId ? userById.get(a.annotatorId) : null;
      const rev = a?.reviewerId ? userById.get(a.reviewerId) : null;
      return {
        ...t,
        annotatorName: a?.annotatorName || annot?.name || null,
        annotatorEmail: a?.annotatorEmail || annot?.email || null,
        reviewerName: a?.reviewerName || rev?.name || null,
        reviewerEmail: a?.reviewerEmail || rev?.email || null,
        submittedAt: a?.submittedAt || null,
        reviewedAt: a?.reviewedAt || null,
        annotationStatus: a?.status || null,
        annotationIsValid: a ? a.isValid !== false : null,
      };
    });

    res.json({
      tasks: rows,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    next(error);
  }
});

const TRAINING_PAGE = 250;

router.get('/export-project/:batchId', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const batchId = req.params.batchId;
    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }

    const [batchMeta] = await prisma.$queryRaw`
      SELECT
        COUNT(*)::integer AS "totalTasks",
        COUNT(*) FILTER (WHERE t.status::text = 'REVIEWED')::integer AS "reviewedCount"
      FROM "Task" t
      WHERE t."uploadBatchId" = ${batchId}
    `;
    const totalInProject = Number(batchMeta?.totalTasks) || 0;
    const reviewedInProject = Number(batchMeta?.reviewedCount) || 0;
    if (totalInProject === 0) {
      return res.status(404).json({ error: 'No tasks for this batch' });
    }
    if (reviewedInProject !== totalInProject) {
      return res.status(409).json({
        error: 'Client delivery requires 100% REVIEWED tasks in this project',
        totalTasks: totalInProject,
        reviewedCount: reviewedInProject,
      });
    }

    const sample = await prisma.task.findFirst({
      where: { uploadBatchId: batchId },
      select: { projectName: true },
      orderBy: { id: 'asc' },
    });
    const projectName = sample?.projectName || batchId;

    const trainingTasks = [];
    let skip = 0;
    for (;;) {
      const chunk = await prisma.task.findMany({
        where: {
          uploadBatchId: batchId,
          status: { in: ['REVIEWED', 'COMPLETED'] },
        },
        select: {
          id: true,
          audioUrl: true,
          fileName: true,
          status: true,
          uploadBatchId: true,
          projectName: true,
        },
        orderBy: { id: 'asc' },
        skip,
        take: TRAINING_PAGE,
      });
      if (!chunk.length) break;

      const ids = chunk.map((t) => t.id);
      const annotations = await Annotation.find({ taskId: { $in: ids } })
        .select({ taskId: 1, isValid: 1, segments: 1 })
        .lean();

      const annById = new Map(annotations.map((a) => [a.taskId, a]));
      for (const t of chunk) {
        const ann = annById.get(t.id);
        if (!ann) continue;
        const valid = ann.isValid !== false;
        trainingTasks.push({
          taskId: t.id,
          batchId: t.uploadBatchId,
          projectName: t.projectName || projectName,
          audioUrl: t.audioUrl,
          fileName: t.fileName,
          taskStatus: t.status,
          isValid: valid,
          segments: valid ? segmentsToTrainingArray(ann.segments) : segmentsToTrainingArray(ann.segments || []),
        });
      }
      skip += TRAINING_PAGE;
    }

    if (trainingTasks.length !== totalInProject) {
      return res.status(409).json({
        error: 'Some tasks in this project are missing MongoDB annotations. Complete annotation sync before export.',
        expectedTasks: totalInProject,
        exportedTasks: trainingTasks.length,
      });
    }

    const validCount = trainingTasks.filter((x) => x.isValid).length;
    const invalidCount = trainingTasks.length - validCount;
    const exportDate = new Date().toISOString();

    const finalSummary = {
      projectName,
      batchId,
      totalTasks: trainingTasks.length,
      validCount,
      invalidCount,
      exportDate,
    };

    const bodyForHash = {
      exportType: 'client-master-delivery',
      exportVersion: '3.0',
      finalSummary,
      tasks: trainingTasks,
    };
    const masterChecksum = sha256Json({ ...bodyForHash, exportDate });
    res.json({
      ...bodyForHash,
      exportDate,
      masterChecksum,
      checksumAlgorithm: 'SHA-256',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/export-batch/:batchId', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const batchId = req.params.batchId;
    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }
    const tasks = await prisma.task.findMany({
      where: {
        uploadBatchId: batchId,
        status: { in: ['COMPLETED', 'REVIEWED'] },
      },
      orderBy: { id: 'asc' },
    });
    const merged = [];
    for (const task of tasks) {
      const annotation = await Annotation.findOne({ taskId: task.id });
      if (!annotation) continue;
      const exportData = await buildExportData(annotation, task);
      merged.push({
        ...exportData,
        segmentAuditTrail: buildSegmentAuditTrail(exportData.segments),
      });
    }
    const exportedAt = new Date().toISOString();
    const bodyForHash = {
      exportVersion: '2.0',
      bundleType: 'admin-batch-client',
      batchId,
      uploadBatchId: batchId,
      projectInfo: { batchId, uploadBatchId: batchId },
      taskCount: merged.length,
      tasks: merged,
    };
    const bundleChecksum = sha256Json({ ...bodyForHash, exportedAt });
    res.json({
      ...bodyForHash,
      exportedAt,
      bundleChecksum,
      checksumAlgorithm: 'SHA-256',
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/tasks/:taskId/recheck', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const annotation = await Annotation.findOne({ taskId });
    if (!annotation) {
      return res.status(404).json({ error: 'No annotation for this task' });
    }
    if (!['COMPLETED', 'REVIEWED'].includes(task.status)) {
      return res.status(400).json({
        error: 'Only completed or reviewed tasks can be sent back for recheck',
      });
    }

    await prisma.task.update({ where: { id: taskId }, data: { status: 'PENDING' } });
    annotation.reviewedAt = null;
    annotation.reviewerId = null;
    annotation.reviewerEmail = null;
    annotation.reviewerName = null;
    annotation.status = 'SUBMITTED';
    await annotation.save();

    const updatedTask = await prisma.task.findUnique({ where: { id: taskId } });
    res.json({
      message:
        'Task returned for recheck (PENDING). Export JSON still parses in the reviewer tool; after edits, the reviewer can save when the task is eligible.',
      task: updatedTask,
      notificationHint: {
        audience: ['REVIEWER', 'ANNOTATOR'],
        taskId,
        action: 'RECHECK_REQUESTED',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/tasks/:taskId/annotation-export', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }
    const [annotation, task] = await Promise.all([
      Annotation.findOne({ taskId }),
      prisma.task.findUnique({ where: { id: taskId } }),
    ]);
    if (!annotation || !task) {
      return res.status(404).json({ error: 'Annotation or task not found' });
    }
    const exportData = await buildExportData(annotation, task);
    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

router.patch('/tasks/:taskId/decision', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }
    const { decision } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approve" or "reject"' });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const annotation = await Annotation.findOne({ taskId });
    if (!annotation) {
      return res.status(404).json({ error: 'No annotation for this task' });
    }

    if (decision === 'reject') {
      await prisma.task.update({ where: { id: taskId }, data: { status: 'PENDING' } });
      annotation.status = 'DRAFT';
      annotation.submittedAt = undefined;
      await annotation.save();
      const updatedTask = await prisma.task.findUnique({ where: { id: taskId } });
      return res.json({
        message: 'Task returned to pending for the original annotator to fix.',
        task: updatedTask,
      });
    }

    await prisma.task.update({ where: { id: taskId }, data: { status: 'REVIEWED' } });
    annotation.status = 'REVIEWED';
    annotation.reviewedAt = annotation.reviewedAt || new Date();
    await annotation.save();
    const updatedTask = await prisma.task.findUnique({ where: { id: taskId } });
    res.json({
      message: 'Task marked as reviewed.',
      task: updatedTask,
    });
  } catch (error) {
    next(error);
  }
});

// Delete user (admin only)
router.delete('/users/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'ADMIN') return res.status(400).json({ error: 'Cannot delete admin accounts' });

    // Remove their assignments first
    await prisma.assignment.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });

    res.json({ message: `User ${user.name} deleted` });
  } catch (error) {
    next(error);
  }
});

export default router;