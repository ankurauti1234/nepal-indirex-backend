import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
import { Prisma } from '@prisma/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '../types';

interface EventFilter {
  deviceId?: string;
  type?: { in: number[] };
  timestamp?: { gte?: number; lte?: number };
}

interface LabeledEventFilter extends PaginationQuery {
  deviceId?: string;
  labeledBy?: string;
  detectionType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sort?: 'labeledAt' | 'createdAt';
  order?: 'desc' | 'asc';
  date?: string;
  startTime?: string;
  endTime?: string;
}

interface EventDetails {
  score: number;
  image_path: string;
  channel_name: string;
  duration?: number; // Calculated on backend for display
}

interface LabelEventRequest {
  eventIds: number[];
  detectionType:
    | 'Program Content'
    | 'Commercial Break'
    | 'Spots outside breaks'
    | 'Auto-promo'
    | 'Song'
    | 'Error';
  format?: string; // 2-digit code
  content?: string; // 3-digit code
  title?: string;
  episodeId?: string; // Only for Program Content
  seasonId?: string; // Only for Program Content
  repeat: boolean;
  labeledBy?: string;
  programContentDetails?: {
    description?: string;
    formatType?:
      | 'Film'
      | 'Series'
      | 'Structured Studio Programs'
      | 'Interactive Programs'
      | 'Artistic Performances';
    contentType?:
      | 'Popular Drama / Comedy'
      | 'Animation Film'
      | 'Documentary Film'
      | 'Short Film'
      | 'Other Film'
      | 'General News'
      | 'Animation Series / Cartoon'
      | 'Documentary Series'
      | 'Docusoap / Reality Series'
      | 'Other Series'
      | 'Science / Geography'
      | 'Lifestyle: Showbiz, Stars'
      | 'Entertainment: Humor';
    episodeId?: string;
    seasonId?: string;
  };
  commercialBreakDetails?: {
    category?: string;
    sector?: string;
  };
  spotsOutsideBreaksDetails?: {
    formatType?: 'BB' | 'CAPB' | 'OOBS';
    category?: string;
    sector?: string;
  };
  autoPromoDetails?: {
    contentType?:
      | 'Foreign'
      | 'Other Advertising'
      | 'Sports: Football'
      | 'Tele-shopping'
      | 'Other / Mixed / Unknown';
    category?: string;
    sector?: string;
  };
  songDetails?: {
    songName?: string;
    movieNameOrAlbumName?: string;
    artistName?: string;
    yearOfPublication?: string;
    genre?: string;
    tempo?: string;
  };
  errorDetails?: { errorType?: 'Signal Lost' | 'Blank Image' };
}

// Interface for LabeledEvent based on Prisma schema and selected fields
interface LabeledEvent {
  id: number;
  deviceId: string;
  originalEventId: number;
  timestamp: bigint;
  date: string | null;
  begin: string | null;
  format: string | null;
  content: string | null;
  title: string | null;
  episodeId: string | null;
  seasonId: string | null;
  repeat: boolean;
  detectionType: string;
  details: Prisma.JsonValue;
  labeledBy: string | null;
  labeledAt: Date;
  createdAt: Date;
}

const region = 'ap-south-1';

const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const S3_BUCKET = process.env.S3_BUCKET || 'apm-captured-images';

// Helper function to format timestamp to YYYYMMDD and HHMMSS
function formatTimestamp(timestamp: bigint): { date: string; begin: string } {
  const dateObj = new Date(Number(timestamp) * 1000);

  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  };
  const date = dateObj.toLocaleDateString('en-GB', options); // e.g., "23 Jul 2025"

  const begin = dateObj.toLocaleTimeString('en-GB', { hour12: false }); // e.g., "11:45:33"

  return { date, begin };
}

// Helper function to calculate duration between two timestamps (in seconds)
function calculateDuration(events: any[]): number {
  if (events.length <= 1) return 0;
  const timestamps = events
    .map((e) => Number(e.timestamp))
    .sort((a, b) => a - b);
  return timestamps[timestamps.length - 1] - timestamps[0];
}

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

function extractS3Key(imagePath: string): string {
  const url = new URL(imagePath);
  return url.pathname.substring(1);
}

