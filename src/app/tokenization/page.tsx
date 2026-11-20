import type { Metadata } from "next";
import { ButtonLink, Card, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Custom tokenization" };

const TODAY = [
  "Compares your subscription, funding and allocation files in your browser.",
  "Shows what doesn't match and records how each exception was reviewed.",
  "Exports a reviewed ownership register and an exceptions report as CSV for your administrator.",
];

const NOT = [
  "It does not issue, mint or transfer tokens, units or any other instrument.",
  "It does not connect to a blockchain, a wallet or a transfer agent.",
  "It does not move money, and it is not the official legal register.",
];

export default function TokenizationPage() {
  return (
    <main className="mx-auto max-w-[860px] px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight text-heading">Custom tokenization</h1>
        <Pill>Coming soon</Pill>
      </div>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-2">
        Some sponsors want ownership interests in an apartment community represented as tokens. Any issuance has to start from an accurate record of
        who owns what, and a reviewed ownership register could inform that step in the future.
      </p>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-2">
        Close Desk itself is an off-chain reconciliation tool. Custom tokenization is not available yet, and nothing you do in Close Desk today creates
        or commits you to a token.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">What Close Desk does today</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
            {TODAY.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">What it does not do</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
            {NOT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold text-ink">How a reviewed register could be used later</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          The register export lists, for each investor reference and share class, the amount and units the sponsor approved after every exception was
          reviewed. If tokenization is offered, a register of that kind could be the starting record an issuance is checked against. How that would
          work, and under which legal and regulatory terms, has not been decided.
        </p>
      </Card>

      <p className="mt-6 text-[13px] leading-relaxed text-ink-3">
        This page is information only. It does not ask for a wallet address, investor information or deal files, and there is nothing to sign up for
        here.
      </p>

      <div className="mt-8">
        <ButtonLink href="/">Back to Close Desk</ButtonLink>
      </div>
    </main>
  );
}
