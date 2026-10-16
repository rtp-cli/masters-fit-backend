/**
 * Render every customer-facing email to a local preview gallery.
 *
 *   npm run preview-emails                # -> ~/Desktop/mastersfit-email-preview/
 *   npm run preview-emails -- --out /tmp/x
 *
 * Pure rendering: fictional sample data ("Jordan Sample"), no database, no
 * network, no Resend, no env secrets. Writes one HTML file per email plus an
 * index.html that shows them all in ~600px iframes, grouped by email TYPE,
 * with a toggle to view them at phone width (375px).
 *
 * "current"  = the template exactly as it ships today.
 * "proposed" = the same content on the new shared layouts (email-layouts.ts).
 */
import fs from "fs";
import os from "os";
import path from "path";

import { otpEmailTemplate } from "@/templates/otp-email";
import { renewalReminderTemplate } from "@/templates/renewal-reminder-email";
import {
  onboardingNudgeTemplate,
  ONBOARDING_NUDGE_SUBJECT,
} from "@/templates/onboarding-nudge-email";
import {
  activationNudgeTemplate,
  ACTIVATION_NUDGE_SUBJECT,
} from "@/templates/activation-nudge-email";
import { compGrantedTemplate, COMP_GRANTED_SUBJECT } from "@/templates/comp-granted-email";
import { comebackTemplate, COMEBACK_SUBJECT } from "@/templates/comeback-email";
import { featureTourTemplate, FEATURE_TOUR_SUBJECT } from "@/templates/feature-tour-email";
import {
  subscriberWelcomeTemplate,
  SUBSCRIBER_WELCOME_SUBJECT,
  subscriberWelcomeOpenAppUrl,
} from "@/templates/subscriber-welcome-email";
import {
  sampleAnnouncementTemplate,
  SAMPLE_ANNOUNCEMENT_SUBJECT,
} from "@/templates/sample-announcement-email";
import { accountLayout, nudgeLayout } from "@/templates/email-layouts";
import { escapeHtml } from "@/templates/email-shared";

/**
 * An obviously FAKE address. Live sends read COMPANY_POSTAL_ADDRESS from the
 * environment; the preview must never look like it settled the real value.
 */
const SAMPLE_ADDRESS = "123 Sample Street, Anytown, ST 00000";

const NAME = "Jordan Sample";
const EMAIL = "jordan.sample@example.com";
const OTP = "482915";
/** Shape of the real link; the token is a placeholder (signing needs a secret). */
const UNSUB =
  "https://masters-fit-backend.onrender.com/api/email-preferences/unsubscribe?token=SAMPLE-TOKEN";
const CONTINUE = "https://www.mastersfit.ai/continue";

type Status = "current" | "proposed";

interface PreviewEmail {
  id: string;
  type: 1 | 2 | 3 | 4;
  status: Status;
  label: string;
  from: string;
  subject: string;
  unsubscribe: boolean;
  postal: boolean;
  notes?: string;
  html: string;
  text: string;
}

const TYPE_NAMES: Record<PreviewEmail["type"], string> = {
  1: "Type 1 · Personal (from Rich)",
  2: "Type 2 · Welcome / relationship",
  3: "Type 3 · Product & marketing",
  4: "Type 4 · Account & billing",
};

const TYPE_RULES: Record<PreviewEmail["type"], string> = {
  1: "From “Rich Pusateri”, plain note, signed Rich, no unsubscribe.",
  2: "From “MastersFit”, lightly branded, signed “— Rich / Founder, MastersFit”, no unsubscribe.",
  3: "From “MastersFit”, signed MastersFit (optional note from Rich), unsubscribe link + postal address in the footer.",
  4: "From “MastersFit”, minimal branding, unsigned, no unsubscribe.",
};

const ENV_ADDRESS_NOTE =
  "Live sends take the postal address from the COMPANY_POSTAL_ADDRESS env var; this preview shows the website address instead.";

