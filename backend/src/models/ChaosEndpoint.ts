import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { PROJECT_KEY_REGEX } from '../utils/projectKey';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const MAX_DELAY_MS = 10_000;
export const MIN_OVERRIDE_STATUS = 200;
export const MAX_OVERRIDE_STATUS = 599;

export interface ChaosConfig {
  enabled: boolean;
  /** Latency injected before responding, 0..10000 ms. */
  delayMs: number;
  /** Percentage (0..100) of requests that fail with an injected 500. */
  failureRate: number;
  /** When set, replaces the status code of every non-failed response. */
  overrideStatusCode: number | null;
  /** Mutates random fields of JSON bodies to null / wrong types / missing. */
  corruptJson: boolean;
}

export interface IChaosEndpoint {
  userId: Types.ObjectId;
  /** Copied from the owner so the proxy can match on (projectKey, method, path) with one indexed query. */
  projectKey: string;
  name: string;
  path: string;
  method: HttpMethod;
  /** Forward target. When null the endpoint serves `mockResponseJson` instead. */
  targetUrl: string | null;
  mockResponseJson: unknown;
  chaosConfig: ChaosConfig;
  createdAt: Date;
  updatedAt: Date;
}

export type ChaosEndpointDocument = HydratedDocument<IChaosEndpoint>;

const chaosConfigSchema = new Schema<ChaosConfig>(
  {
    enabled: { type: Boolean, default: false },
    delayMs: { type: Number, default: 0, min: 0, max: MAX_DELAY_MS },
    failureRate: { type: Number, default: 0, min: 0, max: 100 },
    overrideStatusCode: {
      type: Number,
      default: null,
      min: MIN_OVERRIDE_STATUS,
      max: MAX_OVERRIDE_STATUS,
    },
    corruptJson: { type: Boolean, default: false },
  },
  { _id: false },
);

const chaosEndpointSchema = new Schema<IChaosEndpoint>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    projectKey: { type: String, required: true, uppercase: true, match: PROJECT_KEY_REGEX },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    path: { type: String, required: true, maxlength: 200 },
    method: { type: String, required: true, enum: HTTP_METHODS },
    targetUrl: { type: String, default: null, maxlength: 2048 },
    mockResponseJson: { type: Schema.Types.Mixed, default: () => ({}) },
    chaosConfig: { type: chaosConfigSchema, default: () => ({}) },
  },
  // minimize: false keeps an intentionally empty `{}` mock body instead of dropping the field.
  { timestamps: true, minimize: false },
);

chaosEndpointSchema.index({ projectKey: 1, method: 1, path: 1 }, { unique: true });

export const ChaosEndpoint = model<IChaosEndpoint>('ChaosEndpoint', chaosEndpointSchema);
