import prisma from '../config/prisma.js';
import Annotation from '../models/Annotation.js';

/** Columns safe on DBs that have not run `projectName` / index migrations yet */
const TASK_SELECT_CORE = {
  id: true,
  audioUrl: true,
  fileName: true,
  originalFormat: true,
  fileSize: true,
  checksum: true,
  status: true,
  uploadBatchId: true,
  createdAt: true,
};

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

async function findTasksPaged(where, skip, take, orderBy = { id: 'asc' }) {
  try {
    return await prisma.task.findMany({
      where,
      skip,
      take,
      orderBy,
      select: { ...TASK_SELECT_CORE, projectName: true },
    });
  } catch (err) {
    console.error('DB_ERROR:', err.message, '(retrying without projectName column)');
    try {
      return await prisma.task.findMany({
        where,
        skip,
        take,
        orderBy,
        select: TASK_SELECT_CORE,
      });
    } catch (err2) {
      console.error('DB_ERROR:', err2.message, '(task findMany failed)');
      return [];
    }
  }
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
      findTasksPaged(where, skip, limit),
      prisma.task.count({ where }).catch((cErr) => {
        console.error('DB_ERROR:', cErr.message, '(task count)');
        return 0;
      }),
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

function buildBatchesFromTaskRows(taskRows) {
  const agg = new Map();
  for (const t of taskRows) {
    const bid = t.uploadBatchId;
    if (!agg.has(bid)) {
      agg.set(bid, {
        uploadBatchId: bid,
        minId: t.id,
        totalTasks: 0,
        annotatedCount: 0,
        reviewedCount: 0,
        remainingCount: 0,
        projectName: t.projectName || null,
      });
    }
    const g = agg.get(bid);
    g.minId = Math.min(g.minId, t.id);
    g.totalTasks += 1;
    if (t.projectName && !g.projectName) g.projectName = t.projectName;
    const st = t.status;
    if (st === 'COMPLETED' || st === 'REVIEWED') g.annotatedCount += 1;
    if (st === 'REVIEWED') g.reviewedCount += 1;
    if (st === 'PENDING' || st === 'IN_PROGRESS') g.remainingCount += 1;
  }
  const sorted = [...agg.values()].sort((a, b) => a.minId - b.minId);
  return sorted.map((g) => {
    const total = g.totalTasks || 0;
    const reviewed = g.reviewedCount || 0;
    const batchName = g.projectName || g.uploadBatchId || 'Unnamed batch';
    const clientReadinessPct = total > 0 ? Math.round((reviewed / total) * 1000) / 10 : 0;
    const fullyReviewed = total > 0 && reviewed === total;
    return {
      uploadBatchId: g.uploadBatchId,
      batchName,
      totalTasks: total,
      annotatedCount: g.annotatedCount,
      reviewedCount: reviewed,
      remainingCount: g.remainingCount,
      clientReadinessPct,
      fullyReviewed,
    };
  });
}

async function batchesAggregateJsFallback() {
  try {
    const rows = await prisma.task.findMany({
      select: { id: true, uploadBatchId: true, status: true, projectName: true },
      orderBy: { id: 'asc' },
    });
    return buildBatchesFromTaskRows(rows);
  } catch (err) {
    console.error('DB_ERROR:', err.message, '(batches: JS fallback without projectName)');
    const rows = await prisma.task.findMany({
      select: { id: true, uploadBatchId: true, status: true },
      orderBy: { id: 'asc' },
    });
    return buildBatchesFromTaskRows(rows);
  }
}

/**
 * GET /api/admin/batches — grouped upload batches / projects.
 * Uses Prisma only (no raw SQL) so Postgres enum/column quirks on Render do not break the route.
 */
export async function getBatches(req, res) {
  try {
    const batches = await batchesAggregateJsFallback();
    return res.json({ batches: Array.isArray(batches) ? batches : [] });
  } catch (error) {
    console.error('DB_ERROR:', error.message);
    return res.status(500).json({
      error: 'Failed to load batches. Check DATABASE_URL and that the Task table exists.',
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
      findTasksPaged(where, skip, limit),
      prisma.task.count({ where }).catch((cErr) => {
        console.error('DB_ERROR:', cErr.message, '(monitoring task count)');
        return 0;
      }),
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
