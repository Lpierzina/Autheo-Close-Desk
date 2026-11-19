import type { ColumnMapping } from "@/domain/import-fields";
import { requireOfferingAccess } from "@/server/auth/access";
import { requireUser } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { json, readUpload, route } from "@/server/http";
import { commitImport, listBatches } from "@/server/services/imports";

export const GET = route<{ offeringId: string }>(async (_request, { offeringId }) => {
  const user = await requireUser();
  await requireOfferingAccess(user, offeringId, "view");
  return json({ batches: await listBatches(offeringId) });
});

export const POST = route<{ offeringId: string }>(async (request, { offeringId }) => {
  const user = await requireUser();
  const { file, fields } = await readUpload(request);
  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse(fields.mapping ?? "") as ColumnMapping;
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("not an object");
  } catch {
    throw new ValidationError("Confirm the column mapping before committing the import.");
  }
  const result = await commitImport(user, offeringId, {
    kind: fields.kind ?? "",
    file,
    mapping,
    expectedSha256: fields.expectedSha256 ?? "",
    skipInvalidRows: fields.skipInvalidRows === "true",
  });
  return json(result, { status: 201 });
});
