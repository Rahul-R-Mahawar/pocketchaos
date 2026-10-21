/**
 * PocketChaos 1-click demo seeder.
 *
 * Signs in a demo user (registering it on first run), prints its 6-character projectKey large enough to read on
 * video, seeds three realistic mobile API endpoints with chaos rules, and can fire simulated mobile traffic through
 * /proxy/:projectKey/* so the dashboard's live telemetry fills with green 200s, amber corrupted payloads and red 503s.
 *
 * Run it with Node 22.18+ (TypeScript runs natively) or any TS runner:
 *   node submission-assets/demo-seeder.ts                       seed only
 *   node submission-assets/demo-seeder.ts --traffic             seed, then 8 rounds of traffic (24 requests)
 *   node submission-assets/demo-seeder.ts --traffic=20 --interval=1500
 *   node submission-assets/demo-seeder.ts --traffic --forever   traffic until Ctrl+C (handy while recording)
 *   backend/node_modules/.bin/tsx submission-assets/demo-seeder.ts --traffic   on Node < 22.18, via the backend's tsx
 *
 * Configuration (no secrets in this file):
 *   POCKETCHAOS_API_URL  backend origin, default http://localhost:4000
 *   DEMO_EMAIL           default demo@pocketchaos.dev
 *   DEMO_PASSWORD        if unset, read from submission-assets/.env.demo.local, or generated once and saved there
 *                        (git-ignored by `.env.*` and excluded from the submission ZIP). It is never printed.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_FILE = join(HERE, '.env.demo.local');
const DEFAULT_EMAIL = 'demo@pocketchaos.dev';
const REQUEST_TIMEOUT_MS = 15_000;

interface Options {
  apiUrl: string;
  traffic: number;
  forever: boolean;
  intervalMs: number;
  help: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apiUrl: (process.env.POCKETCHAOS_API_URL ?? 'http://localhost:4000').replace(/\/+$/, ''),
    traffic: 0,
    forever: false,
    intervalMs: 1_200,
    help: false,
  };
  for (const arg of argv) {
    const [flag, value] = arg.split('=', 2);
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--traffic') options.traffic = value ? positiveInt(value, '--traffic') : 8;
    else if (flag === '--forever') options.forever = true;
    else if (flag === '--interval') options.intervalMs = positiveInt(value ?? '', '--interval');
    else if (flag === '--api') options.apiUrl = (value ?? '').replace(/\/+$/, '');
    else throw new SeedError(`Unknown option "${arg}". Run with --help.`);
  }
  if (options.forever && options.traffic === 0) options.traffic = 8;
  if (!/^https?:\/\/[^/\s]+$/.test(options.apiUrl)) {
    throw new SeedError(`POCKETCHAOS_API_URL must be an http(s) origin such as http://localhost:4000 (got "${options.apiUrl}")`);
  }
  return options;
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new SeedError(`${flag} needs a positive whole number (got "${value}")`);
  return parsed;
}

// ---------------------------------------------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------------------------------------------

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('1;31'),
  green: paint('1;32'),
  amber: paint('1;33'),
  cyan: paint('1;36'),
  magenta: paint('1;35'),
  key: paint('1;93'),
};

/** 5×5 block font for the project key alphabet (A–Z, 0–9). Each row is 5 cells; '#' is filled. */
const FONT: Record<string, string> = {
  A: ' ### |#   #|#####|#   #|#   #', B: '#### |#   #|#### |#   #|#### ', C: ' ####|#    |#    |#    | ####',
  D: '#### |#   #|#   #|#   #|#### ', E: '#####|#    |#### |#    |#####', F: '#####|#    |#### |#    |#    ',
  G: ' ####|#    |#  ##|#   #| ####', H: '#   #|#   #|#####|#   #|#   #', I: '#####|  #  |  #  |  #  |#####',
  J: '    #|    #|    #|#   #| ### ', K: '#   #|#  # |###  |#  # |#   #', L: '#    |#    |#    |#    |#####',
  M: '#   #|## ##|# # #|#   #|#   #', N: '#   #|##  #|# # #|#  ##|#   #', O: ' ### |#   #|#   #|#   #| ### ',
  P: '#### |#   #|#### |#    |#    ', Q: ' ### |#   #|# # #|#  # | ## #', R: '#### |#   #|#### |#  # |#   #',
  S: ' ####|#    | ### |    #|#### ', T: '#####|  #  |  #  |  #  |  #  ', U: '#   #|#   #|#   #|#   #| ### ',
  V: '#   #|#   #|#   #| # # |  #  ', W: '#   #|#   #|# # #|## ##|#   #', X: '#   #| # # |  #  | # # |#   #',
  Y: '#   #| # # |  #  |  #  |  #  ', Z: '#####|   # |  #  | #   |#####', 0: ' ### |#  ##|# # #|##  #| ### ',
  1: '  #  | ##  |  #  |  #  | ### ', 2: ' ### |#   #|  ## | #   |#####', 3: '#### |    #| ### |    #|#### ',
  4: '#   #|#   #|#####|    #|    #', 5: '#####|#    |#### |    #|#### ', 6: ' ### |#    |#### |#   #| ### ',
  7: '#####|    #|   # |  #  |  #  ', 8: ' ### |#   #| ### |#   #| ### ', 9: ' ### |#   #| ####|    #| ### ',
};

