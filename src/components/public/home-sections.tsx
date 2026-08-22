import Link from "next/link";
import { Badge } from "@/components/shared/ui";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { CONTENT_TYPE_LABEL, MediaFrame, SectionHeading, CARD_FOCUS, ArrowGlyph } from "@/components/public/cards";
import { findPlannedCategory } from "@/lib/public/categories";
import { mediaFit } from "@/lib/media/presentation";
import { classifiable } from "@/lib/public/hero-image";
import type { CategorySection, HomeQuestion, HomeStory, SubjectArea } from "@/lib/public/homepage";

// Front-page section components.
//
// Each of these renders REAL rows or nothing at all — there is no decorative
// section, no placeholder story, and no filler count anywhere in this file. The
// decision about whether a section has enough real content to exist is made in
// src/lib/public/homepage.ts (composeHomepage); these components assume they are
// only called with content that passed it, and several still guard defensively.
//
// Nothing here renders a rating, a review score, a view count, a price, or a
// popularity claim, because no such data exists to back one. Where a number IS
// shown it is a count of real rows the visitor could go and verify — how many
// articles are published in a subject area, how many other articles a guide is
// linked to.

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Compact horizontal story item, used down the side of a category section. */
export function StoryRow({ story }: { story: HomeStory }) {
  return (
    <Link href={`/articles/${story.slug}`} className={`group flex gap-4 rounded-lg py-4 ${CARD_FOCUS}`}>
      <MediaFrame
        src={story.heroImage?.url}
        // The story title is the link's own text, two inches to the right.
        // Repeating it as alt made every one of these rows announce itself
        // twice to a screen reader.
        alt={story.heroImage?.alt ?? ""}
        kind="content"
        fit={mediaFit(classifiable(story.heroImage))}
        sizes="(min-width: 640px) 96px, 80px"
        className="aspect-[16/9] w-20 shrink-0 rounded-lg border border-border-subtle sm:w-24"
        iconClassName="h-5 w-5"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            {CONTENT_TYPE_LABEL[story.type] ?? story.type}
          </span>
          {story.publishedAt && story.freshness && (
            <time dateTime={story.publishedAt} className="text-[11px] text-zinc-500">
              {story.freshness}
            </time>
          )}
        </div>
        <h3 className="font-display text-sm font-semibold leading-snug tracking-tight text-zinc-900 line-clamp-3 group-hover:text-accent sm:text-base">
          {story.title}
        </h3>
      </div>
    </Link>
  );
}

/** The image-led story that opens a category section. */
function FeatureStory({ story }: { story: HomeStory }) {
  return (
    <Link href={`/articles/${story.slug}`} className={`group block rounded-xl ${CARD_FOCUS}`}>
      <MediaFrame
        src={story.heroImage?.url}
        alt={story.heroImage?.alt ?? ""}
        kind="content"
        fit={mediaFit(classifiable(story.heroImage))}
        // 6 of 12 columns of the `max-w-6xl` shell: ~532px at full width, and
        // it stops there. "46vw" carried on growing past the container cap.
        sizes="(min-width: 1280px) 532px, (min-width: 1024px) 46vw, calc(100vw - 48px)"
        className="aspect-[16/9] w-full rounded-xl border border-border-subtle"
        iconClassName="h-12 w-12"
      />
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone="amber">{CONTENT_TYPE_LABEL[story.type] ?? story.type}</Badge>
          {story.publishedAt && story.freshness && (
            <time dateTime={story.publishedAt} className="text-xs text-zinc-500">
              {story.freshness}
            </time>
          )}
        </div>
        <h3 className="font-display mt-2.5 text-xl font-bold leading-tight tracking-tight text-zinc-900 group-hover:text-accent sm:text-2xl">
          {story.title}
        </h3>
        {story.excerpt && (
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 line-clamp-3 sm:text-base">{story.excerpt}</p>
        )}
      </div>
    </Link>
  );
}

/**
 * One subject area's block: a lead story plus the rest as rows. Rendered only
 * for categories that had a full block's worth of published content available
 * (CATEGORY_SECTION_MIN_STORIES) — a subject area with two articles is reached
 * through the subject-area grid instead, not padded out into a section here.
 */
