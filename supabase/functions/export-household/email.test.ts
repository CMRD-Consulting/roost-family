import { describe, expect, it } from 'vitest'
import { exportReadyEmail } from './email.ts'

const LINK = 'http://localhost:5173/manage/export/eeeeeeee-0000-0000-0000-000000000001'

describe('exportReadyEmail', () => {
  it('has the subject, the link, the 24-hour window and the sign-in note, in text and HTML', () => {
    const email = exportReadyEmail({ householdName: 'Rivera', link: LINK })
    expect(email.subject).toBe('Your Roost Family export is ready')
    for (const body of [email.text, email.html]) {
      expect(body).toContain(LINK)
      expect(body).toContain('Rivera')
      expect(body).toContain('available for 24 hours')
      expect(body).toContain('sign in')
    }
    expect(email.html).toContain(`<a href="${LINK}"`)
  })

  it('escapes the household name in HTML', () => {
    const email = exportReadyEmail({ householdName: '<b>Tom & "Jo"</b>', link: LINK })
    expect(email.html).toContain('&lt;b&gt;Tom &amp; &quot;Jo&quot;&lt;/b&gt;')
    expect(email.html).not.toContain('<b>Tom')
    expect(email.text).toContain('<b>Tom & "Jo"</b>')
  })
})
