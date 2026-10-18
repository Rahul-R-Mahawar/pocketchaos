declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` once the bearer token has been verified. */
      auth?: { userId: string };
    }
  }
}

export {};
