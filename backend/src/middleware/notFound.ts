import type { RequestHandler } from 'express';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Route not found.',
    },
  });
};
