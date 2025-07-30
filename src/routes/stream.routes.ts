import { Router } from 'express';
import { 
  getEvents, 
  labelEvent, 
  getLabeledEvents,
  getManuallyLabeledEvents,
} from '../controllers/stream.controller';

const router = Router();

router.get('/events', getEvents);
router.post('/events/label', labelEvent);
router.get('/events/labeled', getLabeledEvents);
router.get('/events/manually-labeled', getManuallyLabeledEvents);

export default router;