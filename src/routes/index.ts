import { Router } from 'express';
import healthRoutes from './health';
import authRoutes from './auth.routes';
import streamRoutes from './stream.routes';
import reportsRoutes from './reports.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/stream', streamRoutes);
router.use('/reports', reportsRoutes);

export default router;