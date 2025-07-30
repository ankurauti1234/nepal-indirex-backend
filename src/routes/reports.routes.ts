import { Router } from 'express';
import { generateReport } from '../controllers/reports.controller';

const router = Router();

router.get('/', generateReport);

export default router;