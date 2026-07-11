/**
 * Aimcub Glass — the New Aim composer (the reference "NEW AIM" screen).
 *
 * A quiet, centered composer: an accent "NEW AIM" eyebrow, one big single-line headline input with
 * a bottom rule (a rotating ghost placeholder while empty), a circular submit that appears once the
 * input has content, a "Name the outcome" helper + an "Add details" toggle, spark suggestion chips
 * while empty, and a memory-aware footer.
 *
 * This is presentation only. Submit calls `onSubmit`, which App wires to the existing draft/plan
 * funnel unchanged — routing is not touched here. The runtime "not connected" guidance is rendered
 * by App and passed in as `guidance` so this component stays decoupled from the helper panel.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useI18n, type StringKey } from "../../i18n";

const GHOST_KEYS: StringKey[] = [
  "glass.newAim.ghost.0",
  "glass.newAim.ghost.1",
  "glass.newAim.ghost.2",
  "glass.newAim.ghost.3",
  "glass.newAim.ghost.4",
];

const SPARKS: Array<{ id: string; labelKey: StringKey; stubKey: StringKey }> = [
  { id: "trip", labelKey: "glass.newAim.spark.trip.label", stubKey: "glass.newAim.spark.trip.stub" },
  { id: "skill", labelKey: "glass.newAim.spark.skill.label", stubKey: "glass.newAim.spark.skill.stub" },
  { id: "decision", labelKey: "glass.newAim.spark.decision.label", stubKey: "glass.newAim.spark.decision.stub" },
  { id: "event", labelKey: "glass.newAim.spark.event.label", stubKey: "glass.newAim.spark.event.stub" },
  { id: "home", labelKey: "glass.newAim.spark.home.label", stubKey: "glass.newAim.spark.home.stub" },
];

const GHOST_ROTATE_MS = 2800;

export interface NewAimComposerProps {
  title: string;
  description: string;
  disabled?: boolean;
  /** Count of things Aimcub already knows (0 → first-run footer copy). */
  memoryCount: number;
  /** App-rendered runtime "not connected" guidance, shown below the composer when present. */
  guidance?: ReactNode;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onSubmit: () => void;
}

export function NewAimComposer(props: NewAimComposerProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const detailsRef = useRef<HTMLTextAreaElement | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => props.description.trim().length > 0);
  const [ghostIndex, setGhostIndex] = useState(0);

  const canSubmit = props.title.trim().length > 0;
  const isEmpty = props.title.length === 0;

  // Rotate the ghost placeholder only while the input is empty; clear on unmount.
  useEffect(() => {
    if (!isEmpty) return;
    const timer = window.setInterval(() => {
      setGhostIndex((current) => (current + 1) % GHOST_KEYS.length);
    }, GHOST_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [isEmpty]);

  useEffect(() => {
    if (props.description.trim().length > 0) setDetailsOpen(true);
  }, [props.description]);

  function submit(): void {
    if (!canSubmit || props.disabled) return;
    props.onSubmit();
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  function openDetails(): void {
    setDetailsOpen((open) => !open);
    if (!detailsOpen) window.setTimeout(() => detailsRef.current?.focus(), 0);
  }

  function applySpark(stubKey: StringKey): void {
    props.onTitle(t(stubKey));
    window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }, 0);
  }

  const footKey: StringKey = props.memoryCount === 0 ? "glass.newAim.footFirstRun" : "glass.newAim.footKnown";
  const ghostKey: StringKey = GHOST_KEYS[ghostIndex] ?? "glass.newAim.ghost.0";

  return (
    <section className="od-newaim" data-od-id="new-aim-composer">
      <div className="od-newaim-eyebrow">{t("glass.newAim.eyebrow")}</div>

      <div className="od-newaim-headline-row">
        <input
          ref={inputRef}
          className="od-newaim-headline"
          type="text"
          value={props.title}
          onChange={(event) => props.onTitle(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={t(ghostKey)}
          aria-label={t("glass.newAim.titleLabel")}
          disabled={props.disabled}
          autoFocus
        />
        {canSubmit ? (
          <button
            className="od-newaim-submit"
            type="button"
            onClick={submit}
            disabled={props.disabled}
            aria-label={t("glass.newAim.submit")}
            title={t("glass.newAim.submit")}
          >
            <NewAimArrowIcon />
          </button>
        ) : null}
      </div>

      <div className="od-newaim-helper-row">
        <span className="od-newaim-helper">{t("glass.newAim.helper")}</span>
        {canSubmit ? (
          <button className="od-newaim-details-toggle" type="button" onClick={openDetails}>
            {t(detailsOpen ? "glass.newAim.detailsHide" : "glass.newAim.detailsShow")}
          </button>
        ) : null}
      </div>

      {detailsOpen ? (
        <textarea
          ref={detailsRef}
          className="od-newaim-details"
          value={props.description}
          onChange={(event) => props.onDescription(event.target.value)}
          placeholder={t("glass.newAim.detailsPlaceholder")}
          aria-label={t("glass.newAim.detailsLabel")}
          rows={3}
          disabled={props.disabled}
        />
      ) : null}

      {isEmpty ? (
        <div className="od-newaim-sparks">
          {SPARKS.map((spark) => (
            <button
              key={spark.id}
              className="od-newaim-spark"
              type="button"
              onClick={() => applySpark(spark.stubKey)}
              disabled={props.disabled}
            >
              {t(spark.labelKey)}
            </button>
          ))}
        </div>
      ) : null}

      <p className="od-newaim-foot">{t(footKey, { n: props.memoryCount })}</p>

      {props.guidance}
    </section>
  );
}

function NewAimArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
      <path d="M4 10h11M11.5 5.5 16 10l-4.5 4.5" />
    </svg>
  );
}
