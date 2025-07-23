import { Router } from 'express';
import { 
  getEvents, 
  getImageProcessingEvents, 
  getUnrecognizedEvents, 
  labelEvent, 
  getLabeledEvents,
  getManuallyLabeledEvents,
} from '../controllers/stream.controller';

const router = Router();

router.get('/events', getEvents);
router.get('/events/image-processing', getImageProcessingEvents);
router.get('/events/unrecognized', getUnrecognizedEvents);
router.post('/events/label', labelEvent);
router.get('/events/labeled', getLabeledEvents);
router.get('/events/manually-labeled', getManuallyLabeledEvents);

export default router;