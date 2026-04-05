import prisma from '../config/prisma.js';
import Annotation from '../models/Annotation.js';

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

/**
 * GET /api/tasks (admin) — paginated task list.
 */
export async function getTasks(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(500, parsePositiveInt(req.query.limit, 50));
    const skip = (page - 1) * limit;

    const where = {};
    if (req.query.status && typeof req.query.status === 'string') {
      where.status = req.query.status.toUpperCase();
    }
    if (req.query.batchId && typeof req.query.batchId === 'string') {
      where.uploadBatchId = req.query.batchId.trim();
    }

    const [tasksResult, totalResult] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'asc' },
      }),
      prisma.task.count({ where }),
    ]);

    const tasks = Array.isArray(tasksResult) ? tasksResult : [];
    const total = typeof totalResult === 'number' ? totalResult : 0;
    const pages = Math.max(1, Math.ceil(total / limit) || 1);

    return res.json({
      tasks,
      total,
      page,
      pages,
    });
  } catch (error) {
    console.error('DB_ERROR:', error.message);
    return res.status(500).json({
      error: 'Failed to load tasks. Check database connection and migrations.',
    });
  }
}

/**
 * GET /api/admin/batches — grouped upload batches / projects.
 */
export async function getBatches(req, res) {
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

    const list = Array.isArray(rows) ? rows : [];
    const batches = list.map((r) => {
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

    return res.json({ batches });
  } catch (error) {
    console.error('DB_ERROR:', error.message);
    return res.status(500).json({
      error:
        'Failed to load batches. Ensure DATABASE_URL is set and Prisma migrations are applied (including Task.projectName).',
    });
  }
}

/**
 * GET /api/admin/monitoring-tasks
 */
export async function getMonitoringTasks(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(500, Math.max(1, parsePositiveInt(req.query.limit, 200)));
    const skip = (page - 1) * limit;

    const batchId =
      typeof req.query.batchId === 'string' && req.query.batchId.trim()
        ? req.query.batchId.trim()
        : null;
    const where = batchId ? { uploadBatchId: batchId } : {};

    const [tasksResult, totalResult] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'asc' },
      }),
      prisma.task.count({ where }),
    ]);

    const tasks = Array.isArray(tasksResult) ? tasksResult : [];
    const total = typeof totalResult === 'number' ? totalResult : 0;

    const taskIds = tasks.map((t) => t.id);
    let annotations = [];
    if (taskIds.length > 0) {
      try {
        annotations = await Annotation.find({ taskId: { $in: taskIds } }).lean();
      } catch (mongoErr) {
        console.error('DB_ERROR:', mongoErr.message);
        annotations = [];
      }
    }
    if (!Array.isArray(annotations)) annotations = [];

    const annByTask = new Map(annotations.map((a) => [a.taskId, a]));
    const userIds = [
      ...new Set(annotations.flatMap((a) => [a.annotatorId, a.reviewerId].filter(Boolean))),
    ];

    let users = [];
    if (userIds.length > 0) {
      try {
        users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        });
      } catch (userErr) {
        console.error('DB_ERROR:', userErr.message);
        users = [];
      }
    }
    if (!Array.isArray(users)) users = [];

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

    return res.json({
      tasks: rows,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error('DB_ERROR:', error.message);
    return res.status(500).json({
      error: 'Failed to load monitoring tasks.',
    });
  }
}
