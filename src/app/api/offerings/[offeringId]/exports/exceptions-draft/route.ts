import { requireUser } from "@/server/auth/session";
import { csvDownload, route } from "@/server/http";
import { getDraftExceptionsExport } from "@/server/services/approvals";

export const GET = route<{ offeringId: string }>(async (_request, { offeringId }) => {
  const user = await requireUser();
  const download = await getDraftExceptionsExport(user, offeringId);
  return csvDownload(download.filename, download.content, download.sha256);
});
