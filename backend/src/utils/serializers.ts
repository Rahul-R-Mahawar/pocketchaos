import type { Types } from 'mongoose';
import type { ChaosConfig, IChaosEndpoint } from '../models/ChaosEndpoint';
import type { IRequestLog } from '../models/RequestLog';

type WithId<T> = T & { _id: Types.ObjectId };

function serializeChaosConfig(config: ChaosConfig | undefined): ChaosConfig {
  return {
    enabled: config?.enabled ?? false,
    delayMs: config?.delayMs ?? 0,
    failureRate: config?.failureRate ?? 0,
    overrideStatusCode: config?.overrideStatusCode ?? null,
    corruptJson: config?.corruptJson ?? false,
  };
}

export function buildProxyPath(projectKey: string, path: string): string {
  return `/proxy/${projectKey}${path}`;
}

/** Owner view (dashboard): everything except the owner id. */
export function serializeEndpoint(endpoint: WithId<IChaosEndpoint>) {
  return {
    id: endpoint._id.toString(),
    projectKey: endpoint.projectKey,
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    mode: endpoint.targetUrl ? ('forward' as const) : ('mock' as const),
    targetUrl: endpoint.targetUrl ?? null,
    mockResponseJson: endpoint.mockResponseJson ?? null,
    chaosConfig: serializeChaosConfig(endpoint.chaosConfig),
    proxyPath: buildProxyPath(endpoint.projectKey, endpoint.path),
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}

/** Mobile pairing view: the projectKey alone grants access, so upstream URLs and mock bodies stay private. */
export function serializePairedEndpoint(endpoint: WithId<IChaosEndpoint>) {
  return {
    id: endpoint._id.toString(),
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    mode: endpoint.targetUrl ? ('forward' as const) : ('mock' as const),
    chaosConfig: serializeChaosConfig(endpoint.chaosConfig),
    proxyPath: buildProxyPath(endpoint.projectKey, endpoint.path),
  };
}

export function serializeRequestLog(log: WithId<IRequestLog>) {
  return {
    id: log._id.toString(),
    endpointId: log.endpointId ? log.endpointId.toString() : null,
    projectKey: log.projectKey,
    timestamp: log.timestamp,
    method: log.method,
    path: log.path,
    statusReturned: log.statusReturned,
    latencyMs: log.latencyMs,
    chaosApplied: log.chaosApplied,
    clientPlatform: log.clientPlatform,
  };
}
