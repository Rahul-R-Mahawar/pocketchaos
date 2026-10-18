import type { RequestHandler } from 'express';
import { getAuthUserId } from '../middleware/auth';
import { isDuplicateKeyError } from '../middleware/errorHandler';
import { ChaosEndpoint } from '../models/ChaosEndpoint';
import { RequestLog } from '../models/RequestLog';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import { serializeEndpoint } from '../utils/serializers';
import { idParamsSchema } from '../validators/common.schema';
import { createEndpointSchema, updateChaosSchema } from '../validators/endpoint.schema';

export const MAX_ENDPOINTS_PER_USER = 100;

export const listEndpoints: RequestHandler = async (req, res) => {
  const userId = getAuthUserId(req);
  const endpoints = await ChaosEndpoint.find({ userId })
    .sort({ createdAt: -1 })
    .limit(MAX_ENDPOINTS_PER_USER)
    .lean();
  sendSuccess(res, endpoints.map(serializeEndpoint));
};

export const createEndpoint: RequestHandler = async (req, res) => {
  const userId = getAuthUserId(req);
  const input = await createEndpointSchema.parseAsync(req.body);

  const owner = await User.findById(userId).select('projectKey').lean();
  if (!owner) throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');

  if ((await ChaosEndpoint.countDocuments({ userId })) >= MAX_ENDPOINTS_PER_USER) {
    throw new AppError(409, 'ENDPOINT_LIMIT_REACHED', `A project can have at most ${MAX_ENDPOINTS_PER_USER} endpoints`);
  }

  try {
    const endpoint = await ChaosEndpoint.create({
      userId,
      // Always taken from the owner record, never from the request body.
      projectKey: owner.projectKey,
      name: input.name,
      path: input.path,
      method: input.method,
      targetUrl: input.targetUrl ?? null,
      ...(input.mockResponseJson !== undefined && { mockResponseJson: input.mockResponseJson }),
      ...(input.chaosConfig && { chaosConfig: input.chaosConfig }),
    });
    sendSuccess(res, serializeEndpoint(endpoint.toObject()), 201);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(409, 'ENDPOINT_EXISTS', `An endpoint for ${input.method} ${input.path} already exists`);
    }
    throw err;
  }
};

export const updateEndpointChaos: RequestHandler = async (req, res) => {
  const userId = getAuthUserId(req);
  const { id } = idParamsSchema.parse(req.params);
  const patch = await updateChaosSchema.parseAsync(req.body);

  const $set = Object.fromEntries(Object.entries(patch).map(([field, value]) => [`chaosConfig.${field}`, value]));

  // Filtering on userId means another user's id behaves exactly like a missing one (404, no existence leak).
  const endpoint = await ChaosEndpoint.findOneAndUpdate(
    { _id: id, userId },
    { $set },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!endpoint) throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'Endpoint not found');

  sendSuccess(res, serializeEndpoint(endpoint));
};

export const deleteEndpoint: RequestHandler = async (req, res) => {
  const userId = getAuthUserId(req);
  const { id } = idParamsSchema.parse(req.params);

  const endpoint = await ChaosEndpoint.findOneAndDelete({ _id: id, userId }).lean();
  if (!endpoint) throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'Endpoint not found');

  await RequestLog.deleteMany({ endpointId: endpoint._id });
  sendSuccess(res, { id: endpoint._id.toString(), deleted: true });
};
