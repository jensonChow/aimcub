/**
 * @core/proactive — the "decision" layer for proactive outreach (pure logic) + channel adapter interfaces.
 * Concrete implementations of the delivery "transports" (APNs/SMTP/Realtime) are registered as adapters by each client shell / Edge Function.
 *
 * Notification fatigue is where products fail: this is the central place that implements the "interruption budget" gate.
 * Positive and negative feedback are asymmetric — celebrations (positive feedback) are not rate-limited; nudges (reminders) are rate-limited by total daily volume at the [user level] (aggregated across all pets).
 */
import { type NotificationChannel, type NotificationTrigger } from "@core/types";

export const CELEBRATION_TRIGGERS: ReadonlySet<NotificationTrigger> = new Set<NotificationTrigger>([
  "milestone_done",
  "goal_done",
]);

export function isCelebration(trigger: NotificationTrigger): boolean {
  return CELEBRATION_TRIGGERS.has(trigger);
}

/** UTC milliseconds + timezone offset → local hour (0..23). */
export function localHour(utcMillis: number, tzOffsetMinutes: number): number {
  const local = utcMillis + tzOffsetMinutes * 60_000;
  return ((Math.floor(local / 3_600_000) % 24) + 24) % 24;
}

/** Whether the local hour falls within quiet hours. Supports windows that span midnight (e.g. [22, 8]). */
export function withinQuietHours(hour: number, window: readonly [number, number]): boolean {
  const [start, end] = window;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // spans midnight
}

export interface SuppressInput {
  trigger: NotificationTrigger;
  channel: NotificationChannel;
  /** Local hour (computed with localHour). */
  localHour: number;
  quietHours: readonly [number, number];
  /** Total nudges already sent today at the user level (aggregated across all pets/goals). */
  nudgeCountToday: number;
  /** Per-user daily nudge cap (defaults to 2). */
  nudgeDailyCap: number;
  /** Whether this dedup_key has already been sent. */
  isDuplicate: boolean;
}

export interface SuppressDecision {
  suppress: boolean;
  reason?: "duplicate" | "quiet_hours" | "daily_cap";
}

/**
 * Decide whether an intent should be delivered. Rules:
 *  1. Deduplication (dedup_key hit) → suppress.
 *  2. Quiet hours: suppress only for "night-sensitive" channels (push/email); in_app/agent_inbox are non-intrusive, so let them through.
 *  3. Non-celebration intents (nudges: stale/deadline_near/scheduled) are bounded by the per-user daily total cap.
 *     Celebration intents (milestone_done/goal_done, positive feedback) are not rate-limited.
 */
export function decideDelivery(i: SuppressInput): SuppressDecision {
  if (i.isDuplicate) return { suppress: true, reason: "duplicate" };

  const nightSensitive = i.channel === "push" || i.channel === "email";
  if (nightSensitive && withinQuietHours(i.localHour, i.quietHours)) {
    return { suppress: true, reason: "quiet_hours" };
  }

  if (!isCelebration(i.trigger) && i.nudgeCountToday >= i.nudgeDailyCap) {
    return { suppress: true, reason: "daily_cap" };
  }

  return { suppress: false };
}

// ── Channel delivery adapter interfaces ─────────────────────────────────────

export interface ChannelPayload {
  title?: string;
  body: string;
  deeplink?: string;
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

/** Each channel (in_app/email/agent_inbox/push/web_push) implements and registers this interface. core depends only on the interface. */
export interface ChannelAdapter {
  channel: NotificationChannel;
  canDeliver(ownerId: string): Promise<boolean>;
  /** Render the pet-voice text into a channel-specific format. */
  render(personaMsg: string): ChannelPayload;
  send(ownerId: string, payload: ChannelPayload): Promise<DeliveryResult>;
}
