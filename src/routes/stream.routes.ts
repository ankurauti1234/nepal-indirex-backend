import { Router } from 'express';
import { 
  getEvents, 
  getImageProcessingEvents, 
  getUnrecognizedEvents, 
  labelEvent, 
  getLabeledEvents 
} from '../controllers/stream.controller';

const router = Router();

// Existing route
router.get('/events', getEvents);

// New routes for image processing events
router.get('/events/image-processing', getImageProcessingEvents);
router.get('/events/unrecognized', getUnrecognizedEvents);

// Routes for labeled events
router.post('/events/label', labelEvent);
router.get('/events/labeled', getLabeledEvents);

export default router;