function bigText(text: string): string {
  const rows = ['', '', '', '', ''];
  for (const char of text.toUpperCase()) {
    const glyph = (FONT[char] ?? '     |     |     |     |     ').split('|');
    glyph.forEach((row, index) => {
      rows[index] += `${row.replaceAll('#', '██').replaceAll(' ', '  ')}  `;
    });
  }
  return rows.map((row) => `   ${c.key(row.trimEnd())}`).join('\n');
}

function banner(projectKey: string, apiUrl: string): void {
  const line = c.dim('─'.repeat(78));
  console.log(`\n${line}`);
  console.log(`   ${c.bold('POCKETCHAOS PROJECT KEY')}  ${c.dim('(type it into the mobile app’s Pair tab)')}\n`);
  console.log(bigText(projectKey));
  console.log(`\n   ${c.key(projectKey.split('').join(' '))}   ${c.dim('proxy base:')} ${c.cyan(`${apiUrl}/proxy/${projectKey}`)}`);
  console.log(`${line}\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// PocketChaos API client ({ success, data } / { success: false, error } envelope, .ai/CONTEXT.md §4)
// ---------------------------------------------------------------------------------------------------------------

class SeedError extends Error {}

class ApiCallError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface AuthData {
  token: string;
  projectKey: string;
  user: { email: string };
}

interface ChaosConfig {
  enabled: boolean;
  delayMs: number;
  failureRate: number;
  overrideStatusCode: number | null;
  corruptJson: boolean;
}

interface EndpointData {
  id: string;
  name: string;
  method: string;
  path: string;
  proxyPath: string;
  chaosConfig: ChaosConfig;
}

type Envelope<T> = { success: true; data: T } | { success: false; error?: { code?: string; message?: string } };

async function api<T>(apiUrl: string, method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SeedError(
      `Cannot reach the PocketChaos API at ${apiUrl}.\n   Start it first, e.g.:  cd backend && JWT_SECRET=$(openssl rand -hex 32) CORS_ORIGINS=http://localhost:5173 npm run dev:memory`,
    );
  }
  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(await response.text()) as Envelope<T>;
  } catch {
    throw new SeedError(`${method} ${path} did not return a PocketChaos API response (HTTP ${response.status}). Is ${apiUrl} the backend?`);
  }
  if (envelope.success === true) return envelope.data;
  throw new ApiCallError(response.status, envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? `HTTP ${response.status}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Demo account
// ---------------------------------------------------------------------------------------------------------------

function readCredentialsFile(): Record<string, string> {
  if (!existsSync(CREDENTIALS_FILE)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(CREDENTIALS_FILE, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] && match[2] !== undefined) values[match[1]] = match[2];
  }
  return values;
}

function resolveCredentials(): { email: string; password: string; generated: boolean } {
  const saved = readCredentialsFile();
  const email = process.env.DEMO_EMAIL ?? saved.DEMO_EMAIL ?? DEFAULT_EMAIL;
  const password = process.env.DEMO_PASSWORD ?? saved.DEMO_PASSWORD;
  if (password) return { email, password, generated: false };

  const fresh = randomBytes(18).toString('base64url');
  writeFileSync(
    CREDENTIALS_FILE,
    `# Generated by demo-seeder.ts for the local demo account. Git-ignored (.env.*); excluded from the submission ZIP.\nDEMO_EMAIL=${email}\nDEMO_PASSWORD=${fresh}\n`,
    { mode: 0o600 },
  );
  return { email, password: fresh, generated: true };
}

