import { Router } from 'express';
import { login, register } from '../controllers/auth.controller';
import { noInput, validate } from '../middleware/validate';
import { loginSchema, registerSchema } from '../validators/auth.schema';

export const authRouter = Router();

authRouter.post('/register', validate({ body: registerSchema, params: noInput, query: noInput }), register);
authRouter.post('/login', validate({ body: loginSchema, params: noInput, query: noInput }), login);
