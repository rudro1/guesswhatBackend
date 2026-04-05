export const errorHandler = (err, req, res, next) => {
  console.error('[Error]', err.stack || err.message);

  if (err.name === 'MulterError') {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Uploaded file exceeds the maximum allowed size'
        : err.message || 'Multipart upload error';
    return res.status(400).json({ error: msg });
  }

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

  let message;
  if (status < 500) {
    message = err.message || 'Request failed';
  } else if (process.env.NODE_ENV === 'production') {
    message = 'Internal server error';
  } else {
    message = err.message || 'Internal server error';
  }

  res.status(status).json({ error: message });
};
