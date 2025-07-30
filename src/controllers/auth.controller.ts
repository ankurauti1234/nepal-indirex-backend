import { Request, Response } from 'express';
import { ApiResponse } from '../types';
import * as authService from '../services/auth.service';
import { logger } from '../utils/logger';

// Manual validation for register
const validateRegister = (body: any): { isValid: boolean; error?: string } => {
  if (!body || typeof body !== 'object') {
    return { isValid: false, error: 'Request body is missing or invalid' };
  }
  const { email, password, name, deviceId } = body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { isValid: false, error: 'Valid email is required' };
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long' };
  }
  if (name && (typeof name !== 'string' || name.length < 1)) {
    return { isValid: false, error: 'Name must be a non-empty string if provided' };
  }
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 1) {
    return { isValid: false, error: 'Device ID is required and must be a non-empty string' };
  }
  return { isValid: true };
};

// Manual validation for login
const validateLogin = (body: any): { isValid: boolean; error?: string } => {
  if (!body || typeof body !== 'object') {
    return { isValid: false, error: 'Request body is missing or invalid' };
  }
  const { email, password } = body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { isValid: false, error: 'Valid email is required' };
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long' };
  }
  return { isValid: true };
};

export const register = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
  try {
    logger.info('Register request body:', req.body); // Debug log
    const validation = validateRegister(req.body);
    if (!validation.isValid) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: validation.error ?? 'Unknown validation error',
      });
      return;
    }

    const { user, token } = await authService.register(req.body);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: { user, token },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const login = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
  try {
    logger.info('Login request body:', req.body); // Debug log
    const validation = validateLogin(req.body);
    if (!validation.isValid) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: validation.error ?? 'Unknown validation error',
      });
      return;
    }

    const { user, token } = await authService.login(req.body);
    
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: { user, token },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(401).json({
      success: false,
      message: 'Login failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};