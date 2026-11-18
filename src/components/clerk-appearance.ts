/** Matches Clerk's prebuilt forms to the Close Desk palette and hides the self-service sign-up prompt. */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#0f766e",
    colorText: "#1b2533",
    colorTextSecondary: "#6a7483",
    colorBackground: "#fffefb",
    colorInputBackground: "#fffefb",
    borderRadius: "6px",
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
    fontSize: "14px",
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", boxShadow: "none", border: "1px solid #e7e2d8" },
    card: { boxShadow: "none" },
    header: { display: "none" },
    footerAction: { display: "none" },
  },
} as const;