function generateLabeledImagePath(originalPath: string): string {
  const originalKey = extractS3Key(originalPath);
  const labeledKey = originalKey.replace(
    /Nepal_Frames\/(unrecognized_frames|analayzed_frames)/,
    'Nepal_Frames/labeled_frames'
  );
  return `https://${S3_BUCKET}.s3.${region}.amazonaws.com/${labeledKey}`;
}

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
      sort = 'timestamp',
      order = 'desc',
      date,
      startTime,
      endTime,
    } = req.query as PaginationQuery & {
      deviceId?: string;
      type?: string;
      date?: string;
      startTime?: string;
      endTime?: string;
    };

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
          pagination: { page: 0, limit: 0, total: 0, pages: 0 },
        });
        return;
      }
      filter.type = { in: typeArray };
    }
    if (date && (startTime || endTime)) {
      filter.timestamp = {};
      const baseDate = new Date(date);
      if (startTime) {
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = new Date(baseDate);
        startDateTime.setHours(hours, minutes, 0, 0);
        filter.timestamp.gte = Math.floor(startDateTime.getTime() / 1000);
      }
      if (endTime) {
        const [hours, minutes] = endTime.split(':').map(Number);
        const endDateTime = new Date(baseDate);
        endDateTime.setHours(hours, minutes, 0, 0);
        filter.timestamp.lte = Math.floor(endDateTime.getTime() / 1000);
      }
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

    const serializedEvents = events.map((event) => {
      const { date, begin } = formatTimestamp(event.timestamp);
      const details = validateEventDetails(event.details) || event.details;
      return {
        ...event,
        timestamp: event.timestamp.toString(),
        details: {
          ...(typeof details === 'object' && details !== null ? details : {}),
          duration: calculateDuration([event]),
        },
        date,
        begin,
      };
    });

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
      pagination: { page: 0, limit: 0, total: 0, pages: 0 },
    });
  }
};

