import {
  announcementLayout,
  firstNameOf,
  type RenderedEmail,
} from "@/templates/email-layouts";

/**
 * SAMPLE ONLY — a placeholder announcement that exercises every slot of the
 * announcement layout (headline, hero, intro, three feature sections with and
 * without images, one button, a note from Rich). Used by the preview gallery
 * (`npm run preview-emails`) and one-off sample sends to Rich.
 *
 * There is deliberately NO send command for this. A real announcement gets
 * its own template with real copy, and its own script with the commercial
 * guardrails (opt-out check, suppression, List-Unsubscribe headers).
 */
export const SAMPLE_ANNOUNCEMENT_SUBJECT = "Announcement headline goes here";

/** Existing, already-hosted website images, so the sample renders real pictures. */
const SAMPLE_IMAGE = "https://www.mastersfit.ai/assets/og.png";

export function sampleAnnouncementTemplate(params: {
  name: string;
  unsubscribeUrl: string;
  openAppUrl: string;
}): RenderedEmail {
  return announcementLayout({
    title: SAMPLE_ANNOUNCEMENT_SUBJECT,
    preheader: "Preview text goes here — one line that sums up the announcement.",
    headline: "Announcement headline goes here",
    firstName: firstNameOf(params.name),
    hero: { src: SAMPLE_IMAGE, alt: "Hero image goes here" },
    intro:
      "Intro paragraph goes here. One or two sentences on what's new and why it matters to the reader.",
    sections: [
      {
        title: "Feature name goes here",
        body: "Feature description goes here. Two or three short sentences: what it does, where to find it in the app, and why you'd use it.",
        image: { src: SAMPLE_IMAGE, alt: "Feature screenshot goes here" },
      },
      {
        title: "Second feature name goes here",
        body: "Second feature description goes here. This section has no image, to show how a text-only section looks.",
      },
      {
        title: "Third feature name goes here",
        body: "Third feature description goes here. Keep each section short enough to read at a glance on a phone.",
      },
    ],
    button: { label: "Open MastersFit", href: params.openAppUrl },
    note: {
      text: "Optional short note from Rich goes here. A sentence or two in his own voice, inviting a reply.",
    },
    unsubscribeUrl: params.unsubscribeUrl,
  });
}
