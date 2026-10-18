import { Router } from 'express';
import { listLogs } from '../controllers/logs.controller';

export const logsRouter = Router();

logsRouter.get('/:projectKey', listLogs);
