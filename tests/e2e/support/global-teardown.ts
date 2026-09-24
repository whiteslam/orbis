import { existsSync, rmSync } from 'node:fs';
import { AUTH_DIR, USERS_FILE, readUsers, supabaseAdmin } from './env';

// Deletes both test users. Their rows cascade; uploaded files are removed explicitly.
export default async function globalTeardown() {
  if (!existsSync(USERS_FILE)) return;
  const admin = supabaseAdmin();
  const users = readUsers();
  for (const user of Object.values(users)) {
    await admin.deleteUserFiles(user.id);
    await admin.deleteUser(user.id);
  }
  rmSync(AUTH_DIR, { recursive: true, force: true });
}
