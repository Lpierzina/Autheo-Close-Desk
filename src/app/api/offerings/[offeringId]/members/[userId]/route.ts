import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { removeMember } from "@/server/services/offerings";

export const DELETE = route<{ offeringId: string; userId: string }>(async (_request, { offeringId, userId }) => {
  const user = await requireUser();
  await removeMember(user, offeringId, userId);
  return json({ removed: true });
});