export function CategorySectionBlock({ section }: { section: CategorySection }) {
  const headingId = `home-section-${section.slug}`;
  return (
    <section aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        action={
          <Link
            href={`/${section.slug}`}
            className={`inline-flex items-center gap-1.5 rounded text-sm font-semibold text-accent hover:underline ${CARD_FOCUS}`}
          >
            All {section.name}
            <ArrowGlyph className="h-4 w-4" />
          </Link>
        }
      >
        {section.name}
      </SectionHeading>
      <InternalLinkTracker linkPosition="home" categorySlug={section.slug}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6" data-entity-type="content" data-entity-id={section.lead.id}>
            <FeatureStory story={section.lead} />
          </div>
          {section.rest.length > 0 && (
            <ul className="divide-y divide-border-subtle border-t border-border-subtle lg:col-span-6">
              {section.rest.map((story) => (
                <li key={story.id} data-entity-type="content" data-entity-id={story.id}>
                  <StoryRow story={story} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </InternalLinkTracker>
    </section>
  );
}

/**
 * Guides ranked by how many other published articles they are linked to.
 *
 * This is the site's own content graph (content_relationships), which is real,
 * publicly readable, and verifiable by clicking through. It is deliberately NOT
 * called "popular" or "most read": nothing on this page knows how many people
 * read anything, and the heading note says so.
 */
export function ReferencedGuides({ guides }: { guides: HomeStory[] }) {
  if (guides.length === 0) return null;
  return (
    <section aria-labelledby="home-referenced-guides">
      <SectionHeading
        id="home-referenced-guides"
        note="The guides the rest of our coverage links to most often. This counts links between our own articles — it is not a measure of traffic."
        action={
          <Link
            href="/articles?type=guide"
            className={`inline-flex items-center gap-1.5 rounded text-sm font-semibold text-accent hover:underline ${CARD_FOCUS}`}
          >
            All guides
            <ArrowGlyph className="h-4 w-4" />
          </Link>
        }
      >
        Most referenced guides
      </SectionHeading>
      <InternalLinkTracker linkPosition="home">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {guides.map((guide) => (
            <li key={guide.id} data-entity-type="content" data-entity-id={guide.id}>
              <Link
                href={`/articles/${guide.slug}`}
                className={`group flex h-full flex-col gap-3 rounded-xl border border-border-subtle bg-white p-5 transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[0_1px_18px_-8px_rgba(180,83,9,0.45)] ${CARD_FOCUS}`}
              >
                {guide.categoryLabel && (
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                    {guide.categoryLabel}
                  </span>
                )}
                <h3 className="font-display text-base font-semibold leading-snug tracking-tight text-zinc-900 group-hover:text-accent">
                  {guide.title}
                </h3>
                <p className="mt-auto text-xs text-zinc-500">
                  Linked with {plural(guide.referenceCount, "other article")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </InternalLinkTracker>
    </section>
  );
}

function SearchGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="5.25" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12.9 12.9L16.5 16.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The questions our articles were written to answer.
 *
 * Source: content_items.primary_query — the one question an editor recorded as
 * the piece's target. That is a real, stored, per-article value.
 *
 * It is explicitly NOT search volume. The site's search-term intelligence is
 * admin-only (RLS would return zero rows to this page rather than an error), so
 * there is no honest "most searched" section to build and this does not pretend
 * to be one. The heading note states the distinction rather than leaving the
 * reader to infer a ranking that isn't there.
 */
export function QuestionRail({ questions }: { questions: HomeQuestion[] }) {
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="home-questions">
      <SectionHeading
        id="home-questions"
        note="Every article we publish is written to answer one specific question. These are those questions, straight from the pieces themselves — not a search-volume ranking."
        action={
          <Link
            href="/articles"
            className={`inline-flex items-center gap-1.5 rounded text-sm font-semibold text-accent hover:underline ${CARD_FOCUS}`}
          >
            Browse everything
            <ArrowGlyph className="h-4 w-4" />
          </Link>
        }
      >
        Questions we answer
      </SectionHeading>
      <InternalLinkTracker linkPosition="home">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {questions.map((question) => (
            <li key={question.id} data-entity-type="content" data-entity-id={question.id}>
              <Link
                href={`/articles/${question.slug}`}
                className={`group flex h-full items-start gap-3 rounded-xl border border-border-subtle bg-white px-4 py-3.5 transition-colors hover:border-accent/40 hover:bg-accent-soft/30 ${CARD_FOCUS}`}
              >
                <SearchGlyph className="mt-0.5 h-4 w-4 shrink-0 text-accent/70" />
                <span className="min-w-0 text-sm leading-relaxed text-zinc-700 group-hover:text-accent">
                  {question.query}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </InternalLinkTracker>
    </section>
  );
}

/**
 * Every subject area, with its real published counts.
 *
 * The counts come from actual published rows, so an area with nothing live says
 * so plainly instead of being hidden or dressed up. Previously this grid marked
 * an area "Coming soon" whenever it had no published PRODUCTS, which labelled
 * areas carrying a dozen published articles as unlaunched — the badge now
 * follows both counts.
 */
export function SubjectAreaGrid({ areas }: { areas: SubjectArea[] }) {
  if (areas.length === 0) return null;
  return (
    <section aria-labelledby="home-subject-areas">
      <SectionHeading id="home-subject-areas" note="Counts are live: every figure below is published work you can open right now.">
        Subject areas
      </SectionHeading>
      <InternalLinkTracker linkPosition="home">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => {
            const blurb = findPlannedCategory(area.slug)?.blurb;
            const isEmpty = area.articleCount === 0 && area.productCount === 0;
            const counts = [
              area.articleCount > 0 ? plural(area.articleCount, "article") : null,
              area.productCount > 0 ? plural(area.productCount, "product") : null,
            ].filter(Boolean);

            return (
              <Link
                key={area.slug}
                href={`/${area.slug}`}
                id={`home-category-${area.slug}`}
                data-entity-type="category"
                data-category-slug={area.slug}
                className={`group flex flex-col rounded-xl border border-border-subtle bg-white p-5 transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[0_1px_18px_-8px_rgba(180,83,9,0.45)] ${CARD_FOCUS}`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h3 className="font-display font-semibold tracking-tight text-zinc-900 group-hover:text-accent">
                    {area.name}
                  </h3>
                  {isEmpty && <Badge>Nothing published yet</Badge>}
                </div>
                {blurb && <p className="text-sm leading-relaxed text-zinc-500">{blurb}</p>}
                {counts.length > 0 && (
                  <p className="mt-3 text-xs font-medium text-zinc-600">{counts.join(" · ")}</p>
                )}
              </Link>
            );
          })}
        </div>
      </InternalLinkTracker>
    </section>
  );
}
