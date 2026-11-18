import { requireOfferingAccess } from "@/server/auth/access";
import { requireUser } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { json, route } from "@/server/http";
import { decisionHistory, loadWorkingState } from "@/server/services/reconciliation";

export const GET = route<{ offeringId: string }>(async (request, { offeringId }) => {
  const user = await requireUser();
  const access = await requireOfferingAccess(user, offeringId, "view");
  const key = request.nextUrl.searchParams.get("key") ?? "";
  const state = await loadWorkingState(access.offering);
  const row = state.result.rows.find((r) => r.key === key);
  if (!row) throw new NotFoundError("That row is not in the current reconciliation.");
  return json({ row, history: decisionHistory(row, state), canReview: access.can.review });
});
