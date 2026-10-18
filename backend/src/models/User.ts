import { Schema, model, type HydratedDocument } from 'mongoose';
import { PROJECT_KEY_REGEX } from '../utils/projectKey';

export interface IUser {
  email: string;
  passwordHash: string;
  /** 6-char uppercase pairing code shared by all of this user's endpoints (mobile pairing + proxy URLs). */
  projectKey: string;
  createdAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    projectKey: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      match: PROJECT_KEY_REGEX,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const User = model<IUser>('User', userSchema);
