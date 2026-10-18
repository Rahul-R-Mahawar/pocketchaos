import { Router, type RequestHandler } from 'express';
import { handleProxyRequest } from '../controllers/proxy.controller';

export const PROXY_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; sandbox";

/**
 * Proxied bodies can come from any upstream (text/html, application/javascript...). Served from the API origin,
 * they would let anyone host a phishing page or a script on our domain, and helmet's `script-src 'self'` would
 * even allow one proxy URL to load another as a script. A sandboxing CSP neutralises that in browsers;
 * mobile HTTP clients ignore it. Set before routing so error responses are covered too.
 */
export const sandboxProxyResponses: RequestHandler = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', PROXY_CONTENT_SECURITY_POLICY);
  next();
};

export const proxyRouter = Router();

// Express 5 syntax for "/proxy/:projectKey/*": a named, optional wildcard so /proxy/ABC123 also matches.
proxyRouter.all('/:projectKey{/*splat}', handleProxyRequest);
