// Renders the leave notification emails. db.ts decides what each email
// says (greeting, sentence, which blocks to show); this file only turns
// that into HTML + a plain-text twin. Kept as inline-styled tables since
// that's still the only layout mail clients (Gmail, Outlook) agree on.
//
// Two visual patterns, per the email spec:
//   - a clean label/value list for the submission notification, and
//   - a prominent quote block for rejections and comments,
// so recipients learn "quote block = something needs my attention".

export interface EmailDetail {
  label: string;
  value: string;
}

// A run of text with select words picked out in bold — e.g. the leave
// type inside a sentence, or just the label half of a "Label: value"
// line. Plain strings are still accepted everywhere one of these is
// expected (a single non-bold run), so callers that need no emphasis
// don't have to wrap anything.
export type TextPart = { text: string; bold?: boolean };
export type RichText = string | TextPart[];

function parts(rich: RichText): TextPart[] {
  return typeof rich === "string" ? [{ text: rich }] : rich;
}

// A quoted remark/comment. `heading` is an optional line above the label
// (e.g. "Rejected by:" bold, "Manager" not — see EmailContent below),
// `label` sits directly on the block ("Remarks:" / "HR commented:"),
// `text` is the quoted body.
export interface EmailQuote {
  heading?: RichText;
  label: string;
  text: string;
}

export interface EmailContent {
  greeting: string;
  intro: RichText;
  details?: EmailDetail[];
  quote?: EmailQuote;
  buttonLabel: string;
  link: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

// All values come from user-typed fields (reasons, remarks, names), so
// everything is escaped before it lands in markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escape, then keep the author's line breaks — remarks are often written
// as several short lines.
function multiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function renderRich(rich: RichText): string {
  return parts(rich)
    .map((p) => (p.bold ? `<b>${escapeHtml(p.text)}</b>` : escapeHtml(p.text)))
    .join("");
}

function richToText(rich: RichText): string {
  return parts(rich)
    .map((p) => p.text)
    .join("");
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TEXT = "#1f2937";
const MUTED = "#6b7280";
const ACCENT = "#2563eb";

function renderDetails(details: EmailDetail[]): string {
  const rows = details
    .map(
      (d) => `
        <tr>
          <td style="padding:6px 16px 6px 0;font-family:${FONT};font-size:14px;font-weight:600;color:${MUTED};white-space:nowrap;vertical-align:top;">${escapeHtml(d.label)}</td>
          <td style="padding:6px 0;font-family:${FONT};font-size:14px;color:${TEXT};vertical-align:top;">${multiline(d.value)}</td>
        </tr>`
    )
    .join("");
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
        ${rows}
      </table>`;
}

function renderQuote(quote: EmailQuote): string {
  const heading = quote.heading
    ? `<p style="margin:20px 0 0;font-family:${FONT};font-size:14px;color:${TEXT};">${renderRich(quote.heading)}</p>`
    : "";
  return `${heading}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0 0;">
        <tr>
          <td style="padding:14px 18px;background:#f3f4f6;border-left:4px solid ${ACCENT};border-radius:0 6px 6px 0;">
            <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;font-weight:600;color:${MUTED};">${escapeHtml(quote.label)}</p>
            <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.5;color:${TEXT};font-style:italic;">&ldquo;${multiline(quote.text)}&rdquo;</p>
          </td>
        </tr>
      </table>`;
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f6f8;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f6f8;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:32px 32px 28px;">
              <p style="margin:0;font-family:${FONT};font-size:16px;color:${TEXT};">${escapeHtml(content.greeting)}</p>
              <p style="margin:16px 0 0;font-family:${FONT};font-size:15px;line-height:1.55;color:${TEXT};">${renderRich(content.intro)}</p>
              ${content.details ? renderDetails(content.details) : ""}
              ${content.quote ? renderQuote(content.quote) : ""}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
                <tr>
                  <td style="background:${ACCENT};border-radius:6px;">
                    <a href="${escapeHtml(content.link)}" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(content.buttonLabel)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED};">Shikho Leave Portal</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Same content, same order, for clients that show the text part.
  const lines: string[] = [content.greeting, "", richToText(content.intro)];
  if (content.details) {
    lines.push("");
    for (const d of content.details) lines.push(`${d.label} ${d.value}`);
  }
  if (content.quote) {
    lines.push("");
    if (content.quote.heading) lines.push(richToText(content.quote.heading), "");
    lines.push(content.quote.label, `"${content.quote.text}"`);
  }
  lines.push("", `${content.buttonLabel}: ${content.link}`);

  return { html, text: lines.join("\n") };
}
