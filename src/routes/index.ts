import { Router } from 'express';
import healthRoutes from './health';
import authRoutes from './auth.routes';
import streamRoutes from './stream.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/stream', streamRoutes);

export default router;