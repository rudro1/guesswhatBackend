import express from 'express';
import prisma from '../config/prisma.js';
import Annotation from '../models/Annotation.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { buildExportData, segmentToPlain, attachTemplateConfig } from '../utils/annotationExport.js';

const router = express.Router();

async function loadTask(taskId) {
  return prisma.task.findUnique({ where: { id: taskId } });
}

async function assertCanReadAnnotation(req, taskId, annotation) {
  const role = req.user.role;
  const uid = req.user.userId;
  const task = await loadTask(taskId);
  if (!task) {
    const e = new Error('Task not found');
    e.status = 404;
    throw e;
  }
  if (role === 'ADMIN') return task;
  if (role === 'ANNOTATOR') {
    const assignment = await prisma.assignment.findFirst({ where: { userId: uid } });
    if (!assignment || taskId < assignment.startTaskId || taskId > assignment.endTaskId) {
      const e = new Error('Task not in your assignment range');
      e.status = 403;
      throw e;
    }
    if (annotation.annotatorId !== uid) {
      const e = new Error('Not authorized to view this annotation');
      e.status = 403;
      throw e;
    }
    return task;
  }
  if (role === 'REVIEWER') {
    const recheckEligible =
      task.status === 'PENDING' &&
      annotation.status === 'SUBMITTED' &&
      !annotation.reviewedAt;
    if (!['COMPLETED', 'REVIEWED'].includes(task.status) && !recheckEligible) {
      const e = new Error('Task is not available for review');
      e.status = 403;
      throw e;
    }
    return task;
  }
  const e = new Error('Forbidden');
  e.status = 403;
  throw e;
}

function plainAnnotationResponse(annotation, task) {
  const ann = annotation.toObject ? annotation.toObject() : annotation;
  return {
    taskId: ann.taskId,
    isValid: ann.isValid,
    annotatorId: ann.annotatorId,
    annotatorEmail: ann.annotatorEmail || null,
    annotatorName: ann.annotatorName || null,
    reviewerId: ann.reviewerId || null,
    reviewerEmail: ann.reviewerEmail || null,
    reviewerName: ann.reviewerName || null,
    templateId: ann.templateId || null,
    status: ann.status,
    segments: (ann.segments || []).map((s) => segmentToPlain(s)),
    submittedAt: ann.submittedAt,
    reviewedAt: ann.reviewedAt,
    createdAt: ann.createdAt,
    updatedAt: ann.updatedAt,
    task: task
      ? {
          id: task.id,
          audioUrl: task.audioUrl,
          fileName: task.fileName,
          originalFormat: task.originalFormat,
          fileSize: task.fileSize,
          status: task.status,
        }
      : null,
  };
}

router.post('/', authenticate, authorize('ANNOTATOR'), async (req, res, next) => {
  try {
    const { taskId, isValid, templateId, segments, status } = req.body;
    const annotatorId = req.user.userId;

    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }

    const assignment = await prisma.assignment.findFirst({ where: { userId: annotatorId } });
    if (!assignment || taskId < assignment.startTaskId || taskId > assignment.endTaskId) {
      return res.status(403).json({ error: 'Task not in your assignment range' });
    }

    const now = new Date();
    const annotatorEmail = req.user.email || undefined;
    const annotatorName = req.user.name || undefined;
    const enrichedSegments = (segments || []).map((seg) => ({
      ...seg,
      annotatedBy: annotatorId,
      annotatedAt: seg.annotatedAt || now,
    }));

    let annotation = await Annotation.findOne({ taskId });

    if (annotation) {
      annotation.isValid = isValid !== undefined ? isValid : annotation.isValid;
      annotation.templateId = templateId || annotation.templateId;
      annotation.segments = enrichedSegments;
      annotation.annotatorEmail = annotatorEmail || annotation.annotatorEmail;
      annotation.annotatorName = annotatorName || annotation.annotatorName;
      if (status) annotation.status = status;
      if (status === 'SUBMITTED') {
        annotation.submittedAt = now;
        annotation.annotatorEmail = annotatorEmail;
        annotation.annotatorName = annotatorName;
      }
      await annotation.save();
    } else {
      annotation = await Annotation.create({
        taskId,
        isValid: isValid !== undefined ? isValid : true,
        annotatorId,
        annotatorEmail,
        annotatorName,
        templateId,
        segments: enrichedSegments,
        status: status || 'DRAFT',
        submittedAt: status === 'SUBMITTED' ? now : undefined,
      });
    }

    if (status === 'SUBMITTED') {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'COMPLETED' },
      });
    } else if (status === 'DRAFT') {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'IN_PROGRESS' },
      });
    }

    const task = await loadTask(taskId);
    res.json(plainAnnotationResponse(annotation, task));
  } catch (error) {
    next(error);
  }
});

