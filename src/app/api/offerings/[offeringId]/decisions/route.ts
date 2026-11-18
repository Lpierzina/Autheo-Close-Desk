import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { recordDecision, type DecisionInput } from "@/server/services/decisions";

export const POST = route<{ offeringId: string }>(async (request, { offeringId }) => {
  const user = await requireUser();
  const body = await readJson(request);
  const result = await recordDecision(user, offeringId, body as unknown as DecisionInput);
  return json(result, { status: 201 });
});
