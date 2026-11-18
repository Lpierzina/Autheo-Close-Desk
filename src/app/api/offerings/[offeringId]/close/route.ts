import { requireOfferingAccess } from "@/server/auth/access";
import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { getCloseReadiness } from "@/server/services/approvals";

export const GET = route<{ offeringId: string }>(async (_request, { offeringId }) => {
  const user = await requireUser();
  const access = await requireOfferingAccess(user, offeringId, "view");
  const readiness = await getCloseReadiness(access.offering);
  return json({ readiness, canApprove: access.can.approve && readiness.canApprove });
});
