import type { UserData } from '../../data/contracts.js';
import type { UserRecord } from '../../types/domain.js';
import { resourceNotFound } from '../../utils/errors.js';

export class UserService {
  constructor(private readonly users: UserData) {}

  getMe(userId: string): Promise<UserRecord | null> {
    return this.users.getById(userId);
  }

  async updateDisplayName(userId: string, displayName: string | null): Promise<UserRecord> {
    const updated = await this.users.updateDisplayName(userId, displayName);
    if (!updated) {
      throw resourceNotFound();
    }
    return updated;
  }
}
