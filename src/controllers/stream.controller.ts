import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '../types';
import { S3Client, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { Prisma } from '@prisma/client';

interface EventFilter {
  deviceId?: string;
  type?: { in: number[] };
}

// Define the expected structure for event details
interface EventDetails {
  score: number;
  image_path: string;
  channel_name: string;
  brand_name?: string;
  advertiser?: string;
  labels?: string[];
}

interface LabeledEvent {
  id: number;
  deviceId: string;
  timestamp: string;
  type: number;
  details: EventDetails;
  createdAt: string;
}

interface LabelEventRequest {
  eventId: number;
  labels: string[];
  labeledBy?: string;
}

const region = process.env.AWS_REGION;
if (!region) {
  throw new Error('AWS_REGION environment variable is not set');
}

const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const S3_BUCKET = process.env.S3_BUCKET || 'apm-captured-images';

// Helper function to validate and cast event details
function validateEventDetails(details: Prisma.JsonValue): EventDetails | null {
  if (
    details &&
    typeof details === 'object' &&
    'score' in details &&
    typeof details.score === 'number' &&
    'image_path' in details &&
    typeof details.image_path === 'string' &&
    'channel_name' in details &&
    typeof details.channel_name === 'string'
  ) {
    return details as unknown as EventDetails;
  }
  return null;
}

// Helper function to extract S3 key from image path
function extractS3Key(imagePath: string): string {
  const url = new URL(imagePath);
  return url.pathname.substring(1); // Remove leading slash
}

// Helper function to generate labeled image path
function generateLabeledImagePath(originalPath: string, deviceId: string, timestamp: string): string {
  const originalKey = extractS3Key(originalPath);
  const pathParts = originalKey.split('/');
  
  // Replace the folder structure for labeled images
  const labeledKey = originalKey.replace(
    /Nepal_Frames\/(unrecognized_frames|analayzed_frames)/,
    'Nepal_Frames/labeled_frames'
  );
  
  return `https://${S3_BUCKET}.s3.${region}.amazonaws.com/${labeledKey}`;
}

// Existing getEvents API
export const getEvents = async (
  req: Request,
  res: Response<PaginatedResponse<any>>
): Promise<void> => {
  try {
    logger.info('Get events request query:', req.query);

    const {
      deviceId,
      type,
      page = 1,
      limit = 10,
      sort = 'createdAt',
      order = 'desc',
    } = req.query as PaginationQuery & { deviceId?: string; type?: string };

    const pageNum = parseInt(page as unknown as string, 10) || 1;
    const limitNum = parseInt(limit as unknown as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;
    const validSortFields = ['id', 'timestamp', 'createdAt'];
    const sortField = validSortFields.includes(sort as string)
      ? sort
      : 'timestamp';
    const orderDirection = order === 'asc' ? 'asc' : 'desc';

    const filter: EventFilter = {};
    if (deviceId) {
      filter.deviceId = deviceId as string;
    }
    if (type) {
      const typeArray = (type as string)
        .split(',')
        .map((t) => parseInt(t.trim(), 10));
      if (typeArray.some(isNaN)) {
        res.status(400).json({
          success: false,
          message: 'Invalid type parameter',
          error: 'All types must be valid numbers',
          pagination: {
            page: 0,
            limit: 0,
            total: 0,
            pages: 0,
          },
        });
        return;
      }
      filter.type = { in: typeArray };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: filter,
        orderBy: { [sortField]: orderDirection },
        skip,
        take: limitNum,
        select: {
          id: true,
          deviceId: true,
          timestamp: true,
          type: true,
          details: true,
          createdAt: true,
        },
      }),
      prisma.event.count({ where: filter }),
    ]);

    const serializedEvents = events.map((event) => ({
      ...event,
      timestamp: event.timestamp.toString(),
      details: validateEventDetails(event.details) || event.details,
    }));

    res.status(200).json({
      success: true,
      message: 'Events fetched successfully',
      data: serializedEvents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('Error fetching events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events',
      error: error instanceof Error ? error.message : 'Unknown error',
      pagination: {
        page: 0,
        limit: 0,
        total: 0,
        pages: 0,
      },
    });
  }
};

