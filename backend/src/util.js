export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Wrap async express handlers so rejections hit the error middleware.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
