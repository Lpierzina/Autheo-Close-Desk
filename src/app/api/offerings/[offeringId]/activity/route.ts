import { requireOfferingAccess } from "@/server/auth/access";
import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listAudit } from "@/server/services/audit";

export const GET = route<{ offeringId: string }>(async (_request, { offeringId }) => {
  const user = await requireUser();
  await requireOfferingAccess(user, offeringId, "view");
  return json({ events: await listAudit(offeringId) });
});