// New API to get image processing events (types 29 and 33)
export const getImageProcessingEvents = async (
  req: Request,
  res: Response<PaginatedResponse<any>>
): Promise<void> => {
  try {
    logger.info('Get image processing events request query:', req.query);

    const {
      deviceId,
      page = 1,
      limit = 10,
      sort = 'createdAt',
      order = 'desc',
    } = req.query as PaginationQuery & { deviceId?: string };

    const pageNum = parseInt(page as unknown as string, 10) || 1;
    const limitNum = parseInt(limit as unknown as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;
    const validSortFields = ['id', 'timestamp', 'createdAt'];
    const sortField = validSortFields.includes(sort as string)
      ? sort
      : 'timestamp';
    const orderDirection = order === 'asc' ? 'asc' : 'desc';

    const filter: EventFilter = {
      type: { in: [33, 29] }, // Image processing event types
    };
    
    if (deviceId) {
      filter.deviceId = deviceId as string;
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: filter,
        orderBy: { [sortField]: orderDirection },
        skip,
        take: limitNum,
        select: {
          id: true,
          deviceId: true,
          timestamp: true,
          type: true,
          details: true,
          createdAt: true,
        },
      }),
      prisma.event.count({ where: filter }),
    ]);

    const serializedEvents = events.map((event) => ({
      ...event,
      timestamp: event.timestamp.toString(),
      details: validateEventDetails(event.details) || event.details,
      processing_type: event.type === 29 ? 'recognized' : 'processed',
    }));

    res.status(200).json({
      success: true,
      message: 'Image processing events fetched successfully',
      data: serializedEvents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('Error fetching image processing events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch image processing events',
      error: error instanceof Error ? error.message : 'Unknown error',
      pagination: {
        page: 0,
        limit: 0,
        total: 0,
        pages: 0,
      },
    });
  }
};

// New API to get unrecognized events (type 33)
export const getUnrecognizedEvents = async (
  req: Request,
  res: Response<PaginatedResponse<any>>
): Promise<void> => {
  try {
    logger.info('Get unrecognized events request query:', req.query);

    const {
      deviceId,
      page = 1,
      limit = 10,
      sort = 'createdAt',
      order = 'desc',
    } = req.query as PaginationQuery & { deviceId?: string };

    const pageNum = parseInt(page as unknown as string, 10) || 1;
    const limitNum = parseInt(limit as unknown as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;
    const validSortFields = ['id', 'timestamp', 'createdAt'];
    const sortField = validSortFields.includes(sort as string)
      ? sort
      : 'timestamp';
    const orderDirection = order === 'asc' ? 'asc' : 'desc';

    const filter: EventFilter = {
      type: { in: [33] }, // Unrecognized event type
    };
    
    if (deviceId) {
      filter.deviceId = deviceId as string;
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: filter,
        orderBy: { [sortField]: orderDirection },
        skip,
        take: limitNum,
        select: {
          id: true,
          deviceId: true,
          timestamp: true,
          type: true,
          details: true,
          createdAt: true,
        },
      }),
      prisma.event.count({ where: filter }),
    ]);

    const serializedEvents = events.map((event) => ({
      ...event,
      timestamp: event.timestamp.toString(),
      details: validateEventDetails(event.details) || event.details,
      processing_type: 'unrecognized',
    }));

    res.status(200).json({
      success: true,
      message: 'Unrecognized events fetched successfully',
      data: serializedEvents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('Error fetching unrecognized events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unrecognized events',
      error: error instanceof Error ? error.message : 'Unknown error',
      pagination: {
        page: 0,
        limit: 0,
        total: 0,
        pages: 0,
      },
    });
  }
};

