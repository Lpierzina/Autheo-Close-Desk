"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { Member } from "@/server/services/offerings";
import { Button, Callout, EmptyState, Pill, Td, Th, inputClass } from "./ui";

const ROLE_LABEL = { reviewer: "Reviewer", approver: "Approver" } as const;

export function AccessManager({
  offeringId,
  members,
  candidates,
  canManage,
}: {
  offeringId: string;
  members: Member[];
  /** Invited workspace users, offered as suggestions. Empty unless the viewer is an administrator. */
  candidates: { email: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const role = String(data.get("role") ?? "reviewer");
    if (!email) {
      setError("Enter the email address of an invited user.");
      return;
    }
    await run(
      () => api(`/api/offerings/${offeringId}/members`, { method: "POST", json: { email, role } }),
      `${email} is now ${role === "approver" ? "an approver" : "a reviewer"} on this offering.`,
    );
    form.reset();
  }

  return (
    <div className="space-y-4">
      {error ? <Callout tone="danger" role="alert" title={error} /> : null}
      {notice ? <Callout tone="ok" role="status" title={notice} /> : null}

      {members.length === 0 ? (
        <EmptyState
          title="No one has been added to this offering"
          description="Add at least one reviewer to import and review, and one approver to approve the close."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="border-b border-line bg-paper">
              <tr>
                <Th className="pl-5">Person</Th>
                <Th>Role on this offering</Th>
                <Th>Sign-in</Th>
                {canManage ? <Th className="pr-5 text-right">Actions</Th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((member) => (
                <tr key={member.userId}>
                  <Td className="pl-5">
                    <p className="font-medium text-ink">{member.displayName ?? member.email}</p>
                    {member.displayName ? <p className="text-xs text-ink-3">{member.email}</p> : null}
                  </Td>
                  <Td>{ROLE_LABEL[member.role]}</Td>
                  <Td>
                    {member.status === "active" ? <Pill tone="ok">Active</Pill> : member.status === "invited" ? <Pill>Invited, not signed in yet</Pill> : <Pill tone="warn">Disabled</Pill>}
                  </Td>
                  {canManage ? (
                    <Td className="pr-5 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                api(`/api/offerings/${offeringId}/members`, {
                                  method: "POST",
                                  json: { email: member.email, role: member.role === "reviewer" ? "approver" : "reviewer" },
                                }),
                              `${member.email} is now ${member.role === "reviewer" ? "an approver" : "a reviewer"}.`,
                            )
                          }
                        >
                          Make {member.role === "reviewer" ? "approver" : "reviewer"}
                          <span className="sr-only">: {member.email}</span>
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Remove ${member.email} from this offering?`)) return;
                            void run(() => api(`/api/offerings/${offeringId}/members/${member.userId}`, { method: "DELETE" }), `${member.email} was removed from this offering.`);
                          }}
                        >
                          Remove
                          <span className="sr-only">: {member.email}</span>
                        </Button>
                      </div>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <form onSubmit={add} className="grid gap-3 border-t border-line px-5 py-5 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
          <div>
            <label htmlFor="member-email" className="mb-1.5 block text-[13px] font-medium text-ink">
              Add an invited user
            </label>
            <input id="member-email" name="email" type="email" list="member-candidates" autoComplete="off" placeholder="name@company.com" className={inputClass} />
            <datalist id="member-candidates">
              {candidates.map((c) => (
                <option key={c.email} value={c.email}>
                  {c.label}
                </option>
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="member-role" className="mb-1.5 block text-[13px] font-medium text-ink">
              Role
            </label>
            <select id="member-role" name="role" className={inputClass} defaultValue="reviewer">
              <option value="reviewer">Reviewer</option>
              <option value="approver">Approver</option>
            </select>
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            Add to offering
          </Button>
        </form>
      ) : null}
    </div>
  );
}