function build(): PreviewEmail[] {
  const out: PreviewEmail[] = [];

  // ---- Type 4: account & billing ----------------------------------------
  out.push({
    id: "otp-current",
    type: 4,
    status: "current",
    label: "Verification code (OTP)",
    from: "MastersFit",
    subject: `Your MastersFit code is ${OTP}.`,
    unsubscribe: false,
    postal: false,
    notes: "Grey page + rounded card + Manrope web font. Signed “The MastersFit team”.",
    ...otpEmailTemplate({ otp: OTP, name: NAME }),
  });

  out.push({
    id: "otp-proposed",
    type: 4,
    status: "proposed",
    label: "Verification code (OTP) on the account layout",
    from: "MastersFit",
    subject: `Your MastersFit code is ${OTP}`,
    unsubscribe: false,
    postal: false,
    notes: "Same words as today, unsigned, on the shared type 4 layout. Not wired up — preview only.",
    ...accountLayout({
      title: "Verify your email",
      preheader: `Your MastersFit verification code is ${OTP}. It expires in 10 minutes.`,
      heading: "Verify your email",
      firstName: "Jordan",
      blocks: [
        { kind: "paragraph", text: "Enter this code to verify your email." },
        { kind: "code", label: "Your verification code", value: OTP },
        {
          kind: "fineprint",
          text: "This code expires in 10 minutes. Don’t share it with anyone — MastersFit will never ask you for it.",
        },
      ],
      footerNote: "If you didn’t request this, you can safely ignore this email.",
    }),
  });

  out.push({
    id: "renewal-reminder-current",
    type: 4,
    status: "current",
    label: "Renewal reminder",
    from: "MastersFit",
    subject: "Your MastersFit+ renews on November 12, 2026",
    unsubscribe: false,
    postal: false,
    notes: "Same card design as the OTP. Signed “The MastersFit team”.",
    ...renewalReminderTemplate({
      name: NAME,
      planLabel: "annual",
      price: "$89.99",
      renewalDate: "November 12, 2026",
      manageUrl: "https://www.mastersfit.ai/manage-subscription",
    }),
  });

  // ---- Type 2: welcome ---------------------------------------------------
  const welcomeUrl = subscriberWelcomeOpenAppUrl();
  out.push({
    id: "subscriber-welcome-paid",
    type: 2,
    status: "proposed",
    label: "Subscriber welcome — paid",
    from: "MastersFit (Reply-To rtp@mastersfit.ai)",
    subject: SUBSCRIBER_WELCOME_SUBJECT,
    unsubscribe: false,
    postal: false,
    notes: `Rich's approved copy. Button → ${welcomeUrl}. Not live yet (this PR).`,
    ...subscriberWelcomeTemplate({ name: NAME, isTrial: false, openAppUrl: welcomeUrl }),
  });
  out.push({
    id: "subscriber-welcome-trial",
    type: 2,
    status: "proposed",
    label: "Subscriber welcome — free trial",
    from: "MastersFit (Reply-To rtp@mastersfit.ai)",
    subject: SUBSCRIBER_WELCOME_SUBJECT,
    unsubscribe: false,
    postal: false,
    notes: "Only the opening line differs.",
    ...subscriberWelcomeTemplate({ name: NAME, isTrial: true, openAppUrl: welcomeUrl }),
  });

  // ---- Type 1: personal --------------------------------------------------
  out.push({
    id: "comp-granted-current",
    type: 1,
    status: "current",
    label: "Comp granted",
    from: "Rich Pusateri",
    subject: COMP_GRANTED_SUBJECT,
    unsubscribe: false,
    postal: false,
    ...compGrantedTemplate({ name: NAME }),
  });
  out.push({
    id: "comeback-current",
    type: 1,
    status: "current",
    label: "Comeback",
    from: "Rich Pusateri",
    subject: COMEBACK_SUBJECT,
    unsubscribe: true,
    postal: true,
    notes: `Classed personal, but it is commercial mail, so it carries an unsubscribe + address. ${ENV_ADDRESS_NOTE}`,
    ...comebackTemplate({
      name: NAME,
      daysSinceSignup: 30,
      unsubscribeUrl: UNSUB,
      postalAddress: SAMPLE_ADDRESS,
    }),
  });
  out.push({
    id: "feature-tour-current",
    type: 1,
    status: "current",
    label: "Feature tour",
    from: "Rich Pusateri",
    subject: FEATURE_TOUR_SUBJECT,
    unsubscribe: true,
    postal: true,
    notes: `Classed personal, but it is commercial mail, so it carries an unsubscribe + address. ${ENV_ADDRESS_NOTE}`,
    ...featureTourTemplate({
      name: NAME,
      unsubscribeUrl: UNSUB,
      postalAddress: SAMPLE_ADDRESS,
    }),
  });

  // ---- Type 3: product & marketing --------------------------------------
  out.push({
    id: "onboarding-nudge-current",
    type: 3,
    status: "current",
    label: "Onboarding nudge",
    from: "Rich Pusateri",
    subject: ONBOARDING_NUDGE_SUBJECT,
    unsubscribe: true,
    postal: true,
    notes: `Today: from Rich and signed Rich, green button. ${ENV_ADDRESS_NOTE}`,
    ...onboardingNudgeTemplate({
      name: NAME,
      continueUrl: CONTINUE,
      unsubscribeUrl: UNSUB,
      postalAddress: SAMPLE_ADDRESS,
    }),
  });
  out.push({
    id: "activation-nudge-current",
    type: 3,
    status: "current",
    label: "Activation nudge",
    from: "Rich Pusateri",
    subject: ACTIVATION_NUDGE_SUBJECT,
    unsubscribe: true,
    postal: true,
    notes: `Today: from Rich and signed Rich, green button. ${ENV_ADDRESS_NOTE}`,
    ...activationNudgeTemplate({
      name: NAME,
      planName: "Full-Body Strength Foundations",
      firstSessionName: "Full-Body Strength",
      startUrl: CONTINUE,
      unsubscribeUrl: UNSUB,
      postalAddress: SAMPLE_ADDRESS,
    }),
  });
  out.push({
    id: "nudge-layout-sample",
    type: 3,
    status: "proposed",
    label: "Nudge layout — sample (activation copy)",
    from: "MastersFit (Reply-To rtp@mastersfit.ai)",
    subject: ACTIVATION_NUDGE_SUBJECT,
    unsubscribe: true,
    postal: true,
    notes: "The activation nudge's message lightly reworded for the brand voice, to show the layout. Not a copy proposal.",
    ...nudgeLayout({
      title: ACTIVATION_NUDGE_SUBJECT,
      preheader: "Your plan is built — the first session takes one tap to start.",
      firstName: "Jordan",
      paragraphs: [
        "Your Full-Body Strength session is built and waiting in the app. You haven't started it yet.",
        "There's nothing to set up and nothing to decide. Open the app, tap Start, and it walks you through one exercise at a time. You can stop partway and it keeps what you did.",
      ],
      button: { label: "Start your first workout", href: CONTINUE },
      note: {
        text: "If the plan isn't right — too long, too hard, wrong equipment — just reply and tell me. I'd rather fix it than have you not use it.",
      },
      unsubscribeUrl: UNSUB,
      postalAddress: SAMPLE_ADDRESS,
    }),
  });
  out.push({
    id: "announcement-sample",
    type: 3,
    status: "proposed",
    label: "Announcement layout — sample (placeholder copy)",
    from: "MastersFit (Reply-To rtp@mastersfit.ai)",
    subject: SAMPLE_ANNOUNCEMENT_SUBJECT,
    unsubscribe: true,
    postal: true,
    notes: "Placeholder text throughout. Images are the website's share image, standing in for real screenshots.",
    ...sampleAnnouncementTemplate({ name: NAME, unsubscribeUrl: UNSUB, postalAddress: SAMPLE_ADDRESS, openAppUrl: CONTINUE }),
  });

  return out;
}

