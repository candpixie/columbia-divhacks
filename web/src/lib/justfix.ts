// Links out to JustFix tools for a building. No API calls: plain URLs only.
// Formats checked 2026-09-26 against JustFixNYC/who-owns-what routes.tsx (/bbl/:bbl(\d{10}))
// and the pages app.justfix.org redirects to. goodcausenyc.org has no public per-building
// deep link (its prefill params are internal session JSON), so it links to the address search.

export type Building = {
  bbl: string; // 10 digits: boro(1) block(5) lot(4)
  stab_units: number;
  open_hpd_violations: number;
  good_cause_likely: boolean;
};

export type JustFixLink = {
  id: "who_owns_what" | "rent_history" | "letter_of_complaint" | "good_cause";
  label: string;
  url: string;
  why: string;
};

export const JUSTFIX_URLS = {
  whoOwnsWhat: (bbl: string) => `https://whoownswhat.justfix.org/en/bbl/${bbl}`,
  rentHistory: "https://app.justfix.org/en/rh/splash",
  letterOfComplaint: "https://app.justfix.org/en/loc/splash",
  goodCause: "https://goodcausenyc.org/en",
};

export function getJustFixLinks(b: Building): JustFixLink[] {
  const links: JustFixLink[] = [];
  if (/^\d{10}$/.test(b.bbl)) {
    links.push({
      id: "who_owns_what",
      label: "Who owns this building",
      url: JUSTFIX_URLS.whoOwnsWhat(b.bbl),
      why: "Landlord, their other buildings, violations and evictions",
    });
  }
  if (b.stab_units > 0) {
    links.push({
      id: "rent_history",
      label: "Request your rent history",
      url: JUSTFIX_URLS.rentHistory,
      why: `${b.stab_units} rent-stabilized unit${b.stab_units === 1 ? "" : "s"} registered here`,
    });
  }
  if (b.open_hpd_violations > 0) {
    links.push({
      id: "letter_of_complaint",
      label: "Send a letter of complaint",
      url: JUSTFIX_URLS.letterOfComplaint,
      why: `${b.open_hpd_violations} open HPD violation${b.open_hpd_violations === 1 ? "" : "s"} (class B/C)`,
    });
  }
  if (b.good_cause_likely) {
    links.push({
      id: "good_cause",
      label: "Check Good Cause Eviction coverage",
      url: JUSTFIX_URLS.goodCause,
      why: "Building likely meets Good Cause criteria; your rent and lease decide the rest",
    });
  }
  return links;
}
