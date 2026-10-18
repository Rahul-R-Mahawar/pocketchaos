import bcrypt from 'bcryptjs';
import type { RequestHandler } from 'express';
import { signAccessToken } from '../middleware/auth';
import { isDuplicateKeyError } from '../middleware/errorHandler';
import { User, type UserDocument } from '../models/User';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import { generateProjectKey } from '../utils/projectKey';
import type { LoginInput, RegisterInput } from '../validators/auth.schema';

const BCRYPT_ROUNDS = 12;
const PROJECT_KEY_ATTEMPTS = 5;

// Compared against when the email is unknown, so "no such user" and "wrong password" take the same time.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash('pocketchaos-timing-equaliser', BCRYPT_ROUNDS);
  return dummyHashPromise;
}

function buildAuthPayload(user: UserDocument) {
  return {
    token: signAccessToken(user.id),
    projectKey: user.projectKey,
    user: {
      id: user.id,
      email: user.email,
      projectKey: user.projectKey,
      createdAt: user.createdAt,
    },
  };
}

async function createUserWithUniqueProjectKey(email: string, passwordHash: string): Promise<UserDocument> {
  for (let attempt = 0; attempt < PROJECT_KEY_ATTEMPTS; attempt += 1) {
    try {
      return await User.create({ email, passwordHash, projectKey: generateProjectKey() });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      if (err.keyPattern?.email) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      // projectKey collision: roll a new key and retry.
    }
  }
  throw new AppError(503, 'PROJECT_KEY_UNAVAILABLE', 'Could not allocate a project key, please retry');
}

// Bodies are validated by the route's `validate` middleware before these handlers run.
export const register: RequestHandler<Record<string, never>, unknown, RegisterInput> = async (req, res) => {
  const { email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await createUserWithUniqueProjectKey(email, passwordHash);
  sendSuccess(res, buildAuthPayload(user), 201);
};

export const login: RequestHandler<Record<string, never>, unknown, LoginInput> = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');

  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !passwordMatches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  sendSuccess(res, buildAuthPayload(user));
};