async function signIn(apiUrl: string, email: string, password: string): Promise<AuthData & { registered: boolean }> {
  try {
    return { ...(await api<AuthData>(apiUrl, 'POST', '/api/auth/register', { email, password })), registered: true };
  } catch (error) {
    if (!(error instanceof ApiCallError) || error.code !== 'EMAIL_TAKEN') throw error;
  }
  try {
    return { ...(await api<AuthData>(apiUrl, 'POST', '/api/auth/login', { email, password })), registered: false };
  } catch (error) {
    if (error instanceof ApiCallError && error.code === 'INVALID_CREDENTIALS') {
      throw new SeedError(
        `${email} already exists with a different password.\n   Set DEMO_PASSWORD to that account's password, or choose another DEMO_EMAIL.`,
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Demo endpoints: one chaos behaviour each, so every colour shows up in the telemetry table
// ---------------------------------------------------------------------------------------------------------------

interface DemoEndpoint {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  shows: string;
  mockResponseJson: unknown;
  chaosConfig: ChaosConfig;
  requestBody?: unknown;
}

const DEMO_ENDPOINTS: DemoEndpoint[] = [
  {
    name: 'User profile',
    method: 'GET',
    path: '/api/v1/user/profile',
    shows: 'JSON corruption on every 200 (amber)',
    mockResponseJson: {
      id: 48213,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      plan: 'pro',
      verified: true,
      avatarUrl: 'https://cdn.example.com/avatars/48213.png',
      stats: { orders: 27, rewardsPoints: 1840 },
      preferences: { currency: 'EUR', pushEnabled: true, language: 'en' },
    },
    chaosConfig: { enabled: true, delayMs: 250, failureRate: 0, overrideStatusCode: null, corruptJson: true },
  },
  {
    name: 'Checkout',
    method: 'POST',
    path: '/api/v1/orders/checkout',
    shows: '40% injected HTTP 503 (red)',
    mockResponseJson: {
      orderId: 'ord_9F2K7Q',
      status: 'confirmed',
      totalCents: 4598,
      currency: 'EUR',
      items: [
        { sku: 'TSHIRT-M-BLK', qty: 2, priceCents: 1999 },
        { sku: 'SOCKS-ONE', qty: 1, priceCents: 600 },
      ],
      estimatedDelivery: '2026-11-03',
    },
    chaosConfig: { enabled: true, delayMs: 800, failureRate: 40, overrideStatusCode: 503, corruptJson: false },
    requestBody: { cartId: 'cart_7781', paymentMethod: 'card_on_file', couponCode: null },
  },
  {
    name: 'Home feed',
    method: 'GET',
    path: '/api/v1/feed/items',
    shows: '2500 ms latency, a slow 3G-style 200 (green, slow)',
    mockResponseJson: {
      items: [
        { id: 'p_101', title: 'Winter collection is here', imageUrl: 'https://cdn.example.com/feed/101.jpg', likes: 342, sponsored: false },
        { id: 'p_102', title: 'Free shipping this weekend', imageUrl: 'https://cdn.example.com/feed/102.jpg', likes: 88, sponsored: true },
        { id: 'p_103', title: 'Your order is on its way', imageUrl: 'https://cdn.example.com/feed/103.jpg', likes: 12, sponsored: false },
      ],
      nextCursor: 'eyJwYWdlIjoyfQ',
    },
    chaosConfig: { enabled: true, delayMs: 2500, failureRate: 0, overrideStatusCode: null, corruptJson: false },
  },
];

async function seedEndpoints(apiUrl: string, token: string): Promise<EndpointData[]> {
  const existing = await api<EndpointData[]>(apiUrl, 'GET', '/api/endpoints', undefined, token);
  const seeded: EndpointData[] = [];
  for (const demo of DEMO_ENDPOINTS) {
    const match = existing.find((endpoint) => endpoint.method === demo.method && endpoint.path === demo.path);
    // Re-runs are idempotent: an existing endpoint just gets its chaos rules reset to the demo values.
    const endpoint = match
      ? await api<EndpointData>(apiUrl, 'PATCH', `/api/endpoints/${match.id}/chaos`, demo.chaosConfig, token)
      : await api<EndpointData>(
          apiUrl,
          'POST',
          '/api/endpoints',
          { name: demo.name, method: demo.method, path: demo.path, mockResponseJson: demo.mockResponseJson, chaosConfig: demo.chaosConfig },
          token,
        );
    seeded.push(endpoint);
    const rules = describeChaos(endpoint.chaosConfig);
    console.log(
      `   ${match ? c.dim('updated') : c.green('created')}  ${c.magenta(endpoint.method.padEnd(4))} ${endpoint.path.padEnd(26)} ${c.dim(rules)}`,
    );
  }
  return seeded;
}

function describeChaos(config: ChaosConfig): string {
  if (!config.enabled) return 'chaos off';
  const parts: string[] = [];
  if (config.delayMs > 0) parts.push(`+${config.delayMs} ms`);
  if (config.failureRate > 0) parts.push(`${config.failureRate}% → ${config.overrideStatusCode ?? 500}`);
  if (config.corruptJson) parts.push('corrupt JSON');
  return parts.join(' · ') || 'chaos on (no rules)';
}

// ---------------------------------------------------------------------------------------------------------------
// Simulated mobile traffic through the chaos proxy
// ---------------------------------------------------------------------------------------------------------------

type Verdict = 'ok' | 'corrupted' | 'fault' | 'error';

interface Tally {
  ok: number;
  corrupted: number;
  fault: number;
  error: number;
  latencies: number[];
}

const PLATFORMS = ['ios', 'android'] as const;

async function fire(apiUrl: string, endpoint: EndpointData, sequence: number, tally: Tally): Promise<void> {
  const demo = DEMO_ENDPOINTS.find((item) => item.method === endpoint.method && item.path === endpoint.path);
  const body = endpoint.method === 'GET' ? undefined : JSON.stringify(demo?.requestBody ?? {});
  const platform = PLATFORMS[sequence % PLATFORMS.length] ?? 'ios';
  const started = performance.now();
  let status = 0;
  let applied = 'none';
  let verdict: Verdict;
  try {
    const response = await fetch(`${apiUrl}${endpoint.proxyPath}`, {
      method: endpoint.method,
      headers: {
        Accept: 'application/json',
        'x-client-platform': 'react-native',
        'x-pocketchaos-platform': platform,
        'Idempotency-Key': randomUUID(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.arrayBuffer();
    status = response.status;
    applied = response.headers.get('x-pocketchaos-applied') ?? 'none';
    const corrupted = /(?:^|,)corrupt_json:[1-9]/.test(applied);
    verdict = status >= 500 ? 'fault' : status >= 400 ? 'error' : corrupted ? 'corrupted' : 'ok';
  } catch {
    verdict = 'error';
  }
  const latency = Math.round(performance.now() - started);
  tally[verdict] += 1;
  tally.latencies.push(latency);

  const label = { ok: c.green('OK        '), corrupted: c.amber('CORRUPTED '), fault: c.red('CHAOS 5xx '), error: c.red('ERROR     ') }[verdict];
  const statusText = status ? String(status) : '---';
  const statusColor = verdict === 'ok' ? c.green : verdict === 'corrupted' ? c.amber : c.red;
  console.log(
    `   ${c.dim(`#${String(sequence).padStart(3, '0')}`)} ${c.dim(platform.padEnd(7))} ${c.magenta(endpoint.method.padEnd(4))} ${endpoint.path.padEnd(26)} ${statusColor(statusText)}  ${label} ${String(latency).padStart(5)} ms  ${c.dim(applied)}`,
  );
}

async function runTraffic(apiUrl: string, endpoints: EndpointData[], options: Options): Promise<void> {
  const tally: Tally = { ok: 0, corrupted: 0, fault: 0, error: 0, latencies: [] };
  let stopping = false;
  process.once('SIGINT', () => {
    stopping = true;
    console.log(c.dim('\n   Stopping after the current round…'));
  });

  console.log(
    `${c.bold('Simulated mobile traffic')} ${c.dim(`→ ${options.forever ? 'until Ctrl+C' : `${options.traffic} rounds × ${endpoints.length} requests`}, every ${options.intervalMs} ms`)}\n`,
  );
  let sequence = 0;
  for (let round = 1; options.forever || round <= options.traffic; round += 1) {
    if (stopping) break;
    // One round = the three screens of an app loading at once, like a real client would.
    await Promise.all(endpoints.map((endpoint) => fire(apiUrl, endpoint, (sequence += 1), tally)));
    if (stopping || (!options.forever && round === options.traffic)) break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }

  const total = tally.ok + tally.corrupted + tally.fault + tally.error;
  const average = tally.latencies.length ? Math.round(tally.latencies.reduce((sum, ms) => sum + ms, 0) / tally.latencies.length) : 0;
  console.log(
    `\n   ${c.bold(`${total} requests`)}  ${c.green(`${tally.ok} OK`)}  ${c.amber(`${tally.corrupted} corrupted`)}  ${c.red(`${tally.fault} chaos 5xx`)}${tally.error ? `  ${c.red(`${tally.error} errors`)}` : ''}  ${c.dim(`avg ${average} ms`)}\n`,
  );
}

// ---------------------------------------------------------------------------------------------------------------

const HELP = `PocketChaos demo seeder

Usage: node submission-assets/demo-seeder.ts [--traffic[=rounds]] [--forever] [--interval=ms] [--api=origin]

  --traffic[=N]   after seeding, fire N rounds of simulated mobile requests (default 8 rounds × 3 endpoints)
  --forever       keep firing rounds until Ctrl+C
  --interval=ms   pause between rounds (default 1200)
  --api=origin    backend origin (default: $POCKETCHAOS_API_URL or http://localhost:4000)

Env: POCKETCHAOS_API_URL, DEMO_EMAIL (default ${DEFAULT_EMAIL}), DEMO_PASSWORD (else .env.demo.local, generated once).`;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  await api<unknown>(options.apiUrl, 'GET', '/health');
  const credentials = resolveCredentials();
  const auth = await signIn(options.apiUrl, credentials.email, credentials.password);
  const where = relative(process.cwd(), CREDENTIALS_FILE) || CREDENTIALS_FILE;
  console.log(
    `\n   ${auth.registered ? c.green('Registered') : c.green('Signed in as')} ${c.bold(auth.user.email)} ${c.dim(`on ${options.apiUrl}`)}`,
  );
  console.log(
    c.dim(
      credentials.generated
        ? `   New demo password saved to ${where} (git-ignored). Use it to sign in to the web dashboard.`
        : `   Dashboard sign-in: ${auth.user.email}, password from ${process.env.DEMO_PASSWORD ? 'DEMO_PASSWORD' : where}.`,
    ),
  );

  banner(auth.projectKey, options.apiUrl);

  console.log(c.bold('Chaos endpoints'));
  const endpoints = await seedEndpoints(options.apiUrl, auth.token);
  console.log('');
  for (const demo of DEMO_ENDPOINTS) console.log(`   ${c.dim('•')} ${demo.path.padEnd(26)} ${c.dim(demo.shows)}`);
  console.log('');

  if (options.traffic > 0) await runTraffic(options.apiUrl, endpoints, options);
  else console.log(c.dim('   Tip: add --traffic to light up the dashboard telemetry, or --traffic --forever while recording.\n'));
}

main().catch((error: unknown) => {
  const message = error instanceof SeedError || error instanceof ApiCallError ? error.message : error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`\n   ${c.red('Demo seeder failed:')} ${message}\n`);
  process.exitCode = 1;
});
