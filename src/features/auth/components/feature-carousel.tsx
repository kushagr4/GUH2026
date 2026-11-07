"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type FeatureSlide = {
  id: string;
  label: string;
  title: string;
  body: string;
  points: string[];
  visual: ReactNode;
};

const INTERVAL_MS = 7000;

/**
 * Tabbed feature carousel. It advances when the active tab's progress bar finishes
 * its CSS animation, so pausing simply freezes the animation. With
 * prefers-reduced-motion the animation is disabled in auth.css, which also stops
 * autoplay. It pauses on hover, on keyboard focus inside it, and via the pause button.
 */
export function FeatureCarousel({ slides }: { slides: FeatureSlide[] }) {
  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();

  const count = slides.length;
  const paused = userPaused || hovered || keyboardFocus;
  const wrap = (index: number) => (index + count) % count;

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const targets: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    const next = wrap(targets[event.key]);
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    if (event.target.matches(":focus-visible")) setKeyboardFocus(true);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
  }

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="EmberGap features"
      className="auth-tile-shadow overflow-hidden rounded-2xl border border-(--auth-line) bg-white"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="flex items-stretch border-b border-(--auth-line)">
        <div role="tablist" aria-label="Choose a feature" className="grid min-w-0 flex-1 grid-cols-4">
          {slides.map((slide, index) => {
            const selected = index === active;
            return (
              <button
                key={slide.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                id={`${baseId}-tab-${slide.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${slide.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(index)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={`group relative flex min-w-0 flex-col items-start gap-0.5 px-2.5 pt-3 pb-3.5 text-left outline-none transition-colors focus-visible:bg-(--auth-ember-wash) focus-visible:ring-2 focus-visible:ring-(--auth-ember)/60 focus-visible:ring-inset sm:px-4 ${
                  index > 0 ? "border-l border-(--auth-line-soft)" : ""
                } ${selected ? "bg-white" : "bg-(--auth-panel) hover:bg-white"}`}
              >
                <span
                  className={`font-mono text-[10px] tracking-[0.1em] ${selected ? "text-(--auth-ember-ink)" : "text-(--auth-ink-3)"}`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={`max-w-full truncate text-[12.5px] font-medium sm:text-sm ${selected ? "text-(--auth-ink)" : "text-(--auth-ink-2)"}`}
                >
                  {slide.label}
                </span>
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-(--auth-line-soft)">
                  <span
                    key={selected ? `on-${active}` : "off"}
                    data-active={selected}
                    className="auth-progress block h-full bg-(--auth-ember)"
                    style={{
                      animationDuration: `${INTERVAL_MS}ms`,
                      animationPlayState: paused ? "paused" : "running",
                    }}
                    onAnimationEnd={() => setActive((current) => wrap(current + 1))}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <div className="hidden items-center gap-1 border-l border-(--auth-line) px-2 sm:flex">
          <IconButton label="Previous feature" onClick={() => setActive(wrap(active - 1))}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Next feature" onClick={() => setActive(wrap(active + 1))}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </IconButton>
          <span className="contents motion-reduce:hidden">
            <IconButton
              label={userPaused ? "Resume feature rotation" : "Pause feature rotation"}
              onClick={() => setUserPaused((value) => !value)}
            >
              {userPaused ? (
                <Play className="size-3.5" aria-hidden="true" />
              ) : (
                <Pause className="size-3.5" aria-hidden="true" />
              )}
            </IconButton>
          </span>
        </div>
      </div>

      <div className="grid" aria-live={paused ? "polite" : "off"}>
        {slides.map((slide, index) => {
          const selected = index === active;
          return (
            <div
              key={slide.id}
              id={`${baseId}-panel-${slide.id}`}
              role="tabpanel"
              aria-roledescription="slide"
              aria-labelledby={`${baseId}-tab-${slide.id}`}
              aria-hidden={!selected}
              inert={!selected}
              className={`auth-slide grid grid-cols-1 gap-6 p-5 [grid-area:1/1] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] sm:p-6 ${
                selected ? "opacity-100" : "pointer-events-none translate-y-1.5 opacity-0"
              }`}
            >
              <div className="flex flex-col gap-3">
                <h3 className="text-lg leading-snug font-semibold tracking-[-0.015em] text-balance">
                  {slide.title}
                </h3>
                <p className="text-sm leading-relaxed text-pretty text-(--auth-ink-2)">{slide.body}</p>
                <ul className="mt-1 flex flex-col gap-2">
                  {slide.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-[13px] text-(--auth-ink)">
                      <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-(--auth-ember)" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0">{slide.visual}</div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-(--auth-line-soft) px-4 py-2.5 sm:hidden">
        <span className="font-mono text-[11px] text-(--auth-ink-3)">
          {String(active + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
        </span>
        <div className="flex items-center gap-1">
          <IconButton label="Previous feature" onClick={() => setActive(wrap(active - 1))}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Next feature" onClick={() => setActive(wrap(active + 1))}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </IconButton>
          <span className="contents motion-reduce:hidden">
            <IconButton
              label={userPaused ? "Resume feature rotation" : "Pause feature rotation"}
              onClick={() => setUserPaused((value) => !value)}
            >
              {userPaused ? (
                <Play className="size-3.5" aria-hidden="true" />
              ) : (
                <Pause className="size-3.5" aria-hidden="true" />
              )}
            </IconButton>
          </span>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-lg text-(--auth-ink-2) transition-colors outline-none hover:bg-(--auth-bg) hover:text-(--auth-ink) focus-visible:ring-3 focus-visible:ring-(--auth-ember)/40"
    >
      {children}
    </button>
  );
}
