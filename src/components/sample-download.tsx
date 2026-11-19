"use client";

import { Download } from "lucide-react";
import { downloadText } from "@/lib/download";
import { sampleFileText } from "@/session/sample";
import { Button, cx } from "./ui";

/** Saves one of the bundled synthetic CSV files. The text is already in the page; no request is made. */
export function SampleDownload({ filename, children, variant = "secondary", className }: { filename: string; children: string; variant?: "secondary" | "ghost" | "link"; className?: string }) {
  const save = () => downloadText(filename, sampleFileText(filename));
  if (variant === "link") {
    return (
      <button type="button" onClick={save} className={cx("inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-accent-strong underline-offset-2 hover:underline", className)}>
        <Download aria-hidden className="h-3.5 w-3.5" />
        {children}
      </button>
    );
  }
  return (
    <Button variant={variant} onClick={save} className={className}>
      <Download aria-hidden className="h-4 w-4" />
      {children}
    </Button>
  );
}
