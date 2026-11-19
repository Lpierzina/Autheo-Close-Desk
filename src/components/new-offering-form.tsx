"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api-client";
import { Button, ButtonLink, Callout, Field, inputClass } from "./ui";

export function NewOfferingForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<{ name?: string; currency?: string; targetRaise?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const currency = String(form.get("currency") ?? "").trim().toUpperCase();
    const targetRaise = String(form.get("targetRaise") ?? "").trim();
    const next: typeof errors = {};
    if (name.length < 3) next.name = "Enter a name of at least three characters.";
    if (!/^[A-Z]{3}$/.test(currency)) next.currency = "Enter a three-letter currency code, such as USD.";
    if (targetRaise && !/^\$?\d{1,3}(,?\d{3})*(\.\d{1,2})?$/.test(targetRaise)) {
      next.targetRaise = "Enter an amount such as 5,000,000.00.";
    }
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) {
      const first = Object.keys(next)[0];
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setSaving(true);
    try {
      const { offering } = await api<{ offering: { id: string } }>("/api/offerings", {
        method: "POST",
        json: {
          name,
          propertyName: String(form.get("propertyName") ?? "").trim() || undefined,
          currency,
          targetRaise: targetRaise || undefined,
          addCreatorAsReviewer: form.get("addCreatorAsReviewer") === "on",
        },
      });
      router.push(`/offerings/${offering.id}/imports`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "The offering could not be created.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {failure ? <Callout tone="danger" role="alert" title={failure} /> : null}
      <Field label="Offering name" htmlFor="name" error={errors.name}>
        <input id="name" name="name" className={inputClass} autoComplete="off" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} />
      </Field>
      <Field label="Property" htmlFor="propertyName" optional hint="Shown next to the offering name. For example, the property address.">
        <input id="propertyName" name="propertyName" className={inputClass} autoComplete="off" aria-describedby="propertyName-hint" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Offering currency"
          htmlFor="currency"
          error={errors.currency}
          hint="Records in any other currency are flagged. Currencies are never netted."
        >
          <input id="currency" name="currency" defaultValue="USD" maxLength={3} className={`${inputClass} uppercase`} autoComplete="off" required aria-invalid={Boolean(errors.currency)} aria-describedby={errors.currency ? "currency-error" : "currency-hint"} />
        </Field>
        <Field label="Target raise" htmlFor="targetRaise" optional error={errors.targetRaise} hint="For reference on the overview. It does not affect reconciliation.">
          <input id="targetRaise" name="targetRaise" inputMode="decimal" placeholder="5,000,000.00" className={`${inputClass} num`} autoComplete="off" aria-invalid={Boolean(errors.targetRaise)} aria-describedby={errors.targetRaise ? "targetRaise-error" : "targetRaise-hint"} />
        </Field>
      </div>
      <label className="flex items-start gap-3 rounded-md border border-line bg-paper px-4 py-3">
        <input type="checkbox" name="addCreatorAsReviewer" defaultChecked className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
        <span>
          <span className="block text-sm font-medium text-ink">Add me as a reviewer</span>
          <span className="block text-[13px] text-ink-3">
            Reviewers import files and record decisions. Approval is a separate role, assigned on the Access tab.
          </span>
        </span>
      </label>
      <div className="flex items-center justify-end gap-2 border-t border-line pt-5">
        <ButtonLink href="/offerings" variant="ghost">
          Cancel
        </ButtonLink>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Creating…" : "Create offering"}
        </Button>
      </div>
    </form>
  );
}