function indexHtml(emails: PreviewEmail[], generatedAt: string): string {
  const groups = ([2, 3, 4, 1] as const).map((type) => {
    const items = emails.filter((e) => e.type === type);
    const cards = items
      .map((e) => {
        const badge = (on: boolean, yes: string, no: string) =>
          `<span class="pill ${on ? "pill--on" : ""}">${on ? yes : no}</span>`;
        return `<article class="card">
  <header class="card__head">
    <div class="card__title">
      <span class="status status--${e.status}">${e.status}</span>
      <h3>${escapeHtml(e.label)}</h3>
    </div>
    <dl class="meta">
      <div><dt>From</dt><dd>${escapeHtml(e.from)}</dd></div>
      <div><dt>Subject</dt><dd>${escapeHtml(e.subject)}</dd></div>
    </dl>
    <div class="pills">
      <span class="pill">Type ${e.type}</span>
      ${badge(e.unsubscribe, "Unsubscribe link", "No unsubscribe")}
      ${badge(e.postal, "Postal address", "No postal address")}
      <a class="open" href="emails/${e.id}.html" target="_blank">Open file ↗</a>
    </div>
    ${e.notes ? `<p class="notes">${escapeHtml(e.notes)}</p>` : ""}
  </header>
  <div class="frame-wrap"><iframe title="${escapeHtml(e.label)}" srcdoc="${escapeHtml(e.html)}" loading="lazy"></iframe></div>
  <details><summary>Plain-text version</summary><pre>${escapeHtml(e.text)}</pre></details>
</article>`;
      })
      .join("\n");
    return `<section class="group">
  <h2>${TYPE_NAMES[type]}</h2>
  <p class="rule">${TYPE_RULES[type]}</p>
  <div class="cards">${cards}</div>
</section>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>MastersFit email preview</title>
<style>
  :root { --bg:#F3F3F1; --card:#FFFFFF; --ink:#141414; --muted:#666; --line:#E2E2DE; --accent:#1A6B4A; --warn:#8A5A00; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .top { position:sticky; top:0; z-index:5; background:rgba(243,243,241,.94); backdrop-filter:blur(6px); border-bottom:1px solid var(--line); padding:14px 24px; display:flex; flex-wrap:wrap; gap:12px 24px; align-items:center; justify-content:space-between; }
  .top h1 { margin:0; font-size:18px; }
  .top p { margin:2px 0 0; color:var(--muted); font-size:13px; }
  .toggle { display:inline-flex; border:1px solid var(--line); border-radius:999px; background:#fff; padding:3px; }
  .toggle button { border:0; background:transparent; padding:6px 14px; border-radius:999px; font:inherit; font-size:13px; cursor:pointer; color:var(--muted); }
  .toggle button[aria-pressed="true"] { background:var(--ink); color:#fff; }
  main { padding:8px 24px 64px; max-width:1500px; margin:0 auto; }
  .group h2 { margin:32px 0 2px; font-size:20px; }
  .rule { margin:0 0 16px; color:var(--muted); }
  .cards { display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; width:calc(var(--w) + 34px); max-width:100%; }
  .card__title { display:flex; gap:10px; align-items:center; }
  .card h3 { margin:0; font-size:16px; }
  .status { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:3px 8px; border-radius:6px; }
  .status--current { background:#ECECEA; color:#444; }
  .status--proposed { background:#E3F1EA; color:var(--accent); }
  .meta { margin:10px 0 8px; display:grid; gap:2px; font-size:13px; }
  .meta div { display:flex; gap:8px; }
  .meta dt { color:var(--muted); width:56px; flex:none; }
  .meta dd { margin:0; }
  .pills { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
  .pill { font-size:12px; border:1px solid var(--line); border-radius:999px; padding:2px 9px; color:var(--muted); }
  .pill--on { border-color:#BFD9CB; color:var(--accent); background:#F2F8F5; }
  .open { margin-left:auto; font-size:12px; color:var(--accent); }
  .notes { margin:8px 0 0; font-size:13px; color:var(--warn); }
  .frame-wrap { margin-top:12px; border:1px solid var(--line); border-radius:10px; overflow:hidden; width:calc(var(--w) + 2px); max-width:100%; }
  iframe { display:block; width:var(--w); max-width:100%; height:600px; border:0; background:#fff; }
  details { margin-top:10px; font-size:13px; }
  pre { white-space:pre-wrap; word-break:break-word; background:#F7F7F5; border-radius:8px; padding:12px; font-size:12px; max-height:360px; overflow:auto; }
  body { --w:600px; }
  body.mobile { --w:375px; }
</style>
</head>
<body>
<div class="top">
  <div>
    <h1>MastersFit email preview</h1>
    <p>Sample data: ${escapeHtml(NAME)} &lt;${escapeHtml(EMAIL)}&gt; · generated ${escapeHtml(generatedAt)} · nothing here was sent</p>
  </div>
  <div class="toggle" role="group" aria-label="Preview width">
    <button type="button" data-w="desktop" aria-pressed="true">Desktop 600px</button>
    <button type="button" data-w="mobile" aria-pressed="false">Mobile 375px</button>
  </div>
</div>
<main>
${groups.join("\n")}
</main>
<script>
  // Size each iframe to its content (srcdoc frames are same-origin).
  function fit(f){ try { var d=f.contentDocument; if(!d||!d.body) return; f.style.height='0px'; f.style.height=Math.max(d.documentElement.scrollHeight,d.body.scrollHeight)+'px'; } catch(e){} }
  var frames=[].slice.call(document.querySelectorAll('iframe'));
  frames.forEach(function(f){ f.addEventListener('load',function(){ fit(f); setTimeout(function(){fit(f);},400); }); });
  [].slice.call(document.querySelectorAll('.toggle button')).forEach(function(b){
    b.addEventListener('click',function(){
      document.body.classList.toggle('mobile', b.dataset.w==='mobile');
      [].slice.call(document.querySelectorAll('.toggle button')).forEach(function(x){ x.setAttribute('aria-pressed', String(x===b)); });
      setTimeout(function(){ frames.forEach(fit); }, 50);
    });
  });
</script>
</body>
</html>`;
}

function main() {
  const outFlag = process.argv.indexOf("--out");
  const outDir =
    outFlag > -1 && process.argv[outFlag + 1]
      ? path.resolve(process.argv[outFlag + 1])
      : path.join(os.homedir(), "Desktop", "mastersfit-email-preview");

  const emails = build();
  fs.mkdirSync(path.join(outDir, "emails"), { recursive: true });
  for (const e of emails) {
    fs.writeFileSync(path.join(outDir, "emails", `${e.id}.html`), e.html);
    fs.writeFileSync(path.join(outDir, "emails", `${e.id}.txt`), e.text);
  }
  fs.writeFileSync(
    path.join(outDir, "index.html"),
    indexHtml(emails, new Date().toLocaleString("en-US"))
  );

  console.log(`Wrote ${emails.length} emails to ${outDir}`);
  for (const e of emails) {
    console.log(`  [type ${e.type}] ${e.status.padEnd(8)} ${e.id}`);
  }
  console.log(`\nOpen: ${path.join(outDir, "index.html")}`);
}

main();