// New API to label an event and copy image to labeled folder
export const labelEvent = async (
  req: Request,
  res: Response<ApiResponse<any>>
): Promise<void> => {
  try {
    const { eventId, labels, labeledBy } = req.body as LabelEventRequest;

    if (!eventId || !labels || !Array.isArray(labels) || labels.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Event ID and labels are required',
        error: 'Invalid request body',
      });
      return;
    }

    // Find the original event
    const originalEvent = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!originalEvent) {
      res.status(404).json({
        success: false,
        message: 'Event not found',
        error: 'Event with the specified ID does not exist',
      });
      return;
    }

    const eventDetails = validateEventDetails(originalEvent.details);
    if (!eventDetails) {
      res.status(400).json({
        success: false,
        message: 'Invalid event details',
        error: 'Event details do not contain required image information',
      });
      return;
    }

    try {
      // Extract S3 key from original image path
      const originalKey = extractS3Key(eventDetails.image_path);
      
      // Generate new key for labeled image
      const labeledKey = originalKey.replace(
        /Nepal_Frames\/(unrecognized_frames|analayzed_frames)/,
        'Nepal_Frames/labeled_frames'
      );

      // Copy image to labeled folder in S3
      const copyCommand = new CopyObjectCommand({
        Bucket: S3_BUCKET,
        CopySource: `${S3_BUCKET}/${originalKey}`,
        Key: labeledKey,
      });

      await s3Client.send(copyCommand);

      // Create labeled event details
      const labeledEventDetails = {
        ...eventDetails,
        labels: labels,
        original_image_path: eventDetails.image_path,
        image_path: `https://${S3_BUCKET}.s3.${region}.amazonaws.com/${labeledKey}`,
      };

      // Create labeled event record
      const labeledEvent = await prisma.labeledEvent.create({
        data: {
          deviceId: originalEvent.deviceId,
          originalEventId: originalEvent.id,
          timestamp: originalEvent.timestamp,
          details: labeledEventDetails,
          labeledBy: labeledBy || null,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Event labeled successfully',
        data: {
          ...labeledEvent,
          timestamp: labeledEvent.timestamp.toString(),
        },
      });

    } catch (s3Error) {
      logger.error('S3 error during image copy:', s3Error);
      res.status(500).json({
        success: false,
        message: 'Failed to copy image to labeled folder',
        error: s3Error instanceof Error ? s3Error.message : 'S3 operation failed',
      });
      return;
    }

  } catch (error) {
    logger.error('Error labeling event:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to label event',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// New API to get labeled events
export const getLabeledEvents = async (
  req: Request,
  res: Response<PaginatedResponse<any>>
): Promise<void> => {
  try {
    logger.info('Get labeled events request query:', req.query);

    const {
      deviceId,
      labeledBy,
      page = 1,
      limit = 10,
      sort = 'createdAt',
      order = 'desc',
    } = req.query as PaginationQuery & { deviceId?: string; labeledBy?: string };

    const pageNum = parseInt(page as unknown as string, 10) || 1;
    const limitNum = parseInt(limit as unknown as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;
    const validSortFields = ['id', 'timestamp', 'labeledAt', 'createdAt'];
    const sortField = validSortFields.includes(sort as string)
      ? sort
      : 'labeledAt';
    const orderDirection = order === 'asc' ? 'asc' : 'desc';

    const filter: any = {};
    if (deviceId) {
      filter.deviceId = deviceId as string;
    }
    if (labeledBy) {
      filter.labeledBy = labeledBy as string;
    }

    const [labeledEvents, total] = await Promise.all([
      prisma.labeledEvent.findMany({
        where: filter,
        orderBy: { [sortField]: orderDirection },
        skip,
        take: limitNum,
        select: {
          id: true,
          deviceId: true,
          originalEventId: true,
          timestamp: true,
          details: true,
          labeledBy: true,
          labeledAt: true,
          createdAt: true,
        },
      }),
      prisma.labeledEvent.count({ where: filter }),
    ]);

    const serializedEvents = labeledEvents.map((event) => ({
      ...event,
      timestamp: event.timestamp.toString(),
      labeledAt: event.labeledAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
    }));

    res.status(200).json({
      success: true,
      message: 'Labeled events fetched successfully',
      data: serializedEvents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('Error fetching labeled events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch labeled events',
      error: error instanceof Error ? error.message : 'Unknown error',
      pagination: {
        page: 0,
        limit: 0,
        total: 0,
        pages: 0,
      },
    });
  }
};