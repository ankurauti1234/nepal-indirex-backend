import { Request, Response } from 'express';
import { ApiResponse } from '../types';

export const notFound = (req: Request, res: Response<ApiResponse>): void => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
};
