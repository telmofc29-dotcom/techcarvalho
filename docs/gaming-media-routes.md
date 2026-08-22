# Gaming media routes — how to show a game without stealing a screenshot

**Status: research + one component built. Nothing was ingested and no article was
rewired.** Written 2026-08-22. Read alongside `docs/product-media-strategy.md`
(the Commons route that unblocked 22 products), `src/lib/media/hierarchy.ts` (why
a title card is the wrong hero for a named game) and `src/lib/media/rights.ts`
(the enforcement point).

## The problem, stated exactly

`gta-6-release-date-status` leads with
`…-hero-gta-6-release-date-status.png` — a TechCarvalho title card. Run it through
`classifyMediaTier()` and `evaluateHero()` and the codebase already agrees that
this is wrong: `tc_graphic` + `-hero-` prefix → `generic_graphic`;
`inferSubjectKind()` sees "gta" → `named_media`; the verdict is
*"A generic title card on a page about a specific, recognisable thing."*

The obvious fix — put a picture of GTA VI on it — is the thing that is not
available. **This document is the record of establishing that, publisher by
publisher, from the actual terms pages.**

## The rules this document works under

Unchanged from `docs/product-media-strategy.md`, and nothing below negotiates
with them:

1. **Discoverability is not permission.** A working image URL, a public press
   page, a downloadable ZIP, an unauthenticated API — none of these is a licence.
2. **Absence of a prohibition is not a grant.** Where a publisher's terms are
   silent on editorial reuse, the answer is "no", not "probably fine".
3. **No AI imagery that could be mistaken for a screenshot, photograph or
   official render.**
4. **Game screenshots and key art are all-rights-reserved by default**, even when
   freely downloadable from the publisher's own site. A press kit that grants
   *editorial use* in writing is a real permission and is quoted below. A
   marketing asset library that says nothing is not.

## The finding in one paragraph

**No publisher researched grants a commercial third-party news site the right to
republish game screenshots or key art without accreditation.** Three grants of
real substance exist — Microsoft's News Center editorial clause, CD PROJEKT RED's
Press Center licence, and YouTube's embeddable-player licence — and only the
third is available to TechCarvalho today without registering with anybody. It is
also the only one that works for *any* publisher, because it derives from the
platform's terms rather than the publisher's. **Embedding the publisher's own
official trailer is the answer to the GTA VI page.**

---

## 1. Publishers and press programmes

### Method and its limits, stated first

Every clause below was fetched live on **2026-08-22** and is quoted from the page
at the URL given. Three honest caveats:

- The fetch tool summarises pages and caps individual quotations at roughly 125
  characters. **Longer clauses marked "reassembled" were rebuilt from consecutive
  fragments** rather than read as one string. The single most load-bearing
  reassembly (CD PROJEKT RED §4.2) was independently re-fetched and returned
  matching fragments. The two most consequential short quotes (Microsoft
  permissions, Xbox Game Content Usage Rules) and the whole YouTube section were
  re-fetched directly and are first-hand.
- **The session's WebSearch budget was exhausted**, so pages were reached by
  navigating directly to canonical URLs and following in-page links, not by
  searching. Coverage is therefore narrower than a search-led sweep.
- **Several publishers block automated fetching outright.** Those are recorded as
  "could not read", which is a different finding from "says nothing" and a very
  different one from "permits".

### 1.1 Microsoft / Xbox — *editorial-use-only (corporate images) / prohibited (game content)*

Microsoft is the only company with a written editorial grant reachable without
accreditation.

> "Images found on the News Center may be used for editorial purposes only by the
> press and/or industry analysts."
>
> — <https://www.microsoft.com/en-us/legal/intellectualproperty/permissions>

Required credit: **"Used with permission from Microsoft."** With a caveat that
does real work:

> "For images that contain third-party trademarks or logos or images of
> individuals, it is the responsibility of the user to determine whether consent
> from the third party or individual is necessary."

Its screenshot policy permits use "in advertising, in documentation …, in
tutorial books, in videos, or on websites" subject to conditions ("Do not alter
the screenshot except to resize it", "Do not use portions of screenshots", "Do
not use screenshots that contain third-party content", "Do not use screenshots
that contain an image of an identifiable individual"), and prohibits:

> "You may not use screenshots of Microsoft product boot-up screens, opening
> screens, 'splash screens,' or screens from beta release products or other
> products that have not been commercially released."

**But Microsoft contradicts itself, and the contradiction lands on exactly the
assets we want.** From the trademark and brand guidelines:

> "our logos, app and product icons, illustrations, photographs, videos, and
> designs can never be used without an express license."
>
> — <https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks>

That page does permit the wordmark in editorial headlines — "Use in the title of
news articles, when truthful and not misleading." So naming Xbox in a headline is
fine; reproducing the logo or key art is not. **Microsoft does not reconcile the
two pages.** This is the same shape as the contradiction
`docs/canon-media-rights-request.md` recorded for Canon, and it is recorded here
for the same reason: writing down "the terms conflict" is the correct output when
they do.

**Game content is separately and clearly out of reach.** The Xbox Game Content
Usage Rules (<https://www.xbox.com/en-US/developers/rules>) grant a

> "personal, non-exclusive, non-sublicenseable, non-transferable, revocable,
> limited license"

for use

> "strictly for your personal, noncommercial (except as specifically provided
> below) use"

and then say, decisively:

> "Where someone is trying to use Game Content to promote their commercial
> venture (even just a commercial website), they need our permission"

The parenthetical settles it. The only monetisation carve-out is platform-scoped:

