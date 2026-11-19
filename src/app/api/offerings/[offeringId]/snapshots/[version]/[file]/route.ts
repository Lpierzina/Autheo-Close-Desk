import { requireUser } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { csvDownload, route } from "@/server/http";
import { getSnapshotExport } from "@/server/services/approvals";

const FILES = { "register.csv": "register", "exceptions.csv": "exceptions" } as const;

export const GET = route<{ offeringId: string; version: string; file: string }>(async (_request, params) => {
  const user = await requireUser();
  const file = FILES[params.file as keyof typeof FILES];
  if (!file || !/^\d{1,6}$/.test(params.version)) throw new NotFoundError("Export not found.");
  const download = await getSnapshotExport(user, params.offeringId, Number(params.version), file);
  return csvDownload(download.filename, download.content, download.sha256);
});
