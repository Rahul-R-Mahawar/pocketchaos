import { User } from '../models/User';
import { AppError } from '../utils/AppError';

export async function projectExists(projectKey: string): Promise<boolean> {
  return (await User.exists({ projectKey })) !== null;
}

export async function assertProjectExists(projectKey: string): Promise<void> {
  if (!(await projectExists(projectKey))) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'No project found for this key');
  }
}
