import type { RequestHandler } from 'express';
import { RequestLog } from '../models/RequestLog';
import { assertProjectExists } from '../services/project.service';
import { sendSuccess } from '../utils/apiResponse';
import { serializeRequestLog } from '../utils/serializers';
import type { ProjectKeyParams } from '../validators/common.schema';

export const LOG_PAGE_SIZE = 50;

/** GET /api/logs/:projectKey: latest proxy telemetry for the dashboard and the mobile app. */
export const listLogs: RequestHandler<ProjectKeyParams> = async (req, res) => {
  const { projectKey } = req.params;
  await assertProjectExists(projectKey);

  const logs = await RequestLog.find({ projectKey }).sort({ timestamp: -1 }).limit(LOG_PAGE_SIZE).lean();
  sendSuccess(res, { projectKey, logs: logs.map(serializeRequestLog) });
};
