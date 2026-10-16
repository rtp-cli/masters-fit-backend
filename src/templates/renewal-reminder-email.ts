import {
  accountLayout,
  firstNameOf,
  type RenderedEmail,
} from "@/templates/email-layouts";

interface RenewalReminderTemplateProps {
  /** User's display name; a first name is derived for the greeting. */
  name: string;
  /**
   * "annual" | "monthly" — the subscription's billing period, for the copy and
   * the "{price} · {period} plan" line. "" on a (rare) plan-lookup miss.
   */
  planLabel: string;
  /** Formatted price, e.g. "$89.99". Null when the plan couldn't be resolved. */
  price: string | null;
  /** Formatted renewal date, e.g. "August 12, 2026". */
  renewalDate: string;
  /** Where "manage or cancel anytime" points. */
  manageUrl: string;
}

/**
 * The pre-renewal reminder, to monthly AND annual subscribers. Type 4,
 * account & billing: logo header, a heading, the renewal box, unsigned,
 * transactional footer with the "why you got this" line. The billing period
 * always comes from the subscription — never hard-code "annual".
 */
export const renewalReminderTemplate = ({
  name,
  planLabel,
  price,
  renewalDate,
  manageUrl,
}: RenewalReminderTemplateProps): RenderedEmail => {
  // planLabel is "" only on a (rare) plan-lookup miss; keep phrasing clean.
  const membership = planLabel ? `${planLabel} membership` : "membership";
  const planLine = planLabel ? `${planLabel} plan` : "MastersFit+";

  // Annual reads "for another year"; monthly just "automatically".
  const continues =
    planLabel === "annual"
      ? "will automatically continue for another year"
      : "will continue automatically";

  return accountLayout({
    title: `Your MastersFit+ renews on ${renewalDate}`,
    preheader: `A quick heads-up before your ${membership} renews on ${renewalDate} — no action needed to continue.`,
    heading: "Your MastersFit+ renews soon",
    firstName: firstNameOf(name),
    blocks: [
      {
        kind: "paragraph",
        text: `Just a heads-up: your MastersFit+ ${membership} renews on ${renewalDate}, and your subscription ${continues}.`,
      },
      {
        kind: "detail",
        label: "Renews on",
        value: renewalDate,
        sub: price ? `${price} · ${planLine}` : planLine,
      },
      {
        kind: "paragraph",
        text: "Nothing to do if you’re staying — your workouts, history, and streak keep going without interruption. If you’d like to make a change first, you can manage or cancel anytime.",
        link: { text: "manage or cancel anytime", href: manageUrl, bold: true },
      },
    ],
    footerNote:
      "You’re receiving this because you have an active MastersFit+ subscription.",
  });
};
