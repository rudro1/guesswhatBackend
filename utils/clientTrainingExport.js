export function segmentToTrainingPlain(seg) {
  const s = seg?.toObject?.() ?? seg;
  if (!s) return null;
  const df = s.dynamicFields;
  const dynamicFields =
    df instanceof Map ? Object.fromEntries(df) : { ...(df || {}) };
  return {
    startTime: s.startTime,
    endTime: s.endTime,
    category: s.category,
    transcription: s.transcription ?? null,
    speaker: s.speaker ?? null,
    dynamicFields,
  };
}

export function segmentsToTrainingArray(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.map(segmentToTrainingPlain).filter(Boolean);
}
