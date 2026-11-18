import { isUuid } from "@/server/auth/access";
import { requireUser } from "@/server/auth/session";
import { NotFoundError, ValidationError } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { setUserDisabled } from "@/server/services/users";

export const PATCH = route<{ userId: string }>(async (request, { userId }) => {
  const user = await requireUser();
  if (!isUuid(userId)) throw new NotFoundError("User not found.");
  const body = await readJson(request);
  if (typeof body.disabled !== "boolean") throw new ValidationError("Specify whether the user is disabled.");
  return json({ user: await setUserDisabled(user, userId, body.disabled) });
});
