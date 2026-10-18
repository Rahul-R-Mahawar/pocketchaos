import mongoose, { type Types } from 'mongoose';
import {
  MAX_LOGGED_PATH_LENGTH,
  MAX_LOGS_PER_PROJECT,
  RequestLog,
  type ClientPlatform,
} from '../models/RequestLog';

export interface RequestLogEntry {
  endpointId: Types.ObjectId | null;
  projectKey: string;
  method: string;
  path: string;
  statusReturned: number;
  latencyMs: number;
  chaosApplied: string;
  clientPlatform: ClientPlatform;
}

/** Deletes everything older than the newest `keep` logs of one project. */
export async function trimProjectLogs(projectKey: string, keep = MAX_LOGS_PER_PROJECT): Promise<void> {
  const cutoff = await RequestLog.findOne({ projectKey })
    .sort({ timestamp: -1 })
    .skip(keep)
    .select('timestamp')
    .lean();
  if (!cutoff) return;
  // sanitizeFilter is on globally, so the operator must be explicitly trusted or it is neutralised to $eq.
  await RequestLog.deleteMany({ projectKey, timestamp: mongoose.trusted({ $lte: cutoff.timestamp }) });
}

/** Telemetry must never break the proxied response, so failures are logged and swallowed here. */
export async function recordRequestLog(entry: RequestLogEntry): Promise<void> {
  try {
    await RequestLog.create({ ...entry, path: entry.path.slice(0, MAX_LOGGED_PATH_LENGTH) });
    await trimProjectLogs(entry.projectKey);
  } catch (err) {
    console.error('[proxy] failed to record request log', err);
  }
}
