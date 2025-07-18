import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import apiRoutes from './routes';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware to capture raw body
app.use((req, res, next) => {
  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk;
  });
  req.on('end', () => {
    logger.info('Raw request body (pre-parsing):', rawBody);
    try {
      req.body = JSON.parse(rawBody);
    } catch (error) {
      logger.error('Failed to parse raw body:', error);
      req.body = {};
    }
    next();
  });
});

// Standard middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' })); // Increased limit for testing
app.use(express.urlencoded({ extended: true }));

// Debug middleware to log parsed body
app.use((req, res, next) => {
  logger.info('Parsed request body:', req.body);
  next();
});


// API routes
app.use(process.env.API_PREFIX || '/api/v1', apiRoutes);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📖 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;