import "server-only";
import { NotInvitedError, UnauthenticatedError } from "../errors";
import { bindInvitedUser, findUserBySubject, type AppUser } from "../services/users";
import { getSessionIdentity } from "./identity";

/**
 * Resolves the signed-in identity to an invited Close Desk user.
 *
 * A session alone grants nothing. The identity must match a user record that an
 * administrator created; the first sign-in binds the provider subject to that record
 * through a verified email address.
 */
export async function requireUser(): Promise<AppUser> {
  const identity = await getSessionIdentity();
  if (!identity) throw new UnauthenticatedError();

  let user = await findUserBySubject(identity.subject);
  if (!user) {
    const profile = await identity.loadProfile();
    user = await bindInvitedUser(identity.subject, profile.verifiedEmails, profile.displayName);
  }
  if (!user || user.status !== "active") throw new NotInvitedError();
  return user;
}
