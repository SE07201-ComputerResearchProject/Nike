// types/express/index.d.ts
import { IUser } from '../index';

declare global {
  namespace Express {
    export interface Request {
      // Define the user object attached by authentication middleware
      user?: Partial<IUser>;
      
      // Define the meta object attached by security middleware
      meta?: {
        ip?: string;
        [key: string]: any;
      };
      
      // Request ID attached for logging
      requestId?: string;
    }
  }
}