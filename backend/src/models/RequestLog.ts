import { Schema, model, type Types } from 'mongoose';

export const CLIENT_PLATFORMS = ['ios', 'android', 'web', 'unknown'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

/** Logs are telemetry, not records of truth: they expire automatically to keep the collection bounded. */
export const REQUEST_LOG_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Hard cap per project, on top of the TTL, so one project cannot flood the shared database. */
export const MAX_LOGS_PER_PROJECT = 1_000;
export const MAX_LOGGED_PATH_LENGTH = 500;

export interface IRequestLog {
  /** Null when the request hit a valid projectKey but no registered endpoint. */
  endpointId: Types.ObjectId | null;
  projectKey: string;
  timestamp: Date;
  method: string;
  path: string;
  statusReturned: number;
  latencyMs: number;
  /** Comma-separated chaos tags, e.g. "delay:1500ms,status:503" or "none". */
  chaosApplied: string;
  clientPlatform: ClientPlatform;
}

const requestLogSchema = new Schema<IRequestLog>({
  endpointId: { type: Schema.Types.ObjectId, ref: 'ChaosEndpoint', default: null, index: true },
  projectKey: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, expires: REQUEST_LOG_TTL_SECONDS },
  method: { type: String, required: true, maxlength: 10 },
  path: { type: String, required: true, maxlength: MAX_LOGGED_PATH_LENGTH },
  statusReturned: { type: Number, required: true },
  latencyMs: { type: Number, required: true, min: 0 },
  chaosApplied: { type: String, required: true, default: 'none', maxlength: 200 },
  clientPlatform: { type: String, enum: CLIENT_PLATFORMS, default: 'unknown' },
});

requestLogSchema.index({ projectKey: 1, timestamp: -1 });

export const RequestLog = model<IRequestLog>('RequestLog', requestLogSchema);
