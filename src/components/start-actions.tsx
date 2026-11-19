"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, FlaskConical } from "lucide-react";
import { isEmptySession } from "@/session/engine";
import { startSampleSession } from "@/session/sample";
import { useSession } from "@/session/store";
import { ConfirmDialog } from "./confirm-dialog";
import { Button, ButtonLink } from "./ui";

/** The two ways into the workspace: with your own files, or with the bundled synthetic deal. */
export function StartActions({ size = "lg" }: { size?: "lg" | "md" }) {
  const router = useRouter();
  const { state, run, clear } = useSession();
  const [confirming, setConfirming] = useState(false);
  const inProgress = !isEmptySession(state);

  function loadSample() {
    setConfirming(false);
    clear();
    run(() => startSampleSession());
    router.push("/reconcile");
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ButtonLink href="/reconcile" variant="primary" size={size}>
        {inProgress ? "Continue your reconciliation" : "Start a reconciliation"}
        <ArrowRight aria-hidden className="h-4 w-4" />
      </ButtonLink>
      <Button size={size} onClick={() => (inProgress ? setConfirming(true) : loadSample())}>
        <FlaskConical aria-hidden className="h-4 w-4 text-ink-3" />
        Try with sample data
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Replace this session with sample data?"
        confirmLabel="Replace with sample data"
        danger
        onConfirm={loadSample}
        onCancel={() => setConfirming(false)}
      >
        <p>The files, column mappings and decisions in this tab will be cleared and the synthetic Riverbend Flats files loaded instead.</p>
        <p>Your source files and anything you have already downloaded stay on your device.</p>
      </ConfirmDialog>
    </div>
  );
}
