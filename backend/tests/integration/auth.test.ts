import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../../src/app';
import { User } from '../../src/models/User';
import { app, expectErrorEnvelope, registerUser, TEST_PASSWORD, uniqueEmail } from '../helpers/api';
import { useTestDatabase } from '../helpers/db';

useTestDatabase();

describe('POST /api/auth/register', () => {
  it('creates a user and returns a JWT plus a 6-character uppercase projectKey', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ada@example.com', password: TEST_PASSWORD })
      .expect(201);

    expect(res.body).toMatchObject({ success: true, error: null });
    const { token, projectKey, user } = res.body.data;
    expect(projectKey).toMatch(/^[A-Z0-9]{6}$/);
    expect(user).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      email: 'ada@example.com',
      projectKey,
      createdAt: expect.any(String),
    });

    const payload = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    expect(payload.sub).toBe(user.id);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('stores a bcrypt hash and never returns it', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'hash@example.com', password: TEST_PASSWORD })
      .expect(201);

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|correct-horse/);
    const stored = await User.findOne({ email: 'hash@example.com' }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('normalises the email (trim + lowercase)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: '  Mixed.Case@Example.COM ', password: TEST_PASSWORD })
      .expect(201);
    expect(res.body.data.user.email).toBe('mixed.case@example.com');
  });

  it('gives every user a distinct projectKey', async () => {
    const users = await Promise.all(Array.from({ length: 8 }, () => registerUser()));
    expect(new Set(users.map((u) => u.projectKey)).size).toBe(8);
  });

  it('rejects a duplicate email (case-insensitive) with 409 EMAIL_TAKEN', async () => {
    await registerUser('taken@example.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'TAKEN@example.com', password: TEST_PASSWORD })
      .expect(409);
    expectErrorEnvelope(res.body, 'EMAIL_TAKEN');
  });

  it.each([
    ['missing email', { password: TEST_PASSWORD }],
    ['missing password', { email: 'a@example.com' }],
    ['invalid email', { email: 'not-an-email', password: TEST_PASSWORD }],
    ['email as a number', { email: 12345, password: TEST_PASSWORD }],
    ['password shorter than 8', { email: 'a@example.com', password: 'short' }],
    ['password longer than 72 bytes', { email: 'a@example.com', password: 'é'.repeat(40) }],
    ['password as an object', { email: 'a@example.com', password: { $gt: '' } }],
    ['unknown field (mass assignment)', { email: 'a@example.com', password: TEST_PASSWORD, projectKey: 'AAAAAA' }],
    ['empty object', {}],
    ['array body', [{ email: 'a@example.com', password: TEST_PASSWORD }]],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const res = await request(app).post('/api/auth/register').send(body as object).expect(400);
    expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.any(String) })]),
    );
  });

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@example.com", ')
      .expect(400);
    expectErrorEnvelope(res.body, 'INVALID_JSON');
  });

  it('rejects bodies over 100kb with 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'big@example.com', password: TEST_PASSWORD, padding: 'x'.repeat(120_000) })
      .expect(413);
    expectErrorEnvelope(res.body, 'PAYLOAD_TOO_LARGE');
  });
});

describe('POST /api/auth/login', () => {
  it('returns a fresh JWT and the same projectKey as registration', async () => {
    const registered = await registerUser('login@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'LOGIN@example.com', password: TEST_PASSWORD })
      .expect(200);

    expect(res.body.data.projectKey).toBe(registered.projectKey);
    expect(res.body.data.user.id).toBe(registered.user.id);
    expect(jwt.verify(res.body.data.token, process.env.JWT_SECRET as string)).toMatchObject({ sub: registered.user.id });
  });

  it('returns 401 INVALID_CREDENTIALS for a wrong password', async () => {
    await registerUser('wrongpass@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpass@example.com', password: 'not-the-password' })
      .expect(401);
    expectErrorEnvelope(res.body, 'INVALID_CREDENTIALS');
  });

  it('returns the identical 401 for an unknown email (no account enumeration)', async () => {
    await registerUser('known@example.com');
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'known@example.com', password: 'nope-nope-1' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail('ghost'), password: 'nope-nope-1' });

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('rejects NoSQL operator injection in credentials with 400', async () => {
    await registerUser('victim@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } })
      .expect(400);
    expectErrorEnvelope(res.body, 'VALIDATION_ERROR');
  });
});

describe('rate limiting (default app configuration)', () => {
  it('returns 429 RATE_LIMITED in the standard envelope after 30 auth attempts', async () => {
    const limitedApp = createApp();
    for (let i = 0; i < 30; i += 1) {
      await request(limitedApp).post('/api/auth/login').send({}).expect(400);
    }
    const res = await request(limitedApp).post('/api/auth/login').send({}).expect(429);
    expectErrorEnvelope(res.body, 'RATE_LIMITED');
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });
});