> "You may make your Item available on Youtube or Twitch and participate in
> programs on those sites that allow you to earn revenue from ads"

Note also: "we can't give you permission to use games from other publishers, or
Game Content where Microsoft doesn't own the intellectual property" — so whether
Activision titles now fall inside these rules post-acquisition is **not stated
anywhere readable**.

**Verdict:** News Center corporate images — *editorial-use-only*, usable with
attribution and third-party clearance. Logos, key art, illustrations, photographs
— *prohibited* without an express licence. Xbox game screenshots — *prohibited*
for this site.

### 1.2 CD PROJEKT RED — *needs registration → then editorial-use-only.* The real grant.

The permissive reputation is **substantiated**, and this is the only publisher
found with an explicit, royalty-free editorial licence written out. It lives in a
document linked only from the press-portal footer:
<https://regulations.cdprojektred.com/en/press_regulations> ("Press Center Terms
of Services", last updated "[15, January 2024]" — the square brackets appear to be
a literal unclosed template placeholder in their own text).

Section 4.2 (**reassembled from consecutive fragments; independently re-fetched
with matching results**):

> "CD PROJEKT RED grants you, as a journalist or a business partner of CD PROJEKT
> RED registered in Press Center, as well as the media outlet/channel or company
> you represent, a nonexclusive, non-transferable, royalty free, revocable
> permission to use, copy, reproduce, distribute, publish, display, broadcast or
> make publically accessible … the promotional content made available to you in
> the Press Center, as long as the promotional content is used exclusively for
> editorial news use …"

Conditions, each returned as its own clean fragment:

> - "you keep intact all trademark, copyright and other proprietary notices,"
> - "you do not modify the promotional content,"
> - "you do not use the promotional content to do or say anything that is or may
>   be considered racist, harassing, xenophobic, sexist, discriminatory, abusive,
>   defamatory or otherwise offensive or illegal, and"
> - "you do not make any kind of impression that CD PROJEKT RED is your official
>   partner, co-author of your works …"

And:

> "Press Center is intended exclusively for journalists and business partners of
> CD PROJEKT RED."
>
> "CD PROJEKT RED may revoke aforementioned permission at any time, for any reason
> whatsoever."

**Three limits that matter more than the grant does:**

1. It covers **only "the promotional content made available to you in the Press
   Center"**. It does not cover a screenshot you captured yourself or art pulled
   off cyberpunk.net.
2. **"You do not modify the promotional content"** is the condition most likely to
   break an editorial workflow. Cropping to a 16:9 hero frame, or compositing a
   thumbnail, is arguably modification. The pipeline's `sharp` resize is the same
   question `docs/product-media-strategy.md` §2.1 already flagged for CC BY-SA.
