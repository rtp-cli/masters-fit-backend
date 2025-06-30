import { db } from '@/config/database.js';
import { eq } from 'drizzle-orm';

export class BaseService {
  protected db = db;
  protected eq = eq;
} 