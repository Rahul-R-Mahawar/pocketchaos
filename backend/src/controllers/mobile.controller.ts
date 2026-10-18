import type { RequestHandler } from 'express';
import { ChaosEndpoint } from '../models/ChaosEndpoint';
import { assertProjectExists } from '../services/project.service';
import { sendSuccess } from '../utils/apiResponse';
import { serializePairedEndpoint } from '../utils/serializers';
import type { ProjectKeyParams } from '../validators/common.schema';
import { MAX_ENDPOINTS_PER_USER } from './endpoint.controller';

/** GET /api/mobile/pair/:projectKey: what the companion app needs to run chaos scenarios. */
export const pairDevice: RequestHandler<ProjectKeyParams> = async (req, res) => {
  const { projectKey } = req.params;
  await assertProjectExists(projectKey);

  const endpoints = await ChaosEndpoint.find({ projectKey })
    .sort({ createdAt: 1 })
    .limit(MAX_ENDPOINTS_PER_USER)
    .lean();

  sendSuccess(res, {
    projectKey,
    proxyBasePath: `/proxy/${projectKey}`,
    endpoints: endpoints.map(serializePairedEndpoint),
  });
};
