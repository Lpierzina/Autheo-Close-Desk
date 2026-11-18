import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { approveClose } from "@/server/services/approvals";

export const POST = route<{ offeringId: string }>(async (request, { offeringId }) => {
  const user = await requireUser();
  const body = await readJson(request);
  const snapshot = await approveClose(user, offeringId, {
    expectedFingerprint: String(body.expectedFingerprint ?? ""),
    note: body.note ? String(body.note) : undefined,
  });
  return json({ snapshot }, { status: 201 });
});
