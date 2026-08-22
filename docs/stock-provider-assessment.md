# Pexels and Unsplash: investigated, not enabled

**Status: research finding. Neither service was signed up for, no API key was requested, no
dependency was added, nothing was integrated. £0 spent.** Written 2026-08-22 as part of the
media provider work in `src/lib/media/providers/`. The registry entries recording this
decision are in `src/lib/media/providers/registry.ts`.

The question asked was narrow: **could Pexels or Unsplash be integrated safely as a source of
photographs of identifiable branded consumer products** — a PS5 Pro, an RTX 5080, a Deco BE85 —
for a site that carries affiliate links and is therefore a commercial use.

**The answer is no, and both services say so themselves.** Not in small print about
attribution, but in the operative grant clause of each licence.

---

## The clause that decides it

### Unsplash

> "Note that the Unsplash License does not include the right to use:
> — Trademarks, logos, or brands that appear in Images
> — People's images if they are recognizable in the Images
> — Works of art or authorship that appear in Images"
>
> — <https://unsplash.com/terms>

> "If you download images with any of these depicted in them, you may need the permission of the
> brand owner of the brand or work of authorship or individual depending on how you use the Image."
>
> — <https://unsplash.com/terms>

A photograph of a PS5 Pro is a photograph of Sony's trademarks and trade dress and very little
else. Unsplash grants the photographer's copyright and **expressly withholds the rest**. There is
no version of "hero image on a product page" that does not depend on the withheld part.

The help centre's more permissive reading does not rescue it, because it is explicitly scoped to
non-commercial use:

> "If you're using the images for non-commercial purposes, in positive contexts, and you're not
> implying an endorsement from the trademark holder, then you can likely use the images."
>
> — <https://help.unsplash.com/en/articles/14224409-what-if-there-is-a-brand-logo-in-an-image-on-unsplash>

### Pexels

Pexels states it as a prohibition rather than a carve-out, which is stronger still:

> "If Content depicts any trademarks, logos or brands (whether two- or three-dimensional), you
> cannot use that Content for commercial purposes in relation to goods and services, in particular
> not print that Content on merchandise or other physical products for sale."
>
> — <https://www.pexels.com/terms-of-service/> (Last Updated: 15 November 2024)

The "in particular… merchandise" example arguably signals that the drafters were aiming at
merchandising rather than editorial illustration. But the operative sentence is unqualified, and
the same document removes any doubt about who carries the risk:

> "Before using any Content (including CC0 Content), you must consider whether you require the
> consent of a third party or a license to use the Content. If your use of the Content is for
> commercial purposes (e.g. in conjunction with the sale or promotion of a product or service) then
> it is likely that you will need consent or a license. **Responsibility for determining whether
> permissions are needed always rests solely and exclusively with you.**"
>
> — <https://www.pexels.com/terms-of-service/>

A product page beside an affiliate link is "in conjunction with the sale or promotion of a product".

---

## What the headline licences say, for completeness

Both grant commercial use of the **photographer's copyright**, and both waive attribution:

> "All photos and videos on Pexels are free to use." / "Attribution is not required. Giving credit
> to the photographer or Pexels is not necessary but always appreciated."
> — <https://www.pexels.com/license/>

> "download, copy, modify, distribute, perform, and use images from Unsplash for free, including for
> commercial purposes" / "No permission needed (though attribution is appreciated!)"
> — <https://unsplash.com/license>

That headline is exactly the trap this project keeps writing down and hitting anyway: **a
permissive licence on the copyright is not permission to depict the subject.** The copyright and
the trade dress are two different rights held by two different parties, and only one of them is
Pexels' or Unsplash's to give.

Other restrictions, quoted because they bear on how the media pipeline works:

- Pexels: "Don't sell unaltered copies of a photo or video…"; "Don't redistribute or sell the photos
  and videos on other stock photo or wallpaper platforms."; "Don't use the photos or videos as part
  of your trade-mark, design-mark, trade-name, business name or service mark." (<https://www.pexels.com/license/>)
- Pexels "Standalone" definition: "where no creative effort has been applied to the Content and it
  remains in substantially the same form as it exists on the Service", with "You cannot sell or
  distribute the Content on a Standalone basis". (<https://www.pexels.com/terms-of-service/>)
- Unsplash: "Images cannot be sold without significant modification." and no "Compiling images from
  Unsplash to replicate a similar or competing service." (<https://unsplash.com/license>)

Both prohibitions are scoped to *selling or distributing the image*, not to editorial
republication, so neither directly bites on a hero image. Neither was the deciding factor.

There is **no** "the photo may not be the main attraction" clause on either service. That wording
was looked for specifically and is genuinely not present.

---

## No clearance warranty, and the liability runs the wrong way

