import type { ColumnMapping } from "@/domain/import-fields";
import { requireUser } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { json, readUpload, route } from "@/server/http";
import { previewImport } from "@/server/services/imports";

function parseMapping(value: string | undefined): ColumnMapping | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as ColumnMapping;
  } catch {
    // fall through
  }
  throw new ValidationError("The column mapping could not be read.");
}

export const POST = route<{ offeringId: string }>(async (request, { offeringId }) => {
  const user = await requireUser();
  const { file, fields } = await readUpload(request);
  const preview = await previewImport(user, offeringId, fields.kind ?? "", file, parseMapping(fields.mapping));
  return json({ preview });
});
