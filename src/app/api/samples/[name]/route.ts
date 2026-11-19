import { createHash } from "node:crypto";
import { requireUser } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { csvDownload, route } from "@/server/http";
import { SAMPLE_FILES } from "@/server/sample-files.generated";

/** Synthetic example files. Served only to signed-in, invited users, like everything else. */
export const GET = route<{ name: string }>(async (_request, { name }) => {
  await requireUser();
  const content = SAMPLE_FILES[name];
  if (!content) throw new NotFoundError("Example file not found.");
  return csvDownload(`riverbend-flats-${name}`, content, createHash("sha256").update(content).digest("hex"));
});