export const labelEvent = async (
  req: Request,
  res: Response<ApiResponse<any>>
): Promise<void> => {
  try {
    const {
      eventIds,
      detectionType,
      format,
      content,
      title,
      episodeId,
      seasonId,
      repeat,
      labeledBy,
      programContentDetails,
      commercialBreakDetails,
      spotsOutsideBreaksDetails,
      autoPromoDetails,
      songDetails,
      errorDetails,
    } = req.body as LabelEventRequest;

    if (
      !eventIds ||
      !Array.isArray(eventIds) ||
      eventIds.length === 0 ||
      !detectionType
    ) {
      res.status(400).json({
        success: false,
        message: 'Event IDs and detection type are required',
        error: 'Invalid request body',
      });
      return;
    }

    // Validate optional fields
    if (format && !/^\d{2}$/.test(format)) {
      res.status(400).json({
        success: false,
        message: 'Format must be a 2-digit code',
        error: 'Invalid format',
      });
      return;
    }
    if (content && !/^\d{3}$/.test(content)) {
      res.status(400).json({
        success: false,
        message: 'Content must be a 3-digit code',
        error: 'Invalid content',
      });
      return;
    }
    if (
      detectionType === 'Program Content' &&
      (!programContentDetails ||
        !programContentDetails.description ||
        !programContentDetails.formatType ||
        !programContentDetails.contentType)
    ) {
      res.status(400).json({
        success: false,
        message:
          'Program content details (description, formatType, contentType) are required for Program Content detection type',
        error: 'Invalid program content details',
      });
      return;
    }
    if (
      detectionType === 'Spots outside breaks' &&
      (!spotsOutsideBreaksDetails || !spotsOutsideBreaksDetails.formatType)
    ) {
      res.status(400).json({
        success: false,
        message:
          'Format type is required for Spots outside breaks detection type',
        error: 'Invalid spots outside breaks details',
      });
      return;
    }
    if (
      detectionType === 'Auto-promo' &&
      (!autoPromoDetails || !autoPromoDetails.contentType)
    ) {
      res.status(400).json({
        success: false,
        message: 'Content type is required for Auto-promo detection type',
        error: 'Invalid auto-promo details',
      });
      return;
    }
    if (
      detectionType === 'Song' &&
      (!songDetails || !songDetails.songName || !songDetails.artistName)
    ) {
      res.status(400).json({
        success: false,
        message:
          'Song details (songName, artistName) are required for Song detection type',
        error: 'Invalid song details',
      });
      return;
    }
    if (
      detectionType === 'Error' &&
      (!errorDetails || !errorDetails.errorType)
    ) {
      res.status(400).json({
        success: false,
        message: 'Error type is required for Error detection type',
        error: 'Invalid error details',
      });
      return;
    }
    if (
      detectionType === 'Program Content' &&
      (episodeId || seasonId) &&
      !programContentDetails
    ) {
      res.status(400).json({
        success: false,
        message:
          'Program content details are required when episodeId or seasonId is provided',
        error: 'Invalid program content details',
      });
      return;
    }

    const labeledEvents = [];
    for (const eventId of eventIds) {
      const originalEvent = await prisma.event.findUnique({
        where: { id: eventId },
      });

      if (!originalEvent) {
        res.status(404).json({
          success: false,
          message: `Event with ID ${eventId} not found`,
          error: 'Event does not exist',
        });
        return;
      }

      const eventDetails = validateEventDetails(originalEvent.details);
      if (!eventDetails) {
        res.status(400).json({
          success: false,
          message: `Invalid event details for event ID ${eventId}`,
          error: 'Event details do not contain required image information',
        });
        return;
      }

      const { date, begin } = formatTimestamp(originalEvent.timestamp);
      const originalKey = extractS3Key(eventDetails.image_path);
      const labeledKey = generateLabeledImagePath(eventDetails.image_path);

      try {
        await s3Client.send(
          new CopyObjectCommand({
            Bucket: S3_BUCKET,
            CopySource: `${S3_BUCKET}/${originalKey}`,
            Key: labeledKey,
          })
        );
      } catch (s3Error) {
        logger.error(
          `S3 error during image copy for event ID ${eventId}:`,
          s3Error
        );
        res.status(500).json({
          success: false,
          message: `Failed to copy image for event ID ${eventId}`,
          error:
            s3Error instanceof Error ? s3Error.message : 'S3 operation failed',
        });
        return;
      }

      const labeledEventDetails = {
        ...eventDetails,
        original_image_path: eventDetails.image_path,
        image_path: labeledKey,
        ...(detectionType === 'Program Content'
          ? {
              ...programContentDetails,
              episodeId: episodeId || programContentDetails?.episodeId,
              seasonId: seasonId || programContentDetails?.seasonId,
            }
          : {}),
        ...(detectionType === 'Commercial Break' ? commercialBreakDetails : {}),
        ...(detectionType === 'Spots outside breaks'
          ? spotsOutsideBreaksDetails
          : {}),
        ...(detectionType === 'Auto-promo' ? autoPromoDetails : {}),
        ...(detectionType === 'Song' ? songDetails : {}),
        ...(detectionType === 'Error' ? errorDetails : {}),
      };

      const labeledEvent = await prisma.labeledEvent.create({
        data: {
          deviceId: originalEvent.deviceId,
          originalEventId: originalEvent.id,
          timestamp: originalEvent.timestamp,
          date,
          begin,
          format: format || null,
          content: content || null,
          title: title || null,
          episodeId:
            detectionType === 'Program Content'
              ? episodeId || programContentDetails?.episodeId || null
              : null,
          seasonId:
            detectionType === 'Program Content'
              ? seasonId || programContentDetails?.seasonId || null
              : null,
          repeat,
          detectionType,
          details: labeledEventDetails,
          labeledBy: labeledBy || null,
        },
      });

      labeledEvents.push({
        ...labeledEvent,
        timestamp: labeledEvent.timestamp.toString(),
        labeledAt: labeledEvent.labeledAt.toISOString(),
        createdAt: labeledEvent.createdAt.toISOString(),
      });
    }

    res.status(201).json({
      success: true,
      message: 'Events labeled successfully',
      data: labeledEvents,
    });
  } catch (error) {
    logger.error('Error labeling events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to label events',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getManuallyLabeledEvents = async (
  req: Request,
  res: Response<PaginatedResponse<any>>
): Promise<void> => {
  try {
    logger.info('Get manually labeled events request query:', req.query);

    const {
      deviceId,
      labeledBy,
      detectionType,
      date,
      startTime,
      endTime,
      page = 1,
      limit = 10,
      sort = 'labeledAt',
      order = 'desc',
    } = req.query as LabeledEventFilter;

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
    if (detectionType) {
      filter.detectionType = detectionType as string;
    }
    if (date && (startTime || endTime)) {
      filter.timestamp = {};
      const baseDate = new Date(date);
      if (startTime) {
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = new Date(baseDate);
        startDateTime.setHours(hours, minutes, 0, 0);
        filter.timestamp.gte = Math.floor(startDateTime.getTime() / 1000);
      }
      if (endTime) {
        const [hours, minutes] = endTime.split(':').map(Number);
        const endDateTime = new Date(baseDate);
        endDateTime.setHours(hours, minutes, 0, 0);
        filter.timestamp.lte = Math.floor(endDateTime.getTime() / 1000);
      }
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
          date: true,
          begin: true,
          format: true,
          content: true,
          title: true,
          episodeId: true,
          seasonId: true,
          repeat: true,
          detectionType: true,
          details: true,
          labeledBy: true,
          labeledAt: true,
          createdAt: true,
        },
      }),
      prisma.labeledEvent.count({ where: filter }),
    ]);

    const combinedEvents: any[] = [];
    let currentGroup: any = null;

    for (const event of labeledEvents.sort(
      (a: LabeledEvent, b: LabeledEvent) => Number(a.timestamp) - Number(b.timestamp)
    )) {
      const eventDetails = validateEventDetails(event.details);
      if (!eventDetails) continue;

      const isSimilar = (prev: any, curr: any) =>
        prev.deviceId === curr.deviceId &&
        prev.detectionType === curr.detectionType &&
        prev.date === curr.date &&
        prev.begin === curr.begin &&
        prev.format === curr.format &&
        prev.content === curr.content &&
        prev.title === curr.title &&
        prev.episodeId === curr.episodeId &&
        prev.seasonId === curr.seasonId &&
        prev.repeat === curr.repeat &&
        prev.details.description === curr.details.description &&
        prev.details.formatType === curr.details.formatType &&
        prev.details.contentType === curr.details.contentType &&
        prev.details.category === curr.details.category &&
        prev.details.sector === curr.details.sector &&
        prev.details.songName === curr.details.songName &&
        prev.details.movieNameOrAlbumName ===
          curr.details.movieNameOrAlbumName &&
        prev.details.artistName === curr.details.artistName &&
        prev.details.yearOfPublication === curr.details.yearOfPublication &&
        prev.details.genre === curr.details.genre &&
        prev.details.tempo === curr.details.tempo &&
        prev.details.errorType === curr.details.errorType &&
        Math.abs(Number(prev.timestamp) - Number(curr.timestamp)) <= 60;

      if (!currentGroup) {
        currentGroup = {
          ...event,
          timestampStart: event.timestamp.toString(),
          timestampEnd: event.timestamp.toString(),
          images: [eventDetails.image_path],
          details: { ...eventDetails, duration: calculateDuration([event]) },
        };
      } else if (isSimilar(currentGroup, { ...event, details: eventDetails })) {
        currentGroup.timestampEnd = event.timestamp.toString();
        currentGroup.images.push(eventDetails.image_path);
        currentGroup.details.duration = calculateDuration([
          ...combinedEvents,
          currentGroup,
          event,
        ]);
      } else {
        combinedEvents.push(currentGroup);
        currentGroup = {
          ...event,
          timestampStart: event.timestamp.toString(),
          timestampEnd: event.timestamp.toString(),
          images: [eventDetails.image_path],
          details: { ...eventDetails, duration: calculateDuration([event]) },
        };
      }
    }
    if (currentGroup) {
      combinedEvents.push(currentGroup);
    }

    const serializedEvents = combinedEvents.map((event) => ({
      ...event,
      timestamp: event.timestamp.toString(),
      timestampStart: event.timestampStart,
      timestampEnd: event.timestampEnd,
      labeledAt: event.labeledAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
      images: event.images,
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
      pagination: { page: 0, limit: 0, total: 0, pages: 0 },
    });
  }
};

