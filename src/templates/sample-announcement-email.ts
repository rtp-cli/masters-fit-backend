import {
  announcementLayout,
  firstNameOf,
  type RenderedEmail,
} from "@/templates/email-layouts";

/**
 * SAMPLE ONLY — a placeholder announcement that exercises every slot of the
 * announcement layout's text slots (headline, greeting, intro, feature sections,
 * one button, a note from Rich). It has no images on purpose: the layout's
 * optional `hero` and per-section `image` take real app screenshots, which a
 * real announcement supplies. Used by the preview gallery
 * (`npm run preview-emails`) and one-off sample sends to Rich.
 *
 * There is deliberately NO send command for this. A real announcement gets
 * its own template with real copy, and its own script with the commercial
 * guardrails (opt-out check, suppression, List-Unsubscribe headers).
 */
export const SAMPLE_ANNOUNCEMENT_SUBJECT = "Announcement headline goes here";

export function sampleAnnouncementTemplate(params: {
  name: string;
  unsubscribeUrl: string;
  postalAddress: string;
  openAppUrl: string;
}): RenderedEmail {
  return announcementLayout({
    title: SAMPLE_ANNOUNCEMENT_SUBJECT,
    preheader: "Preview text goes here — one line that sums up the announcement.",
    headline: "Announcement headline goes here",
    firstName: firstNameOf(params.name),
    intro:
      "Intro paragraph goes here. One or two sentences on what's new and why it matters to the reader.",
    sections: [
      {
        title: "Feature name goes here",
        body: "Two or three short sentences: what it does, where to find it in the app, and why you'd use it.",
      },
      {
        title: "Second feature name goes here",
        body: "Each feature gets a short title and a sentence or two. A real announcement can add a screenshot above any section.",
      },
    ],
    button: { label: "Open MastersFit", href: params.openAppUrl },
    note: {
      text: "Optional. A sentence or two in your own voice, inviting a reply. When it's left out, sign \"— MastersFit\".",
    },
    unsubscribeUrl: params.unsubscribeUrl,
    postalAddress: params.postalAddress,
  });
}
