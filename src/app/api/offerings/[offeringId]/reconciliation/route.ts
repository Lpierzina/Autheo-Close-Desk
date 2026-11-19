import { requireOfferingAccess } from "@/server/auth/access";
import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { loadWorkingState } from "@/server/services/reconciliation";
import { toTableRow } from "@/server/view-models";

export const GET = route<{ offeringId: string }>(async (_request, { offeringId }) => {
  const user = await requireUser();
  const access = await requireOfferingAccess(user, offeringId, "view");
  const state = await loadWorkingState(access.offering);
  return json({
    fingerprint: state.fingerprint,
    summary: state.result.summary,
    rows: state.result.rows.map(toTableRow),
  });
});
