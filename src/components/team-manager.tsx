"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { AppUser, InviteResult } from "@/server/services/users";
import { Button, Callout, Field, Pill, Td, Th, inputClass } from "./ui";

export function TeamManager({ users, currentUserId }: { users: AppUser[]; currentUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; title: string; body: string } | null>(null);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    setError(null);
    setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Enter a valid email address.");
      document.getElementById("invite-email")?.focus();
      return;
    }
    setEmailError(null);
    setBusy(true);
    try {
      const result = await api<InviteResult>("/api/users", {
        method: "POST",
        json: { email, displayName: String(data.get("displayName") ?? "").trim() || undefined, isAdmin: data.get("isAdmin") === "on" },
      });
      setNotice({
        tone: result.invitation.sent ? "ok" : "warn",
        title: result.created ? `${result.user.email} was added to the workspace` : `${result.user.email} is already in the workspace`,
        body: result.invitation.message,
      });
      form.reset();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The invitation could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function setDisabled(user: AppUser, disabled: boolean) {
    if (disabled && !window.confirm(`Disable ${user.email}? They will lose access immediately.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/users/${user.id}`, { method: "PATCH", json: { disabled } });
      setNotice({ tone: "ok", title: `${user.email} was ${disabled ? "disabled" : "re-enabled"}`, body: "" });
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <section className="rounded-lg border border-line bg-surface" aria-labelledby="people-heading">
        <div className="border-b border-line px-5 py-4">
          <h2 id="people-heading" className="text-[15px] font-semibold text-ink">
            People
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Everyone who can sign in. Offering roles are set on each offering&apos;s Access tab.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="border-b border-line bg-paper">
              <tr>
                <Th className="pl-5">Person</Th>
                <Th>Workspace role</Th>
                <Th>Status</Th>
                <Th>Invited</Th>
                <Th className="pr-5 text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((user) => (
                <tr key={user.id}>
                  <Td className="pl-5">
                    <p className="font-medium text-ink">
                      {user.displayName ?? user.email}
                      {user.id === currentUserId ? <span className="ml-1.5 font-normal text-ink-3">(you)</span> : null}
                    </p>
                    {user.displayName ? <p className="text-xs text-ink-3">{user.email}</p> : null}
                  </Td>
                  <Td>{user.isAdmin ? "Administrator" : "Member"}</Td>
                  <Td>
                    {user.status === "active" ? <Pill tone="ok">Active</Pill> : user.status === "invited" ? <Pill>Invited</Pill> : <Pill tone="warn">Disabled</Pill>}
                  </Td>
                  <Td className="num text-ink-2">{formatDate(user.createdAt)}</Td>
                  <Td className="pr-5 text-right">
                    {user.id === currentUserId ? null : user.status === "disabled" ? (
                      <Button disabled={busy} onClick={() => setDisabled(user, false)}>
                        Re-enable<span className="sr-only">: {user.email}</span>
                      </Button>
                    ) : (
                      <Button variant="danger" disabled={busy} onClick={() => setDisabled(user, true)}>
                        Disable<span className="sr-only">: {user.email}</span>
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="text-[15px] font-semibold text-ink">
          Invite a person
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-3">
          They receive an email with a link to create their login. Access applies only to the verified address you enter.
        </p>
        <form onSubmit={invite} noValidate className="mt-4 space-y-4">
          {error ? <Callout tone="danger" role="alert" title={error} /> : null}
          {notice ? (
            <Callout tone={notice.tone} role="status" title={notice.title}>
              {notice.body || null}
            </Callout>
          ) : null}
          <Field label="Email address" htmlFor="invite-email" error={emailError}>
            <input id="invite-email" name="email" type="email" autoComplete="off" className={inputClass} aria-invalid={Boolean(emailError)} aria-describedby={emailError ? "invite-email-error" : undefined} />
          </Field>
          <Field label="Name" htmlFor="invite-name" optional>
            <input id="invite-name" name="displayName" autoComplete="off" className={inputClass} />
          </Field>
          <label className="flex items-start gap-3 rounded-md border border-line bg-paper px-4 py-3">
            <input type="checkbox" name="isAdmin" className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
            <span>
              <span className="block text-sm font-medium text-ink">Workspace administrator</span>
              <span className="block text-[13px] text-ink-3">Can create offerings, invite people and manage access. Sees every offering.</span>
            </span>
          </label>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Inviting…" : "Send invitation"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
