import { existsSync, rmSync } from 'node:fs';
import { AUTH_DIR, USERS_FILE, readUsers, supabaseAdmin } from './env';

// Deletes both test users. Their rows cascade; uploaded files are removed explicitly.
export default async function globalTeardown() {
  const admin = supabaseAdmin();
  // The waitlist has no user_id to cascade from, so the addresses the public
  // spec joined with are removed by name.
  await admin.deleteRows('waitlist', 'email=like.orbis-qa-waitlist-%25*').catch(() => undefined);
  if (!existsSync(USERS_FILE)) return;
  const users = readUsers();
  for (const user of Object.values(users)) {
    await admin.deleteUserFiles(user.id);
    await admin.deleteUser(user.id);
  }
  rmSync(AUTH_DIR, { recursive: true, force: true });
}
