import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { listMembers, setMember } from "@/server/services/offerings";

export const GET = route<{ offeringId: string }>(async (_request, { offeringId }) => {
  const user = await requireUser();
  return json({ members: await listMembers(user, offeringId) });
});

export const POST = route<{ offeringId: string }>(async (request, { offeringId }) => {
  const user = await requireUser();
  const body = await readJson(request);
  await setMember(user, offeringId, { email: String(body.email ?? ""), role: body.role as "reviewer" | "approver" });
  return json({ members: await listMembers(user, offeringId) }, { status: 201 });
});
