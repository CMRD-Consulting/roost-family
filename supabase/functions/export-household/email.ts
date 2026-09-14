/**
 * The "export is ready" email (spec §11.3). It carries the household's name and a link to /manage/export/<id>, which
 * requires signing in again; never any other household data.
 */

export interface EmailMessage {
  subject: string
  text: string
  html: string
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** C0 and C1 control characters (CR, LF, tabs, bell, …): never part of a household name worth showing. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

export function exportReadyEmail(input: { householdName: string; link: string }): EmailMessage {
  const householdName = input.householdName.replace(CONTROL_CHARS, '')
  const { link } = input
  const text = [
    'Hi,',
    '',
    `Your export of ${householdName} is ready to download:`,
    link,
    '',
    'The link is available for 24 hours. You’ll need to sign in to Roost Family again before the download starts.',
    '',
    'If you didn’t ask for this export, you can ignore this email: only an owner of the household who signs in can download it.',
    '',
    '— Roost Family',
    '',
  ].join('\r\n')

  const name = escapeHtml(householdName)
  const href = escapeHtml(link)
  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.5; color: #2b2622;">
    <p>Hi,</p>
    <p>Your export of <strong>${name}</strong> is ready to download.</p>
    <p><a href="${href}" style="display: inline-block; padding: 12px 20px; border-radius: 10px; background: #b4541f; color: #ffffff; text-decoration: none; font-weight: 600;">Download your export</a></p>
    <p>Or open this link: <a href="${href}">${href}</a></p>
    <p>The link is available for 24 hours. You’ll need to sign in to Roost Family again before the download starts.</p>
    <p style="color: #5c554e;">If you didn’t ask for this export, you can ignore this email: only an owner of the household who signs in can download it.</p>
    <p>— Roost Family</p>
  </body>
</html>
`
  return { subject: 'Your Roost Family export is ready', text, html }
}
