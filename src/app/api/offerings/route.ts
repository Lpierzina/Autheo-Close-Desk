import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { createOffering, listOfferings } from "@/server/services/offerings";

export const GET = route(async () => {
  const user = await requireUser();
  return json({ offerings: await listOfferings(user) });
});

export const POST = route(async (request) => {
  const user = await requireUser();
  const body = await readJson(request);
  const offering = await createOffering(user, {
    name: String(body.name ?? ""),
    propertyName: body.propertyName ? String(body.propertyName) : undefined,
    currency: String(body.currency ?? ""),
    targetRaise: body.targetRaise ? String(body.targetRaise) : undefined,
    addCreatorAsReviewer: body.addCreatorAsReviewer !== false,
  });
  return json({ offering }, { status: 201 });
});
