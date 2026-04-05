export const errorHandler = (err, req, res, next) => {
  console.error('[Error]', err.stack || err.message);

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Resource already exists' });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Resource not found' });
  }

  const status =
    err.status ||
    err.statusCode ||
    (err.code === 'LIMIT_FILE_SIZE' ? 400 : null) ||
    500;
  const message = err.message || 'Internal server error';

  res.status(status).json({ error: message });
};
