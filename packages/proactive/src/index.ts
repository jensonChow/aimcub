/**
 * @core/proactive — 主动触达的「决策」层(纯逻辑)+ 渠道 adapter 接口。
 * 投递「通道」(APNs/SMTP/Realtime)的具体实现在各端壳 / Edge Function 注册为 adapter。
 *
 * 通知疲劳是产品翻车点:此处集中实现「打扰预算」闸门。
 * 正负反馈不对称 —— 庆祝(正反馈)不限流;nudge(催促)按【用户级】每日总量限流(跨所有宠物聚合)。
 */
import { type NotificationChannel, type NotificationTrigger } from "@core/types";

export const CELEBRATION_TRIGGERS: ReadonlySet<NotificationTrigger> = new Set<NotificationTrigger>([
  "milestone_done",
  "goal_done",
]);

export function isCelebration(trigger: NotificationTrigger): boolean {
  return CELEBRATION_TRIGGERS.has(trigger);
}

/** UTC 毫秒 + 时区偏移 → 当地小时(0..23)。 */
export function localHour(utcMillis: number, tzOffsetMinutes: number): number {
  const local = utcMillis + tzOffsetMinutes * 60_000;
  return ((Math.floor(local / 3_600_000) % 24) + 24) % 24;
}

/** 当地小时是否落在安静时段。支持跨午夜窗口(如 [22, 8])。 */
export function withinQuietHours(hour: number, window: readonly [number, number]): boolean {
  const [start, end] = window;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // 跨午夜
}

export interface SuppressInput {
  trigger: NotificationTrigger;
  channel: NotificationChannel;
  /** 当地小时(用 localHour 计算)。 */
  localHour: number;
  quietHours: readonly [number, number];
  /** 用户级当日已发 nudge 总数(跨所有宠物/目标聚合)。 */
  nudgeCountToday: number;
  /** 用户级每日 nudge 上限(默认 2)。 */
  nudgeDailyCap: number;
  /** dedup_key 是否已发过。 */
  isDuplicate: boolean;
}

export interface SuppressDecision {
  suppress: boolean;
  reason?: "duplicate" | "quiet_hours" | "daily_cap";
}

/**
 * 决定一条意图是否投递。规则:
 *  1. 去重(dedup_key 命中)→ 抑制。
 *  2. 安静时段:仅对「夜间敏感」渠道(push/email)抑制;in_app/agent_inbox 不打扰,放行。
 *  3. 非庆祝类(nudge:stale/deadline_near/scheduled)受用户级每日总量上限约束。
 *     庆祝类(milestone_done/goal_done,正反馈)不限流。
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

// ── 渠道投递 adapter 接口 ───────────────────────────────────────────────────

export interface ChannelPayload {
  title?: string;
  body: string;
  deeplink?: string;
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

/** 各渠道(in_app/email/agent_inbox/push/web_push)实现此接口并注册。core 只认接口。 */
export interface ChannelAdapter {
  channel: NotificationChannel;
  canDeliver(ownerId: string): Promise<boolean>;
  /** 把宠物口吻文本渲染成渠道特定格式。 */
  render(personaMsg: string): ChannelPayload;
  send(ownerId: string, payload: ChannelPayload): Promise<DeliveryResult>;
}
