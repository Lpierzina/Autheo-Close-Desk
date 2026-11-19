import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/workspace";

export const metadata: Metadata = { title: "Reconciliation" };

export default function ReconcilePage() {
  return <Workspace />;
}