3. The Fan Content Guidelines are **not** authority for a news site — they govern
   non-commercial fan use ("you cannot do anything with our games for any
   commercial purpose, unless explicitly permitted") and never mention news,
   press, journalism or editorial use.

The underlying User Agreement is a closed-permission model: "All rights in our
Games and/or Services are reserved, except as we have explained in this
Agreement."

Registration is self-service e-mail confirmation. **Note:
`press.cdprojektred.com/login/start`, the login URL advertised in CDPR's own site
footer, currently returns HTTP 500.**

**Verdict:** *needs registration*, and worth doing — this is the one press
programme that pays for the effort in writing. TechCarvalho currently publishes
nothing about a CDPR title, so it is not urgent.

### 1.3 Nintendo — *prohibited / needs registration*

- `https://press.nintendo.com/` — **HTTP 401.** Hard accreditation wall. Terms
  unreadable without credentials. This answers the question directly: yes,
  Nintendo gates press assets behind registration.
- Game Content Guidelines for Online Video & Image Sharing Platforms
  (<https://www.nintendo.co.jp/networkservice_guideline/en/index.html>):

> "The Guidelines are only applicable to individual consumers using Nintendo Game
> Content."

> "you may not sell any videos, music, or images that you created using Nintendo
> Game Content."

The named platforms are Facebook/META, Niconico, Twitch, X, YouTube, TwitCasting,
17LIVE and Instagram. **A publisher's own website is not among them, and
TechCarvalho is not an individual consumer** — the guidelines exclude us on two
independent grounds, and contain no mention of news, press or journalistic use at
all.

`https://www.nintendo.com/us/copyright/` is a 404; the en-GB legal pages return
Nintendo's 404 page.

**Verdict:** *prohibited* under the consumer guidelines; *needs registration* via
press.nintendo.com, whose terms could not be read.

### 1.4 Ubisoft — *needs registration; open tier unclear-or-silent*

Terms of Use (<https://www.ubisoft.com/legal/documents/termsofuse/en-US>):

> "We grant you a personal, limited, non-exclusive, non-transferable,
> non-sublicensed, and revocable right and license to use the Services and access
> the Content, for your entertainment, non-commercial use."

> "You may not use, in any manner whatsoever, any elements of the Services or the
> Content for purposes other than those expressly permitted in these Terms."

No press, media, editorial or journalistic provision exists in the document.

`https://www.ubisoft.com/en-us/company/press` **is** open and does host direct
downloads — a Corporate Press Kit PDF, a Logos ZIP, a Visual Media Assets ZIP, a
Corporate Video ZIP — **with no usage terms displayed alongside any of them.**
Licence text may be inside the ZIPs; that was not opened. The page points
accredited media at `ubisoft-press.com`, which is a JS-only Indigo Pearl PressXtra
portal returning only "You seem to have an unsupported browser."

**Verdict:** *needs registration*. The open downloads are *unclear-or-silent* —
publication context strongly implies press use is intended, but **implication is
not a grant**, and rule 2 above decides it.

### 1.5 Electronic Arts — *needs registration; public layer silent*

User Agreement §2 (<https://www.ea.com/legal/user-agreement>):

> "EA or its licensors own and reserve all other rights, including all right,
> title and interest in the EA Services and associated intellectual property
> rights."

> "You may not access, copy, modify or distribute any EA Service, Content or
> Entitlements … unless expressly authorized by EA or permitted by law."

*(The ellipsis is as returned by the fetch — text was elided mid-sentence. The
opening and closing fragments are verbatim; the elided middle is unverified.)*

`press.ea.com` 301s to `eapressportal.com`, which is JS-gated and returned only a
browser-upgrade message. `ea.gamespress.com` → **401**. Every readable EA page is
**silent** on third-party editorial reproduction, and there is no EA fan-content
or brand-guidelines document among the 14 items on `/legal`.

**Verdict:** *needs registration*. Silence plus a blanket reservation is a "no".

### 1.6 Activision — *could not read anything they wrote*

**Zero Activision-authored text was obtainable.** Every `activision.com`,
`callofduty.com` and `activisionblizzard.com` fetch died with **ECONNRESET**
across four paths — a domain-wide edge block. `news.activision.com` does not
resolve (**DNS ENOTFOUND**). `blizzard.gamespress.com` → **401**.
`news.xbox.com/en-us/press-kits/` → **404**.

**This is a blocked-access finding, not evidence of absence, and not permission.**
Under rule 2 it resolves to "no" until someone reads the terms from a normal
browser.

**Verdict:** *unclear — unreadable*. Treat as prohibited. Note that Microsoft's
Xbox rules explicitly decline to cover content Microsoft does not own the IP in,
so the acquisition does **not** obviously bring Call of Duty inside the Xbox
rules — and the Xbox rules exclude commercial websites anyway.

### 1.7 Rockstar Games / Take-Two — *prohibited, and explicitly so*

**This is the clearest negative in the document, and it is the one that decides
the GTA VI page.** Rockstar does not merely fail to grant a permission — it
publishes a policy that names digital publishing and excludes it.

*Access note, because it shapes what "verified" means here:* every
`rockstargames.com` path returns **HTTP 403** to automated fetching and
`/legal` is a JS-only SPA that serves an empty `<body>` to any plain HTTP client;
`support.rockstargames.com` **times out entirely**. The clauses below were
recovered via a browser-UA `curl` and a rendering reader, not reconstructed from
memory or a search snippet. Independently confirmed here: `/legal` and
`/legal/videopolicy` are both 403 to WebFetch, and the support host times out.

**There is no Rockstar press or media centre at all.** `/press`, `/media`,
`/presskit`, `/press-kit`, `/videopolicy`, `/video-policy`, `/legal/video-policy`,
`/legal/terms` and `/legal/eula` are all **404**. No asset library, no press kit,
no GTA VI media page.

Rockstar Games Terms of Service, "Last Updated: February 28, 2025"
(<https://www.rockstargames.com/legal>) — §2.1 defines "Content" to include
"designs, graphics, artwork, illustrations, photographs, … characters, … locations,
stories, plot, animation, concepts, audio-visual effects, interactive features,
gameplay" and all trademarks and logos. Then:

> "Subject to the terms of this Agreement, we grant you a limited, non-exclusive,
> non-transferable, non-sublicensable, revocable license to access and use the
> Services, including Virtual Items and your Account, **for your personal,
> non-commercial enjoyment**." (§2.2)

> "The limited license granted in this Agreement does not give you any right to,
> and you may not, sell, copy …, loan, lease, distribute, disassemble … modify,
> create derivative works, **commercialize, or otherwise exploit the Services
> (including the Content)** … unless subject to separate, express written terms
> provided by Rockstar permitting such conduct." (§2.3)

> "Custom Content includes, without limitation, all content created using Our
> Tools including in-game assets, maps, **screenshots**, videos, recordings of
> in-game audio, gameplay clips, and livestreams. **You may only use Custom
> Content with the Services and/or only as authorized by us.**" (§5.3)

The agreement's own scope covers "our games, apps, products, **websites**, and
other services". Identical text, same date, appears at
<https://www.take2games.com/legal/> with "Take-Two" substituted for "Rockstar".

**And the fan-content policy — the one Rockstar permission that exists — is
written to exclude us by name.** `rockstargames.com/videopolicy` is dead; the live
successor, linked from Rockstar's own contact page, is
<https://support.rockstargames.com/articles/7bNaeoMFTV0iUDGhStTXvz>:

> "Generally, Take-Two Interactive does not object to our fans using materials for
> **non-commercial** uses…"

> "'Non-commercial' means that **you don't make money through the game footage you
> post** or use the material as part of a promotion for a product or service."

> "*Please note: this policy is intended to address occasional, non-commercial
> in-game content use by individual members of the Rockstar fan community. **It
> does not apply to the exploitation of Rockstar IP for film, TV, or streaming
> distribution; in music videos; advertisements; or publication in books,
> magazines, or digital publishing.** If you are a filmmaker, producer,
> screenwriter, author, musician, agent, or represent a production company or
> advertising agency, **this policy likely does not apply to you**. Licensing
> requests can be submitted to copyright@take2games.com for case-by-case
> consideration…*"

TechCarvalho is digital publishing. There is no ambiguity to resolve.

Take-Two's investor-relations release for GTA VI Trailer 2 carries no grant
either — its only rights language is "All trademarks and copyrights contained
herein are the property of their respective holders."
(<https://www.take2games.com/ir/news/adding-multimedia-rockstar-games-releases-trailer-2-grand-theft>)

**Verdict:** *prohibited*, absent a written licence from
`copyright@take2games.com`. **The GTA VI page's answer is §2, not §1** — and §2
works precisely because it does not depend on Rockstar granting anything.

### 1.8 Sony Interactive Entertainment — *the genuine contradiction: an open press library with no licence on it*

**Sony is the one worth flagging to a human**, because it is not silent — it is
self-contradictory in a way that looks like permission and is not.

`https://sonyinteractive.com/en/news/asset-library/` is a **real, open,
unauthenticated press asset library**. No login, no registration, no click-through
agreement. Categories: Games, Hardware, Logo, Leadership; 17 titles including
Astro Bot, Ghost of Yōtei, Marvel's Wolverine and The Last of Us, served as plain
direct links (`sonyinteractive.com/tachyon/2025/02/Games_Astro-Bot.jpg`) plus MP4
launch trailers. **It carries no licence, no terms, no usage grant and no
attribution requirement whatsoever** — only the site-wide footer, "© 2026 Sony
Interactive Entertainment. All content, games titles … are trademarks and/or
copyright material of their respective owners. All rights reserved."

The terms that actually govern that library, linked from its own footer
(<https://sonyinteractive.com/en/terms-of-service/>):

> "**Except for personal, non-commercial, internal use, you are prohibited from
> using (including, without limitation, coping, modifying, reproducing in whole or
> in part, uploading, transmitting, distributing, licensing, selling and
> publishing) any of the materials, without obtaining SIE Inc's prior written
> permission.**"

*(The "coping" typo is verbatim in Sony's source.)*

PlayStation Website Terms of Use §3
(<https://www.playstation.com/en-us/legal/website-terms-of-use/>), independently
fetched for this document:

> "You may not modify, publish, transmit, participate in the transfer or sale of,
> create derivative works of, or in any way exploit any of the Content … without
> our express permission."

> "We give you permission to use the Content **for your personal, non-commercial
> uses. You do not have our permission to distribute the Content, publicly display
> it, charge any fee for it, use it to create your own website**, construct a
> database with it or replicate our Sites…"

There is **no press or editorial exception anywhere in either document**, and
PlayStation's terms add an express reservation against automated republication
"for the purposes of Article 4(3) of the Digital Copyright Directive".

One more line worth recording, from Sony's own group news index
(<https://www.sony.com/en/SonyInfo/News/Press/>; `www.sony.com` is 403 to direct
fetching and was recovered via a rendering reader):

> "**Visual content in these press releases may be removed without prior notice
> due to copyright or licensing reasons.**"

That is Sony telling you it does not warrant ongoing rights in the imagery it
publishes — a direct reason not to treat a Sony press image as a safe source even
where you can download it.

`partners.playstation.net` is a game-developer publishing programme, not a press
asset portal.

**Verdict:** *unclear-or-silent, trending prohibited — needs written permission.*
An open library plainly *intended* for media, with governing terms that forbid
publishing its materials without prior written permission. Under rule 2 that
resolves as "no". The documented route to an actual answer is one Media Inquiry
(<https://www.playstation.com/en-us/media-inquiry-form/>) covering ongoing
editorial use — worth doing once, in writing, exactly as
`docs/canon-media-rights-request.md` proposes for Canon.

### 1.9 Valve / Steam — *prohibited for stills; the widget is the route Valve actually provides*

Valve Site Terms of Use (<https://www.valvesoftware.com/en/legal>):

> "Without limiting the foregoing, **you may not copy, republish, upload,
> download, post, transmit or distribute any Materials except as specifically
> provided herein.**"

> "Valve grants you a non-exclusive, non-transferable license, **for the duration
> of your next session of using the Site**, to: (i) download to one (1) computer,
> **solely for your personal use**, one (1) copy of any Materials…"

> "you may not: **(i) use or transmit any Materials on or to any other Web site or
> network**; … (iii) reproduce any Materials other than as specified above…"

Clause (i) is explicit and directly on point.

`https://store.steampowered.com/legal/` has four headings — Copyright, Valve Video
Policy, Third Party Legal Notices, Claims of Copyright Infringement — and contains
**no third-party licensing terms and no press/media/editorial section at all**.
`valvesoftware.com/en/press` is company boilerplate ending in "For other press
inquiries, contact Kaci": no press kit, no assets, no usage clause.

The Valve Video Policy (<https://store.steampowered.com/video_policy>) is the one
affirmative grant, and it is **video-only**:

> "We are fine with publishing these videos to your website or YouTube or similar
> video sharing services. **We're not fine with taking assets from our games (e.g.
> voice, music, items) and distributing those separately.**"

> "**Use of our content in videos must be non-commercial.** By that we mean you
> can't charge users to view or access your videos."

> "You are free to monetize your videos via the YouTube partner program and
> similar programs on other video sharing sites."

A screenshot lifted from a Steam store page is not a video you made.

The Steam Branding Guidelines (<https://partner.steamgames.com/doc/marketing/branding>)
are addressed to **partners**, not press — "guidelines that should be followed **by
all partners** when using Steam branding" — cover the logo only, never capsule art
or screenshots, and reserve to Valve "the right to approve any communication using
the Steam brand before its distribution."

**A structural point that matters more than any of the above:** Steam capsule art
and screenshots for third-party titles are uploaded by the *publisher* under
Steamworks. The Red Dead Redemption 2 capsule on Steam is **Rockstar's**, and
falls under §1.7 — Valve could not grant editorial rights to it even if it wanted
to.

**Verdict:** *prohibited* for stills and capsule art; *partner-only* for the Steam
logo. The **Steam store widget** (§2.4) is the route Valve does provide, and it is
an embed, not a copy — verified live and unauthenticated at
`store.steampowered.com/widget/1174180/` (Red Dead Redemption 2).

### 1.10 Summary table

| Publisher | Asset class | Verdict |
|---|---|---|
| Microsoft | News Center corporate images | **editorial-use-only** — attribution + third-party clearance |
| Microsoft | Logos, key art, illustrations, photographs | **prohibited** without express licence |
| Xbox | Game screenshots / game content | **prohibited** for a commercial site |
| CD PROJEKT RED | Press Center promotional content | **needs registration** → then editorial-use-only, unmodified |
| CD PROJEKT RED | Anything not from the Press Center | **prohibited** |
| Nintendo | All game content | **prohibited** — consumer guidelines exclude businesses |
| Nintendo | press.nintendo.com | **needs registration** — 401, terms unreadable |
| Ubisoft | Content under public ToU | **prohibited** — non-commercial entertainment licence |
| Ubisoft | Open press-page ZIPs | **unclear-or-silent** — no licence text shown |
| EA | Everything readable | **prohibited** — blanket reservation, silent on editorial |
| Activision | Everything | **unclear — unreadable** (ECONNRESET / DNS / 401). Treat as prohibited |
| Rockstar / Take-Two | Screenshots, key art, everything | **prohibited** — fan policy expressly excludes "digital publishing" |
| Sony Interactive | Open Asset Library (no login) | **unclear-or-silent → needs written permission** — library has no licence; site ToS forbids publishing without prior written permission |
| Sony Interactive | playstation.com content | **prohibited** — personal, non-commercial only |
| Valve | Stills, capsule art, screenshots | **prohibited** — "you may not … use or transmit any Materials on or to any other Web site" |
| Valve | Steam logo | **partner-only** — branding guidelines address partners, Valve reserves pre-approval |
| GOG | Corporate press kit (logos only) | **unclear-or-silent** — no terms of any kind on the page |

---

## 2. Authorised embeds — the route that actually works

### 2.1 YouTube: the licence, quoted

This is the load-bearing section of the whole document, and every quote in it was
fetched first-hand.

From <https://www.youtube.com/t/terms>, *Licence to Other Users*:

> "You also grant each other user of the Service a worldwide, non-exclusive,
> royalty-free licence to access your Content through the Service, and to use
> that Content (including to reproduce, distribute, modify, display, and perform
> it) **only as enabled by a feature of the Service**."

And, under *Permissions and Restrictions*:

> "You may also show YouTube videos through the embeddable YouTube player."

**Why this is a real permission and not a rationalisation.** The chain is
publisher → YouTube → us. Rockstar uploaded the GTA VI trailer to Rockstar's own
channel and thereby granted every other user of the Service a licence to use that
content as enabled by a feature of the Service; the embeddable player is named as
such a feature. **We are relying on YouTube's terms, not on Rockstar's silence** —
which is precisely why this route works for the publishers whose own terms are
403-blocked and unreadable.

One honest caveat on the reading. The preceding sentence — "You may view or listen
to Content for your personal, non-commercial use" — attaches "non-commercial" to
*viewing and listening*. The embeddable-player sentence is a **separate sentence**
and is not qualified by it. That is the textual basis on which commercial news
sites embed, and it is a reasonable reading rather than a court-tested one. It is
the load-bearing interpretation in this document and is flagged as such.

**The licence ends when the video does:**

> "The licences granted by you continue until the Content is removed as described
> below."

So an embed is never archival. Caption every embed with enough context that the
article still reads correctly after the player 404s.

**Uploaders control embeddability.** Content Manager partners can restrict
embedding on specific domains or all domains
(<https://support.google.com/youtube/answer/6301625>), and
"Age-restricted videos can't be watched on most 3rd party websites"
(<https://support.google.com/youtube/answer/171780>). The per-video creator
"Allow embedding" toggle is documented in YouTube Studio but a source page for it
could not be retrieved in this session — **recorded as unverified**. In practice
`scripts/verify-official-embed.ts` (§3.2) catches a non-embeddable video anyway.

### 2.2 The conditions, which are engineering constraints not editorial advice

From <https://developers.google.com/youtube/terms/required-minimum-functionality>:

> "You must not display overlays, frames, or other visual elements in front of any
> part of a YouTube embedded player, including player controls. Similarly, you
> must not use overlays, frames or other visual elements to obscure any part of an
> embedded player."

> "Embedded players must have a viewport that is at least 200px by 200px"

…and 16:9 players "at least 480 pixels wide and 270 pixels tall".

> "A page or screen must not have more than one YouTube player that automatically
> plays content simultaneously."

From <https://developers.google.com/youtube/terms/developer-policies>, prohibited:

> "modify, build upon, or block any portion or functionality of a YouTube player."

> "modify, interfere with, replace, or block advertisements placed or served by
> YouTube … including in API Data, YouTube audiovisual content, or YouTube
> players."

> "interfere with or obscure any attribution provided by YouTube, including
> attribution provided via or shown in embedded YouTube players."

…and situating "the YouTube player in a nested or hierarchical iframe lineage to
circumvent YouTube policies or otherwise obfuscate the source of use."

**The overlay rule kills the obvious optimisation.** A custom thumbnail with our
own play button drawn over the iframe is the standard "lite embed" pattern and it
is the thing the first quote prohibits. If a click-to-load facade is ever wanted
for performance, it must render **instead of** the iframe, never on top of it.
The same rule is why `modestbranding` is not set: stripping YouTube's branding is
the same instinct pointed at the same clause.

**Scope caveat.** The API Services Terms define "YouTube API Services" as "the
YouTube API services (e.g., YouTube Data API service and YouTube Reporting API
service)" and no clause naming the embedded player was found in that definition —
so whether a plain no-JS `<iframe>` is contractually bound by the *API* terms is
arguably unclear. The RMF and Developer Policies pages plainly address the
embedded player regardless. Complying either way costs nothing editorially, so
the component complies.

**No API key or registration is required to embed.**

### 2.3 Privacy: youtube-nocookie.com

From <https://support.google.com/youtube/answer/171780>:

> "The Privacy Enhanced Mode of the YouTube embedded player prevents the use of
> views of embedded YouTube content from influencing the viewer's browsing
> experience on YouTube."

> "Change the domain for the embed URL in your HTML from https://www.youtube.com
> to https://www.youtube-nocookie.com."

**Do not over-claim this.** Google's own wording is about *personalisation*, not
about setting no cookies at all. Calling it "cookieless" in reader-facing copy
would overstate what Google documents. `src/lib/media/video-embed.ts` uses it as
the default host and says so in those terms.

### 2.4 Steam store widget — usable in practice, silent as to third parties

<https://partner.steamgames.com/doc/marketing/widget>:

> "For any game with a visible purchase option in the Steam store, you can create
> a widget with information about your product, current price, any discounts, and
> a purchase button"

The endpoint (`https://store.steampowered.com/widget/{appid}/`) is public,
unauthenticated, self-branded, auto-updating and carries Valve's own UTM
parameters — strong implied-permission evidence. **But the documentation is
written in partner docs and addressed to the publisher: "information about *your*
product". There is no written licence to third-party press.**

**Verdict:** *unclear-or-silent as to third parties*, usable in practice. Two
things to note before using it: it embeds a live **purchase button**, so
`docs/monetisation-and-affiliate.md` and the affiliate disclosure apply; and its
price display is live data we did not verify, which touches the
"never render fabricated … prices" rule in CLAUDE.md from the other direction.

### 2.5 Social embeds

- **Mastodon** — *usable*, and the cleanest of the three. A standards-based oEmbed
  endpoint marked "OAuth: Public", no authentication
  (<https://docs.joinmastodon.org/methods/oembed/>).
- **X / Twitter** — *unclear*. Every terms door was shut:
  `developer.x.com/en/developer-terms/display-requirements` → **402**,
  `publish.x.com` → **402**, `help.x.com` embed and API pages → **403**. No X
  terms text was obtained, and none is characterised here from memory.
- **Bluesky** — *unclear*. `embed.bsky.app` is a JS-only app; `docs.bsky.app`
  redirects to `bsky.network` where the docs paths 404/403.

---

## 3. What this means for the 15 gaming articles

### 3.1 The three articles the codebase itself flags

Running the live data through `classifyMediaTier()` / `inferSubjectKind()` /
`evaluateHero()`, exactly three published gaming articles have a hero the
hierarchy calls unacceptable. Every other gaming hero is a comparison graphic on
a comparison page or a diagram on an explainer — which `evaluateHero()` considers
correct, and which this document does not propose changing.

| Article | Current hero | Verdict | Route |
|---|---|---|---|
| `gta-6-release-date-status` | `-hero-gta-6-release-date-status.png` (title card) | `generic_graphic` on `named_media` | **Official Rockstar trailer embed** (§2). No still image route exists. |
| `next-gen-console-rumor-tracker-ps6-xbox` | `-hero-next-gen-console-rumor-tracker-ps6-xbox.png` (title card) | `generic_graphic` on `named_media` | **Nothing to photograph** — PS6 and next Xbox hardware have not been shown. A held PS5/Xbox Series X photo captioned as current-generation hardware is honest; inventing a next-gen visual is not. |
| `ps5-storage-expansion-compatible-ssd-guide` | `-hero-gaming.png` (shared category title card) | `generic_graphic` on `named_media` | **Already solved, no sourcing needed** — `playstation-5` holds a verified CC BY-SA 4.0 hero photo (Osh33m, Commons). Reuse it. |

`why-consoles-got-more-expensive-2026` and `hdmi-2-1-console-gaming-explained`
also sit on the shared `-hero-gaming.png`, but `inferSubjectKind()` reads both as
`conceptual`, where `evaluateHero()` calls a title card acceptable. Sharing one
card across three articles is still a publication-quality problem; it is not a
rights problem, and it is out of scope here.

### 3.2 Console hardware is already solved, and was already checked

`product_media` was queried before anything was sourced. Every gaming product
that can be shown, already is:

| Product | Hero | Licence |
|---|---|---|
| `playstation-5` | Commons photo | CC BY-SA 4.0 |
| `xbox-series-x` | Commons photo | CC BY-SA 4.0 |
| `xbox-series-s` | Commons photo | CC BY-SA 4.0 |
| `nintendo-switch-2` | Commons photo | CC BY-SA 4.0 |
| `playstation-5-pro` | **none** | Blocked — see `scripts/import-commons-product-media.ts` `REJECTED` |

**Nothing was re-sourced.** The correct move on the PS5 storage guide is to reuse
the photograph the site already holds, not to acquire a second one.

---

## 4. Wikimedia Commons: what it is and is not good for here

Commons unblocked 22 products (`docs/product-media-strategy.md` §3a). Its reach
into *gaming* is sharply bounded, and the boundary is worth stating precisely
because it is easy to get backwards.

**Method note, and it is the one that matters.** Commons was searched by
**category, enumerated in full**, never by free text — the lesson
`docs/product-media-strategy.md` §3a paid for. A plain-text search for a console
returns screenshots *taken on* it; files are titled in Polish, French and
Japanese; and dedicated categories exist for products a name search scores at
zero.

### 4.1 Console and peripheral hardware — **genuinely applicable**

Real, freely-licensed photography exists and is already in use here. Beyond what
the site holds, `Category:Nintendo Switch 2 Console` (33 files) is largely CC BY
4.0 studio photography by PantheraLeo1359531 — the same photographer whose RTX
5090 shot is already live on this site — and `Category:PlayStation Portal` holds
three CC BY / CC BY-SA 4.0 photographs.

### 4.2 Editorial event and trade-show photography — **genuinely applicable, and badly underused**

This is the most significant unexploited finding in this document, and it is the
one that changes what gaming coverage can look like here over time.

| Category | Files | Licence | Photographer |
|---|---|---|---|
| `Tokyo Game Show 2025` | **1,781** | CC BY 4.0 | RuinDig / Yuki Uchida (single contributor) |
| `Nintendo Switch 2 launch event in New York City` | **236** | CC BY 4.0 | SWinxy (single contributor) |
| `Gamescom 2025` | 65 | CC BY-SA 4.0 / CC BY 4.0 | mixed |
| `ROG Xbox Ally` | 8 | CC BY 4.0 / CC BY-SA 4.0 | RuinDig, Kyu3a |

Two Switch 2 launch files were downloaded and looked at: the Nintendo New York
storefront behind red "NINTENDO SWITCH 2" crowd barriers, and the launch-morning
queue down 48th Street. This is genuine photojournalism of a gaming event under a
genuine free licence — **the closest thing to press photography that needs
nobody's permission**, and the only route in this document that produces a real
photograph of gaming culture rather than a logo or a chart.

Nothing was ingested, for an editorial reason rather than a rights one: **none of
the 15 current gaming articles is about a launch or a trade show**, and pairing
launch-queue photography with an article about console pricing would be a
stretched fit. Recorded here so the next gaming article that *is* about one does
not start from zero.

**Three things to check before using any of it**, none of which the CC licence
answers:

1. **Identifiable members of the public** appear throughout. Personality rights
   are a separate question from copyright — Commons flags some of these files
   with a `Restrictions: personality` or `costume` note, and those notes are not
   exhaustive.
2. **A booth photograph incidentally shows the publisher's key art** on the walls
   and screens behind it. Photographing a public trade-show stand is ordinary
   editorial practice, but a frame *composed around* a key-art poster is closer to
   reproducing the artwork than to documenting the event. Prefer frames where the
   stand, the hardware or the crowd is the subject.
3. **Same standard as everywhere else**: open the file page, read the raw
   wikitext for the licence template, check EXIF for a contradicting rights
   assertion, and look at the image to confirm it depicts what the caption will
   claim. `scripts/import-commons-product-media.ts` documents the three-step
   procedure.

### 4.3 Game screenshots and key art — **essentially never**

Commons hosts only freely-licensed content, so a publisher's screenshot cannot be
there legitimately. `Category:Video game screenshots` (757 files) is dominated by
open-source and indie titles whose developers actually licensed them. **No
AAA publisher's key art is available through this route, and a file appearing
there does not make it so** — `docs/product-media-strategy.md` §2.1's rule stands:
a Commons licence tag is a claim, not proof.

### 4.4 Logos — **available, and deliberately not used**

This one deserves the space, because it looks like an easy win and is not.

`Category:Grand Theft Auto VI` holds six files, and every one is tagged
`{{PD-textlogo}}` — the assertion that the mark falls below the threshold of
originality and is therefore uncopyrightable. Four also carry `{{Trademarked}}`.
The same pattern holds for `Category:Xbox Game Pass logos` (ten Microsoft
`{{PD-textlogo}}` SVGs) and `Category:Call of Duty`.

**They were not ingested. Four reasons, in order of weight:**

1. **The files themselves admit the real logo is not below the threshold.**
   `File:Gta 6 logo - no palms.png` describes itself, in its own wikitext, as
   *"Logo according to trailer, removed palmtrees to not meet the threshold of
   originality"*. That is an uploader stating outright that the actual GTA VI
   logo needed a copyrightable element stripped out before the PD claim held.
2. **The provenance fails our own bar.** The `source` fields point at
   `logos.fandom.com`, `seeklogo.com` and a Polygon article — third-party scrape
   sites, not Rockstar. Rule 1 of this document applies to Commons as much as to
   anywhere else, and `rights_status = 'verified'` means *a human read the terms*,
   which is not possible when the terms are a stranger's threshold-of-originality
   opinion about someone else's mark.
3. **`{{Trademarked}}` is a separate body of law the CC/PD tag says nothing
   about.** Nominative editorial use of a mark to identify the thing being written
   about is generally defensible; a logo occupying the hero slot of a commercial
   page is nearer the other end of that spectrum.
4. **It would not solve the problem anyway.** A wordmark is not a picture of the
   game. Swapping a TechCarvalho title card for a Rockstar title card is a
   lateral move, and it would sit at `licensed_third_party` at best on the
   `hierarchy.ts` scale.

**Verdict: unclear-at-best, and unnecessary.** The embed shows the actual game.

---

## 5. What was built

Nothing is wired into any article. All three are new files.

- **`src/lib/media/video-embed.ts`** — pure helpers. `parseYouTubeId()` accepts
  every YouTube URL shape and refuses lookalike hosts; `buildYouTubeEmbedUrl()`
  emits a `youtube-nocookie.com` URL with `rel=0` and **never** `autoplay`;
  `validateOfficialEmbed()` refuses to produce an embed unless the caller names
  the **official channel** the video came from — the single safeguard that
  separates a publisher's own upload from a fan re-upload, which carries no
  licence from anybody.
- **`src/lib/media/video-embed.test.ts`** — 10 tests, including that autoplay can
  never appear in a built URL and that a lookalike host
  (`youtube.com.evil.example`) is rejected rather than coerced.
- **`src/components/public/official-video-embed.tsx`** — the component.
  `youtube-nocookie`, no autoplay, `loading="lazy"` (overridable for an
  above-the-fold lead), `aspect-video` with a `min-h-[200px]` floor for the RMF
  200×200 rule, a real accessible iframe `title`, a reduced `allow` list with
  `autoplay` deliberately absent, and **no overlay of any kind** per §2.2. The
  caption states whose video it is and links out to it on YouTube, so the
  provenance claim is checkable by the reader.
- **`scripts/verify-official-embed.ts`** — confirms via YouTube's public oEmbed
  endpoint that a video is real, that it is embeddable, and, crucially, **which
  channel actually uploaded it**. Run before writing any embed into an article.
  It prints the channel URL and says outright that confirming the handle belongs
  to the publisher stays a human step.

Verified against the two real GTA VI trailers, live:

```
$ npx tsx scripts/verify-official-embed.ts QdBZY2fkU-0 VQRLujxTm3c
  title:   Grand Theft Auto VI Trailer 1     channel: Rockstar Games
  title:   Grand Theft Auto VI Trailer 2     channel: Rockstar Games
  channel url: https://www.youtube.com/@RockstarGames
```

Both are Rockstar's own uploads and both are embeddable.

---

## 6. What remains genuinely blocked, and what to do next

**Blocked on rights, permanently, absent accreditation:** GTA VI, Modern Warfare 4
and every other AAA title's **still imagery**. There is no route to a screenshot
or key art frame for any of them, and there will not be one without a signed press
relationship. The embed is not a workaround for this — it is a different act, and
**it does not clear a still.** Screenshotting a frame out of an embedded trailer
and running it as an article image is reproduction of the underlying work and is
governed by the publisher's own terms. Do not let one clear the other.

**Blocked on access, recheck from a normal browser:**

1. **Activision** — domain-wide ECONNRESET; `news.activision.com` does not
   resolve. The only publisher whose terms nobody read at all.
2. **X/Twitter and Bluesky** embed terms — 402/403 at every entry point.
3. **GOG's User Agreement** — 403 on every `support.gog.com` legal page.
4. **Sony's corporate (non-PlayStation) newsroom terms** — `www.sony.com` and
   `presscentre.sony.eu` are 403; only the news index was recovered.

**The one contradiction a human should resolve, not an agent:** Sony's open,
unauthenticated press Asset Library versus Sony's own terms forbidding
publication without prior written permission (§1.8). One Media Inquiry, answered
in writing, converts a large library of official PlayStation key art and hardware
imagery from unusable to usable. That is the single highest-value permission
request available to this site, and it is the same play
`docs/canon-media-rights-request.md` already drafts for Canon.

**Worth actually doing, in order:**

1. **Wire the PS5 storage guide to the PS5 photograph the site already holds.**
   Zero rights work, removes one of the three flagged heroes.
2. **Use the embed component on `gta-6-release-date-status`.** Deliberately not
   done here — the brief asked for the component built and reported, not wired.
3. **Send one Sony Interactive Media Inquiry** asking for written confirmation
   that the open Asset Library may be used editorially, and record the answer
   here either way. Highest value of anything on this list: it covers PlayStation
   key art and hardware imagery across the whole catalogue.
4. **Register with CD PROJEKT RED's Press Center** and report the HTTP 500 on
   their own advertised login URL to `media@cdprojektred.com`. Their §4.2 licence
   is the real thing and costs an e-mail confirmation.
5. **Re-read Activision's terms from a browser**, and record the result here
   whichever way it goes.
5. **Mine the trade-show corpora (§4.2) when a gaming article warrants it.**
   1,781 CC BY 4.0 frames from Tokyo Game Show 2025 alone is a standing supply of
   real gaming photography that needs nobody's permission — it is currently worth
   nothing to this site only because no published article is about an event.
   That is an editorial gap, not a rights one.
6. **Never** treat a press page's mere existence, a downloadable ZIP, a
   `{{PD-textlogo}}` tag, or a working image URL as permission.

---

## 7. Not legal advice

This is a documented reading of terms pages, recorded so the reasoning is
auditable rather than silently assumed — the same standing caveat as
`docs/product-media-strategy.md` §2.1. Two readings in this document are
load-bearing and are flagged where they appear: that the YouTube embeddable-player
sentence is not qualified by "non-commercial" (§2.1), and that placing an
unmodified CC BY-SA photograph beside independently-written text does not produce
Adapted Material (`product-media-strategy.md` §2.1). Both are well established in
practice. Neither was verified from a definitive clause.

**One thing this document deliberately does not answer.** Everything above is
about what rightsholders have **granted** — the contractual question. It says
nothing about what a court would find permissible as news reporting, criticism or
review under fair dealing (UK/EU) or fair use (US), which is a **statutory**
question and an entirely separate one. A publication's strongest ground for
running key art in a news story is usually statutory rather than licensed, and
that analysis needs a lawyer, not an agent. Nothing here should be read as
concluding that a use is unlawful — only that no permission was granted, which is
the standard this project operates to.