> "We do not warrant that any consents or licenses have been obtained in relation to any Content."
> — Pexels, <https://www.pexels.com/terms-of-service/>

> "While contributors agree that images uploaded to Unsplash have model releases, there is no
> reasonable way for us to monitor all images." / "We cannot make any guarantees about the scope of
> permitted uses." / "Objects that appear in the image may have copyright or trademark protection
> that prohibit use of the image without permission."
> — <https://help.unsplash.com/en/articles/2612329-releases-and-trademarks> (updated 8 August 2025)

Both carry indemnity clauses running in their own favour. So the position is: no warranty, full
liability on the reuser, and an explicit statement that the thing we would be relying on is not
granted. That is a worse position than Wikimedia Commons, which at least exposes the uploader's own
declaration, the source chain and the EXIF so a claim can be *checked* — and which this project
already treats as a claim rather than proof.

---

## The structural objection, independent of the terms

Even if the trademark clauses said the opposite, neither service fits the pipeline in
`src/lib/media/providers/`.

That pipeline's rights stage works on **per-asset primary evidence**: the licence template as the
uploader wrote it, the author field, the permission field, the embedded EXIF, and a content hash —
each labelled with where it was read from, so a licence claim can be cross-checked against
something that could contradict it. That is what caught `File:Canon_EOS_5D.jpg` (CC badge on the
page, "all rights reserved" in EXIF) and what correctly did **not** catch the GoPro file (EXIF
Copyright naming the photographer, which is what a properly-licensed CC file looks like).

Pexels and Unsplash expose a **platform-wide licence grant**, not a per-photo licence with an
evidence trail. There is nothing to cross-check: the API returns the same licence statement for
every photo, so `licenceDeclared` and `licenceMetadata` would be the same fact reported twice. Both
are therefore recorded in the registry with `exposesPrimaryEvidence: false`, the same flag that
disqualifies Openverse as a rights source.

---

## Operational notes, if they are ever revisited for non-branded imagery

Both are perfectly reasonable for **decorative, non-branded editorial imagery** — abstract
textures, desks, hands, generic ambience — where no trademark, no recognisable person and no
artwork is in frame. That is a different job from product photography and would need its own
reviewer check ("nothing identifiable in frame"), not a relaxation of this one.

If that is ever pursued, the practical differences matter:

| | Pexels | Unsplash |
|---|---|---|
| API key | Account signup required; instant key; free | Developer account required; free tier 50 req/hr demo, 1000 req/hr approved |
| Rate limit | 200/hr, 20,000/month | as above |
| Attribution | Licence says not required; **API guidelines require it anyway** — "Whenever you are doing an API request make sure to show a prominent link to Pexels." (<https://www.pexels.com/api/documentation/>) | Mandatory: "your Developer App must attribute Unsplash, the Unsplash photographer, and contain a link back to the photographer's Unsplash profile" with `utm` parameters (<https://unsplash.com/api-terms>) |
| Hotlinking | Not mandated | **Mandated**: "All API uses must use the hotlinked image URLs returned by the API under the photo.urls properties." (<https://unsplash.com/documentation>) |
| Download tracking | None | Mandatory ping to `photo.links.download_location` |

The hotlinking mandate is the one that would actually break something. This site's publish flow
copies the object into its own `media-public` bucket (see CLAUDE.md, *Media storage architecture*);
Unsplash's API terms forbid self-hosting API-sourced images. Integrating Unsplash would mean either
breaching that clause or building a second, hotlinked display path — a structural change to the
media architecture in exchange for imagery we have established we cannot use for products anyway.

Note also that Pexels' "attribution is not required" headline is contradicted by its own API
guidelines. Any integration must render attribution unconditionally regardless of what the licence
page says.

---

## Conclusion

1. **Do not enable either as a product-photography provider.** Both explicitly withhold the right
   to use the trademarks and brands that a product photograph consists of.
2. The existing gate in `src/lib/media/rights.ts` — which refuses to treat a `source_url` or a
   stock `source_type` as proof of rights — is vindicated by both sets of terms, not merely
   consistent with them.
3. For genuine product photography the routes that remain are unchanged: freely-licensed
   photography with per-file evidence (Wikimedia Commons, the only enabled provider), manufacturer
   press kits carrying an explicit press-use grant, TechCarvalho's own staff photography, or a paid
   editorial-use stock licence. The last is outside the £0 constraint.
4. **Nothing here is legal advice.** It is a record of what the terms say, with the URLs, so the
   reasoning is auditable rather than silently assumed. The two decisive clauses — Unsplash's
   "does not include the right to use… Trademarks, logos, or brands" and Pexels' "you cannot use
   that Content for commercial purposes in relation to goods and services" — should be re-read at
   source before anyone acts on this document, since both pages can change without notice.