export const getLabeledEvents = async (
  req: Request,
  res: Response<PaginatedResponse<any>>
): Promise<void> => {
  try {
    logger.info('Get labeled events request query:', req.query);

    const {
      deviceId,
      labeledBy,
      detectionType,
      date,
      startTime,
      endTime,
      page = 1,
      limit = 10,
      sort = 'labeledAt',
      order = 'desc',
    } = req.query as LabeledEventFilter;

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
    if (detectionType) {
      filter.detectionType = detectionType as string;
    }
    if (date && (startTime || endTime)) {
      filter.timestamp = {};
      const baseDate = new Date(date);
      if (startTime) {
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDateTime = new Date(baseDate);
        startDateTime.setHours(hours, minutes, 0, 0);
        filter.timestamp.gte = Math.floor(startDateTime.getTime() / 1000);
      }
      if (endTime) {
        const [hours, minutes] = endTime.split(':').map(Number);
        const endDateTime = new Date(baseDate);
        endDateTime.setHours(hours, minutes, 0, 0);
        filter.timestamp.lte = Math.floor(endDateTime.getTime() / 1000);
      }
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
          date: true,
          begin: true,
          format: true,
          content: true,
          title: true,
          episodeId: true,
          seasonId: true,
          repeat: true,
          detectionType: true,
          details: true,
          labeledBy: true,
          labeledAt: true,
          createdAt: true,
        },
      }),
      prisma.labeledEvent.count({ where: filter }),
    ]);

    const combinedEvents: any[] = [];
    let currentGroup: any = null;

    for (const event of labeledEvents.sort(
      (a: LabeledEvent, b: LabeledEvent) => Number(a.timestamp) - Number(b.timestamp)
    )) {
      const eventDetails = validateEventDetails(event.details);
      if (!eventDetails) continue;

      const isSimilar = (prev: any, curr: any) =>
        prev.deviceId === curr.deviceId &&
        prev.detectionType === curr.detectionType &&
        prev.date === curr.date &&
        prev.begin === curr.begin &&
        prev.format === curr.format &&
        prev.content === curr.content &&
        prev.title === curr.title &&
        prev.episodeId === curr.episodeId &&
        prev.seasonId === curr.seasonId &&
        prev.repeat === curr.repeat &&
        prev.details.description === curr.details.description &&
        prev.details.formatType === curr.details.formatType &&
        prev.details.contentType === curr.details.contentType &&
        prev.details.category === curr.details.category &&
        prev.details.sector === curr.details.sector &&
        prev.details.songName === curr.details.songName &&
        prev.details.movieNameOrAlbumName ===
          curr.details.movieNameOrAlbumName &&
        prev.details.artistName === curr.details.artistName &&
        prev.details.yearOfPublication === curr.details.yearOfPublication &&
        prev.details.genre === curr.details.genre &&
        prev.details.tempo === curr.details.tempo &&
        prev.details.errorType === curr.details.errorType &&
        Math.abs(Number(prev.timestamp) - Number(curr.timestamp)) <= 60;

      if (!currentGroup) {
        currentGroup = {
          ...event,
          timestampStart: event.timestamp.toString(),
          timestampEnd: event.timestamp.toString(),
          images: [eventDetails.image_path],
          details: { ...eventDetails, duration: calculateDuration([event]) },
        };
      } else if (isSimilar(currentGroup, { ...event, details: eventDetails })) {
        currentGroup.timestampEnd = event.timestamp.toString();
        currentGroup.images.push(eventDetails.image_path);
        currentGroup.details.duration = calculateDuration([
          ...combinedEvents,
          currentGroup,
          event,
        ]);
      } else {
        combinedEvents.push(currentGroup);
        currentGroup = {
          ...event,
          timestampStart: event.timestamp.toString(),
          timestampEnd: event.timestamp.toString(),
          images: [eventDetails.image_path],
          details: { ...eventDetails, duration: calculateDuration([event]) },
        };
      }
    }
    if (currentGroup) {
      combinedEvents.push(currentGroup);
    }

    const serializedEvents = combinedEvents.map((event) => ({
      ...event,
      timestamp: event.timestamp.toString(),
      timestampStart: event.timestampStart,
      timestampEnd: event.timestampEnd,
      labeledAt: event.labeledAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
      images: event.images,
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
      pagination: { page: 0, limit: 0, total: 0, pages: 0 },
    });
  }
};