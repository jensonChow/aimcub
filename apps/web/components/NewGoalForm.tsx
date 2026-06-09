"use client";

import { colors, radius, space } from "@ui/tokens";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createGoalAction } from "../app/actions";

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: colors.bg,
  color: colors.text,
  border: "1px solid #232733",
  borderRadius: radius.md,
  padding: "10px 12px",
  fontSize: 15,
};

const labelStyle = { display: "block", fontSize: 13, color: colors.textMuted, marginBottom: 4 };

/**
 * New Goal form: title / description / target_date. Submits to the createGoalAction
 * server action (which calls the injected DataPort), then navigates to the new goal so
 * the user immediately sees the decomposition.
 */
export function NewGoalForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createGoalAction(formData);
      if (result.ok && result.goalId) {
        router.push(`/goals/${result.goalId}`);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        background: colors.surface,
        border: "1px solid #232733",
        borderRadius: radius.lg,
        padding: space.lg,
        display: "flex",
        flexDirection: "column",
        gap: space.md,
      }}
    >
      <div>
        <label htmlFor="title" style={labelStyle}>
          Goal title
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="e.g. Ship my side project"
          style={inputStyle}
          disabled={isPending}
        />
      </div>

      <div>
        <label htmlFor="description" style={labelStyle}>
          Description (optional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          placeholder="A sentence or two about what done looks like."
          style={{ ...inputStyle, resize: "vertical" }}
          disabled={isPending}
        />
      </div>

      <div>
        <label htmlFor="target_date" style={labelStyle}>
          Target date (optional)
        </label>
        <input id="target_date" name="target_date" type="date" style={inputStyle} disabled={isPending} />
      </div>

      {error ? <p style={{ color: colors.danger, margin: 0, fontSize: 13 }}>{error}</p> : null}

      <button
        type="submit"
        disabled={isPending}
        style={{
          alignSelf: "flex-start",
          background: colors.primary,
          color: colors.bg,
          border: "none",
          borderRadius: radius.md,
          padding: "10px 18px",
          fontSize: 15,
          fontWeight: 700,
          cursor: isPending ? "default" : "pointer",
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? "Decomposing…" : "Create goal & decompose"}
      </button>
    </form>
  );
}
