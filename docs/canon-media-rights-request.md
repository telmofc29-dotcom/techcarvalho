# Canon — media rights clarification request

**Status: DRAFT. Not sent. Requires your review and sending.**

## Why this matters

Canon is the single highest-leverage media-rights blocker in the catalogue:
**16 of 38 blocked products (42%)** are Canon bodies. One written clarification
would unblock more products than the next five manufacturers combined.

## Why we cannot proceed without it

Canon's published terms are genuinely contradictory, which is why this is
classified `unclear_manual_review` rather than approved or refused:

- Canon's regional **image library** states the pictures are "intended for
  press use only and must not be altered in any way."
- Canon's general **Terms of Use** state you may download content only for
  "personal, non-commercial use," may not "reproduce, publicly display,
  distribute or otherwise use the Content for any public or commercial
  purposes," and that "any use of the Content on any other website or
  networked computer environment for any purposes is prohibited."
- Canon Europe's separate **logo licence** authorises only "journalists, press
  companies, or members of the press" for "press purposes only," and bars
  commercial use.

No document reconciles "press use only" with "no use on any other website,"
and none states whether an independent, advertising/affiliate-supported
editorial site qualifies as "press." We will not assume the favourable
reading.

## Contact route

I could not verify a specific named press contact with confidence, so I am not
inventing one. The reliable routes, in order of preference:

1. **Canon UK press office** — via the contact route published on
   `canon.co.uk`'s press/news area (the image library page itself links to
   press contact details).
2. **Canon Europe press centre** — `canon-europe.com/press-centre/`.
3. If neither yields a press-office address, Canon UK's general corporate
   contact form, asking to be directed to the press/media relations team.

**Before sending, confirm the current address on Canon's own site** — press
contacts change, and I would rather you verify one address than trust one I
could not.

## Draft email

> **Subject:** Permission enquiry — use of Canon product imagery in editorial reviews and buying guides
>
> Dear Canon Press Office,
>
> I am writing from TechCarvalho (https://www.techcarvalho.com), an independent
> consumer technology publication covering cameras, computing, gaming and
> related categories.
>
> We publish editorial product pages, comparisons, buying guides and
> explanatory articles, including coverage of Canon EOS bodies and lenses. We
> would like written clarification on whether, and on what terms, we may use
> official Canon product photography from Canon's press/image library
> alongside that editorial coverage.
>
> I want to be transparent about our situation so you can give an accurate
> answer:
>
> - We are an independent publication, not affiliated with Canon.
> - The site is commercially supported (advertising and affiliate links), so we
>   would not want to rely on a "non-commercial use" permission.
> - Our use would be editorial: illustrating reviews, comparisons and buying
>   guides. We would not use Canon imagery in advertising, on merchandise, or
>   in any way implying Canon endorsement or affiliation.
> - We would not alter images beyond resizing/cropping for layout, and we would
>   apply any credit line you require.
>
> The reason for asking rather than assuming is that Canon's published terms
> appear to point in different directions: the image library describes the
> photographs as intended for press use, while the general Terms of Use state
> that content may be used only for personal, non-commercial purposes and not
> on other websites. We would rather have your written position than rely on
> our own interpretation.
>
> Specifically, could you confirm:
>
> 1. Whether TechCarvalho may use Canon official product imagery in editorial
>    articles, reviews, comparisons and buying guides.
> 2. Whether any registration, accreditation or licence agreement is required
>    first, and how we would apply.
> 3. What credit or attribution wording you require.
> 4. Any restrictions we should observe (permitted image sources, modification
>    limits, product ranges excluded, expiry or review of permission).
>
> If Canon's position is that such use is not permitted, that is genuinely
> useful to know too — we will continue using our own original graphics rather
> than Canon imagery, and will not use Canon photographs in the meantime.
>
> Thank you for your time.
>
> Kind regards,
>
> [Your name]
> TechCarvalho — https://www.techcarvalho.com
> [Your contact email]

## After a reply arrives

Record the outcome in the Source Registry (`/admin/engine/sources`, Canon row):

- **Permission granted** → set `media_rights_status` to `confirmed_usable`,
  set `media_republication_permitted` to true, paste the exact permission
  wording into `terms_notes`, and set `attribution_required` /
  `attribution_text` to whatever Canon specifies.
- **Permission requires registration** → keep `requires_registration`, record
  the process in `terms_notes`, leave republication false until completed.
- **Permission refused** → set `media_rights_status` to `prohibited`. The 16
  Canon products stay Draft/Awaiting Media, and we continue with original
  TechCarvalho graphics.

Do not change `media_republication_permitted` on the basis of a phone call or
an assumption — only on written confirmation you can point back to.
