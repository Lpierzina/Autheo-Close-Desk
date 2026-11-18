import { requireUser } from "@/server/auth/session";
import { ForbiddenError } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { inviteUser, listUsers } from "@/server/services/users";

export const GET = route(async () => {
  const user = await requireUser();
  if (!user.isAdmin) throw new ForbiddenError("Only workspace administrators can view the user list.");
  return json({ users: await listUsers() });
});

export const POST = route(async (request) => {
  const user = await requireUser();
  const body = await readJson(request);
  const result = await inviteUser(user, {
    email: String(body.email ?? ""),
    displayName: body.displayName ? String(body.displayName) : undefined,
    isAdmin: body.isAdmin === true,
  });
  return json(result, { status: result.created ? 201 : 200 });
});
