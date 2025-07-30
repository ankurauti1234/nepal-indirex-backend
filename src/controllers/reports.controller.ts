import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';
import { Parser } from 'json2csv';

interface ReportRequest {
  date: string; // YYYY-MM-DD format
  deviceId: string;
}

interface ReportData {
  date: string;
  deviceId: string;
  programContentCount: number;
  commercialBreakCount: number;
  spotsOutsideBreaksCount: number;
  autoPromoCount: number;
  songCount: number;
  errorCount: number;
  unlabeledCount: number;
  totalEvents: number;
}

export const generateReport = async (
  req: Request,
  res: Response // Changed from Response<ApiResponse<any>> to Response
): Promise<void> => {
  try {
    logger.info('Generate report request query:', req.query);

    const { date, deviceId } = req.query as unknown as ReportRequest;

    // Validate inputs
    if (!date || !deviceId) {
      res.status(400).json({
        success: false,
        message: 'Date and deviceId are required',
        error: 'Invalid request parameters',
      });
      return;
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      res.status(400).json({
        success: false,
        message: 'Date must be in YYYY-MM-DD format',
        error: 'Invalid date format',
      });
      return;
    }

    // Parse date and create timestamp range for the day
    const baseDate = new Date(date);
    if (isNaN(baseDate.getTime())) {
      res.status(400).json({
        success: false,
        message: 'Invalid date provided',
        error: 'Invalid date',
      });
      return;
    }

    const startDateTime = new Date(baseDate);
    startDateTime.setHours(0, 0, 0, 0);
    const endDateTime = new Date(baseDate);
    endDateTime.setHours(23, 59, 59, 999);

    const startTimestamp = Math.floor(startDateTime.getTime() / 1000);
    const endTimestamp = Math.floor(endDateTime.getTime() / 1000);

    // Fetch labeled events count by detection type
    const labeledEvents = await prisma.labeledEvent.groupBy({
      by: ['detectionType'],
      where: {
        deviceId,
        timestamp: {
          gte: startTimestamp,
          lte: endTimestamp,
        },
      },
      _count: {
        id: true,
      },
    });

    // Fetch total events count
    const totalEventsCount = await prisma.event.count({
      where: {
        deviceId,
        timestamp: {
          gte: startTimestamp,
          lte: endTimestamp,
        },
      },
    });

    // Fetch labeled events IDs
    const labeledEventIds = await prisma.labeledEvent.findMany({
      where: {
        deviceId,
        timestamp: {
          gte: startTimestamp,
          lte: endTimestamp,
        },
      },
      select: {
        originalEventId: true,
      },
    });

    const labeledOriginalEventIds = labeledEventIds.map((e) => e.originalEventId);

    // Fetch unlabeled events count
    const unlabeledEventsCount = await prisma.event.count({
      where: {
        deviceId,
        timestamp: {
          gte: startTimestamp,
          lte: endTimestamp,
        },
        id: {
          notIn: labeledOriginalEventIds,
        },
      },
    });

    // Prepare report data
    const reportData: ReportData = {
      date,
      deviceId,
      programContentCount: 0,
      commercialBreakCount: 0,
      spotsOutsideBreaksCount: 0,
      autoPromoCount: 0,
      songCount: 0,
      errorCount: 0,
      unlabeledCount: unlabeledEventsCount,
      totalEvents: totalEventsCount,
    };

    // Map labeled events counts to report data
    labeledEvents.forEach((group) => {
      switch (group.detectionType) {
        case 'Program Content':
          reportData.programContentCount = group._count.id;
          break;
        case 'Commercial Break':
          reportData.commercialBreakCount = group._count.id;
          break;
        case 'Spots outside breaks':
          reportData.spotsOutsideBreaksCount = group._count.id;
          break;
        case 'Auto-promo':
          reportData.autoPromoCount = group._count.id;
          break;
        case 'Song':
          reportData.songCount = group._count.id;
          break;
        case 'Error':
          reportData.errorCount = group._count.id;
          break;
      }
    });

    // Convert to CSV
    const fields = [
      { label: 'Date', value: 'date' },
      { label: 'Device ID', value: 'deviceId' },
      { label: 'Program Content Count', value: 'programContentCount' },
      { label: 'Commercial Break Count', value: 'commercialBreakCount' },
      { label: 'Spots Outside Breaks Count', value: 'spotsOutsideBreaksCount' },
      { label: 'Auto-promo Count', value: 'autoPromoCount' },
      { label: 'Song Count', value: 'songCount' },
      { label: 'Error Count', value: 'errorCount' },
      { label: 'Unlabeled Count', value: 'unlabeledCount' },
      { label: 'Total Events', value: 'totalEvents' },
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse([reportData]);

    // Set response headers for CSV download
    res.header('Content-Type', 'text/csv');
    res.attachment(`report_${date}_${deviceId}.csv`);

    res.status(200).send(csv);
  } catch (error) {
    logger.error('Error generating report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate report',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};