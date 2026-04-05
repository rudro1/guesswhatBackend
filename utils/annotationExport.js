import { createHash } from 'crypto';
import prisma from '../config/prisma.js';

export function sha256Json(obj) {
  const stable = JSON.stringify(obj);
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}

export function segmentToPlain(seg) {
  const s = seg?.toObject?.() ?? seg;
  if (!s) return null;
  const df = s.dynamicFields;
  const dynamicFields =
    df instanceof Map ? Object.fromEntries(df) : { ...(df || {}) };
  return {
    segmentId: s.segmentId,
    startTime: s.startTime,
    endTime: s.endTime,
    category: s.category,
    speaker: s.speaker ?? null,
    transcription: s.transcription ?? null,
    fillerWords: s.fillerWords || [],
    dynamicFields,
    annotatedBy: s.annotatedBy,
    annotatedAt: s.annotatedAt,
    reviewChanges: s.reviewChanges || [],
  };
}

export async function attachTemplateConfig(exportData) {
  if (!exportData.templateId) return exportData;
  const tmpl = await prisma.template.findUnique({
    where: { id: exportData.templateId },
    select: { parsedConfig: true },
  });
  if (tmpl?.parsedConfig) {
    exportData.templateConfig = tmpl.parsedConfig;
  }
  return exportData;
}

export async function buildExportData(annotation, task, options = {}) {
  const ann = annotation?.toObject?.() ?? annotation;
  const taskRow = task?.toJSON?.() ?? task;

  const uploadBatchId = taskRow.uploadBatchId ?? '';

  const annotator = await prisma.user.findUnique({
    where: { id: ann.annotatorId },
    select: { id: true, email: true, name: true, role: true },
  });

  let reviewer = null;
  if (ann.reviewerId) {
    reviewer = await prisma.user.findUnique({
      where: { id: ann.reviewerId },
      select: { id: true, email: true, name: true, role: true },
    });
  }

  const rawSegments = ann.segments;
  const segmentsPlain = Array.isArray(rawSegments)
    ? rawSegments.map((seg) => segmentToPlain(seg))
    : [];

  const annotatorName =
    ann.annotatorName || annotator?.name || 'Unknown';
  const annotatorEmail =
    ann.annotatorEmail || annotator?.email || null;
  const reviewerNameResolved =
    ann.reviewerName || reviewer?.name || null;
  const reviewerEmailResolved =
    ann.reviewerEmail || reviewer?.email || null;

  const exportData = {
    exportVersion: '2.0',
    exportedAt: new Date().toISOString(),
    taskId: taskRow.id,
    audioUrl: taskRow.audioUrl ?? '',
    fileName: taskRow.fileName ?? '',
    uploadBatchId,
    batchId: uploadBatchId,
    projectName: taskRow.projectName || uploadBatchId || 'Unnamed project',
    projectInfo: {
      batchId: uploadBatchId,
      uploadBatchId,
      projectName: taskRow.projectName || uploadBatchId || 'Unnamed project',
    },
    originalFormat: taskRow.originalFormat,
    fileSize: taskRow.fileSize,
    checksum: taskRow.checksum,
    checksumAlgorithm: 'SHA-256',
    taskStatus: taskRow.status,
    isValid: ann.isValid,
    templateId: ann.templateId || null,
    annotationStatus: ann.status,
    annotatorId: ann.annotatorId,
    annotator: annotator || { id: ann.annotatorId, name: annotatorName, email: annotatorEmail, role: null },
    annotatorName,
    annotatorEmail,
    submittedAt: ann.submittedAt ? new Date(ann.submittedAt).toISOString() : null,
    reviewerId: ann.reviewerId || null,
    reviewer: reviewer,
    reviewerName: reviewerNameResolved,
    reviewerEmail: reviewerEmailResolved,
    reviewedAt: ann.reviewedAt ? new Date(ann.reviewedAt).toISOString() : null,
    segments: segmentsPlain,
    ...(options.extraFields || {}),
  };

  const withTemplate = await attachTemplateConfig(exportData);
  const { exportedAt: _ea, ...forHash } = withTemplate;
  withTemplate.exportChecksum = sha256Json(forHash);
  return withTemplate;
}

export function buildSegmentAuditTrail(segmentsPlain) {
  if (!Array.isArray(segmentsPlain)) return [];
  return segmentsPlain.map((s) => ({
    segmentId: s.segmentId,
    annotatedBy: s.annotatedBy ?? null,
    annotatedAt: s.annotatedAt
      ? (s.annotatedAt instanceof Date ? s.annotatedAt.toISOString() : s.annotatedAt)
      : null,
    reviewChanges: Array.isArray(s.reviewChanges) ? s.reviewChanges : [],
  }));
}