router.get('/export/my-tasks', authenticate, authorize('ANNOTATOR'), async (req, res, next) => {
  try {
    const annotatorId = req.user.userId;
    const user = await prisma.user.findUnique({
      where: { id: annotatorId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    const annotations = await Annotation.find({
      annotatorId,
      status: { $in: ['SUBMITTED', 'REVIEWED'] },
    })
      .sort({ taskId: 1 })
      .lean();

    const taskIds = annotations.map((a) => a.taskId);
    const tasks = await prisma.task.findMany({ where: { id: { in: taskIds } } });
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    const tasksPayload = [];
    for (const ann of annotations) {
      const task = taskById.get(ann.taskId);
      if (!task) continue;
      tasksPayload.push(await buildExportData(ann, task, { extraFields: { annotator: user } }));
    }

    const bundle = {
      exportVersion: '2.0',
      bundleType: 'annotator-all-tasks',
      exportedAt: new Date().toISOString(),
      annotator: user,
      taskCount: tasksPayload.length,
      tasks: tasksPayload,
    };

    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

router.get('/export/:taskId', authenticate, async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const [annotation, task] = await Promise.all([
      Annotation.findOne({ taskId }),
      loadTask(taskId),
    ]);

    if (!annotation || !task) {
      return res.status(404).json({ error: 'Annotation or task not found' });
    }

    await assertCanReadAnnotation(req, taskId, annotation);

    const exportData = await buildExportData(annotation, task);
    annotation.exportedAt = new Date();
    await annotation.save();

    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

router.patch('/review/:taskId', authenticate, authorize('REVIEWER'), async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }
    const { segments } = req.body;
    const reviewerId = req.user.userId;
    const reviewerName = req.user.name || 'Reviewer';
    const reviewerEmail = req.user.email || undefined;

    const [task, annotation] = await Promise.all([
      loadTask(taskId),
      Annotation.findOne({ taskId }),
    ]);
    if (!task || !annotation) {
      return res.status(404).json({ error: 'Task or annotation not found' });
    }
    const recheckOk =
      task.status === 'PENDING' &&
      annotation.status === 'SUBMITTED' &&
      !annotation.reviewedAt;
    if (!['COMPLETED', 'REVIEWED'].includes(task.status) && !recheckOk) {
      return res.status(403).json({ error: 'You can only review completed tasks' });
    }

    const now = new Date();
    const oldSegmentsMap = {};
    annotation.segments.forEach((seg) => {
      oldSegmentsMap[seg.segmentId] = seg.toObject();
    });

    const dynPlain = (d) => {
      if (!d) return {};
      if (d instanceof Map) return Object.fromEntries(d);
      return { ...d };
    };

    const updatedSegments = (segments || []).map((newSeg) => {
      const oldSeg = oldSegmentsMap[newSeg.segmentId];
      if (!oldSeg) return { ...newSeg, reviewChanges: newSeg.reviewChanges || [] };

      const reviewChanges = [...(oldSeg.reviewChanges || [])];
      const fieldsToTrack = ['category', 'speaker', 'transcription', 'fillerWords'];

      for (const field of fieldsToTrack) {
        const oldVal = oldSeg[field];
        const newVal = newSeg[field];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          reviewChanges.push({
            reviewerId,
            reviewerName,
            field,
            oldValue: oldVal,
            newValue: newVal,
            changedAt: now,
          });
        }
      }

      const oldDynamic = dynPlain(oldSeg.dynamicFields);
      const newDynamic = dynPlain(newSeg.dynamicFields);
      const allKeys = new Set([...Object.keys(oldDynamic), ...Object.keys(newDynamic)]);
      for (const key of allKeys) {
        const oldVal = oldDynamic[key];
        const newVal = newDynamic[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          reviewChanges.push({
            reviewerId,
            reviewerName,
            field: `dynamicFields.${key}`,
            oldValue: oldVal,
            newValue: newVal,
            changedAt: now,
          });
        }
      }

      return { ...newSeg, reviewChanges };
    });

    annotation.segments = updatedSegments;
    annotation.reviewerId = reviewerId;
    annotation.reviewerName = reviewerName;
    annotation.reviewerEmail = reviewerEmail;
    annotation.status = 'REVIEWED';
    annotation.reviewedAt = now;
    await annotation.save();

    await prisma.task.update({ where: { id: taskId }, data: { status: 'REVIEWED' } });

    const t = await loadTask(taskId);
    res.json(plainAnnotationResponse(annotation, t));
  } catch (error) {
    next(error);
  }
});

router.get('/task/:taskId', authenticate, async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task id' });
    }
    const annotation = await Annotation.findOne({ taskId });
    if (!annotation) {
      return res.status(404).json({ error: 'Annotation not found' });
    }
    const task = await assertCanReadAnnotation(req, taskId, annotation);
    res.json(plainAnnotationResponse(annotation, task));
  } catch (error) {
    next(error);
  }
});

router.get('/:taskId(\\d+)', authenticate, async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const annotation = await Annotation.findOne({ taskId });
    if (!annotation) {
      return res.status(404).json({ error: 'Annotation not found' });
    }
    const task = await assertCanReadAnnotation(req, taskId, annotation);
    res.json(plainAnnotationResponse(annotation, task));
  } catch (error) {
    next(error);
  }
});

export default router;
