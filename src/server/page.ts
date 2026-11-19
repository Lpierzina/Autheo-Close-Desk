import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getOfferingAccess, type Offering, type OfferingAccess } from "./auth/access";
import { getAuthConfig } from "./auth/config";
import { requireUser } from "./auth/session";
import { DatabaseUnavailableError, NotFoundError, NotInvitedError, UnauthenticatedError } from "./errors";
import { getCloseReadiness, type CloseReadiness } from "./services/approvals";
import { loadWorkingState, type WorkingState } from "./services/reconciliation";
import type { AppUser } from "./services/users";

export function signInPath(): string {
  return getAuthConfig().mode === "dev" ? "/dev/sign-in" : "/sign-in";
}

/** Server-side gate for every page: a session that maps to an invited, active user. */
export const pageUser = cache(async (): Promise<AppUser> => {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect(signInPath());
    if (error instanceof NotInvitedError) redirect("/no-access");
    // Without a database nobody can be recognised. Say what to fix instead of a generic error page.
    if (error instanceof DatabaseUnavailableError) redirect("/unavailable");
    throw error;
  }
});

/** Server-side gate for every offering page. Unknown and inaccessible offerings both render "not found". */
export const pageOffering = cache(async (offeringId: string): Promise<{ user: AppUser; access: OfferingAccess }> => {
  const user = await pageUser();
  try {
    return { user, access: await getOfferingAccess(user, offeringId) };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

const workingStateById = cache(async (id: string, currency: string): Promise<WorkingState> => {
  return loadWorkingState({ id, currency });
});

/** Reconciles once per request, however many components ask. Call only after pageOffering(). */
export function pageWorkingState(offering: Offering): Promise<WorkingState> {
  return workingStateById(offering.id, offering.currency);
}

export async function pageReadiness(offering: Offering): Promise<CloseReadiness> {
  return getCloseReadiness(offering, await pageWorkingState(offering));
}

export interface OfferingStatus {
  label: string;
  tone: "neutral" | "ok" | "warn" | "danger";
}

export function offeringStatus(readiness: CloseReadiness, filesImported: number): OfferingStatus {
  const { latest, workingMatchesLatest, openItems } = readiness;
  if (latest && workingMatchesLatest) return { label: `Approved · v${latest.version}`, tone: "ok" };
  if (latest) return { label: `v${latest.version} approved · changes since`, tone: "warn" };
  if (filesImported === 0) return { label: "Draft", tone: "neutral" };
  if (filesImported < 3) return { label: "Importing", tone: "neutral" };
  if (openItems.some((i) => i.severity === "blocker")) return { label: "In review · blocked", tone: "danger" };
  if (openItems.length > 0) return { label: "In review", tone: "warn" };
  return { label: "Ready to approve", tone: "ok" };
}
