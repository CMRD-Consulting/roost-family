# Roost Family — Design Update 1

Paste this into Claude Design. It updates the brief for the mockups in progress.

## What changed

**The product**
- The public name is **Roost Family**.
- It's becoming a free product for **any family with young kids (about 0–6)**, not just one household. Nothing should be hard-wired to "Leona" and "Mara"; use them as sample data.
- **Tablet only.** Drop the phone page (medicine, groceries, jots). The one exception is a tiny phone grocery checklist (see Screens 11).
- Any modern tablet, **landscape only**. Design at 1112×834 pt; must also work at 1024×768 and 1366×1024.

**People and accounts**
- A household has several **adults**, each with an avatar, a color and their own 4-digit PIN.
- **Every person's color is always paired with their avatar or initial.** Never use color alone. The palette must be color-blind-safe in day and Night Mode.
- Log sheets get a **"Who?" row** of adult avatars. It's optional, except on **Medicine**, where it's required.
- The **PIN pad** starts with adult avatars: tap yours, then enter your PIN.

**Kids**
- **1 to 8 kids.** Up to 4 full kid cards on the main screen; with 5–8 kids, use a compact card (avatar, name, one status line).
- Kid card content depends on age. Under 3: wake window and last feeding. 2–7: Now → Next picture card.
- **Leona's Corner is now Kids' Corner**, opened through a **child picker** (large avatars), with a small avatar in the corner to switch child.
- **New deliverable: an illustrated routine icon library** (breakfast, teeth, shoes, car, nap, bath, books, bed, potty, park, snack, getting dressed…). Pre-readers must recognize them. Parents can replace any icon with a photo.

**Medicine**
- Each medicine has a minimum interval and an optional **maximum doses in 24 hours**.
- Warnings, which require confirmation to save:
  - Early dose: "Last dose was 3h 20m ago by Sam. Minimum is 6h."
  - Over max: "This would be dose 5 in 24 hours. Maximum is 4."
  - Offline: "Can't check whether another adult gave a dose. Log anyway?"
- **Dose conflict alert:** a banner on the main screen until an adult acknowledges it.
- The medicine status line now includes who gave it: "Mara · Ibuprofen · 3:10 PM by Sam · next after 9:10 PM".
- Doses can be voided (struck through), never deleted.

**Sitter Mode**
- Start: adult PIN, then an **optional sitter name** field ("Grandma", "Jess").
- Entries show "Jess (sitter)".
- The "While You Were Out" summary shows the sitter's name.

## New screens to add

1. **Setup wizard (tablet).** Short steps with large targets:
   1. Welcome ("Set up a household" / "Join a household")
   2. Invite code
   3. Sign in (Apple, Google, or a 6-digit email code)
   4. Consent (terms, privacy, health-data consent)
   5. Household (name, ZIP, time zone)
   6. Kids (name, birthday, color, photo)
   7. You (name, color, PIN)
   8. Connect calendar (skippable)
   9. Add another adult (skippable)
   10. Name this display + a tip for keeping the screen on
2. **Join a household** (extra tablet): Owner signs in, picks household, names the display.
3. **Settings additions:**
   - Members (add adult, roles: Owner / Adult)
   - Displays (last seen, rename, revoke)
   - My account (my color, my PIN, my calendars, and assigning each calendar to a person)
   - Medicines editor with max per 24 h
   - Export
   - Delete household (typed confirmation)
4. **Grocery sheet** with the current list and a **Take list** button.
5. **Take list QR screen** on the tablet: a large QR code and "Expires in 24 hours".
6. **Phone: Take list page.** A simple checklist, a **Done shopping** button and an "expired" state. Groceries only.
7. **Manage household** (any browser, tablet layout): sign in, displays, members, my account.
8. **Display removed** screen ("This display was removed from the household").

## Design rules

- Main-screen text at least 24 pt.
- Touch targets at least 60 pt; primary log buttons at least 88 pt tall.
- Avatar always paired with color.
- A **Reduce Motion** variant for sticker and step celebrations.
- Warm and calm everywhere; playful only in Kids' Corner.

Full spec: `docs/superpowers/specs/2026-09-14-roost-design.md` (Revision 2, section 17 lists every screen).
