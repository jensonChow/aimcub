/**
 * A tiny in-process fake of the Supabase PostgREST builder used only by tests.
 *
 * It records the full call chain (table, op, filters, modifiers, terminal) so a test can
 * assert that {@link SupabaseGoalPetRepo} issues the right query shape, and it returns
 * canned data so the repo's mapping logic runs. No network, no credentials.
 */
import type {
  FilterBuilder,
  PostgrestResult,
  SupabaseLike,
  TableBuilder,
} from "../supabase.js";

export interface RecordedCall {
  table: string;
  op: "select" | "insert" | "upsert" | "update";
  /** insert/upsert/update payload. */
  values?: unknown;
  /** upsert options. */
  upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean };
  filters: Array<{ kind: string; column: string; value: unknown }>;
  modifiers: Array<{ kind: string; args: unknown[] }>;
  terminal: "await" | "single" | "maybeSingle";
}

/** Per-table canned responses, keyed by op. A function lets a test inspect the recorded call. */
export type Responder = (call: RecordedCall) => PostgrestResult<unknown>;

export interface FakeOptions {
  /** Resolve a response for a recorded call. Default: empty array / null. */
  respond?: Responder;
}

export class FakeSupabase implements SupabaseLike {
  readonly calls: RecordedCall[] = [];
  constructor(private readonly opts: FakeOptions = {}) {}

  from<T = Record<string, unknown>>(table: string): TableBuilder<T> {
    // Arrow functions below capture `this` lexically, so no `this` alias is needed.
    const make = (op: RecordedCall["op"]): RecordedCall => {
      const call: RecordedCall = { table, op, filters: [], modifiers: [], terminal: "await" };
      this.calls.push(call);
      return call;
    };

    const buildFilter = <R>(call: RecordedCall): FilterBuilder<R> => {
      const resolve = (terminal: RecordedCall["terminal"]) => {
        call.terminal = terminal;
        const res = this.opts.respond
          ? this.opts.respond(call)
          : ({ data: terminal === "await" ? [] : null, error: null } as PostgrestResult<unknown>);
        return res as never;
      };
      const fb: FilterBuilder<R> = {
        eq(column, value) {
          call.filters.push({ kind: "eq", column, value });
          return fb;
        },
        gte(column, value) {
          call.filters.push({ kind: "gte", column, value });
          return fb;
        },
        contains(column, value) {
          call.filters.push({ kind: "contains", column, value });
          return fb;
        },
        select() {
          // On a mutation builder, `.select()` requests the affected rows back.
          call.modifiers.push({ kind: "select", args: [] });
          return fb;
        },
        order(column, o) {
          call.modifiers.push({ kind: "order", args: [column, o] });
          return fb;
        },
        limit(count) {
          call.modifiers.push({ kind: "limit", args: [count] });
          return fb;
        },
        single() {
          return Promise.resolve(resolve("single"));
        },
        maybeSingle() {
          return Promise.resolve(resolve("maybeSingle"));
        },
        then(onfulfilled, onrejected) {
          return Promise.resolve(resolve("await")).then(onfulfilled, onrejected);
        },
      };
      return fb;
    };

    return {
      select() {
        return buildFilter(make("select"));
      },
      insert(values) {
        const call = make("insert");
        call.values = values;
        return buildFilter(call);
      },
      upsert(values, upsertOpts) {
        const call = make("upsert");
        call.values = values;
        call.upsertOpts = upsertOpts;
        return buildFilter(call);
      },
      update(values) {
        const call = make("update");
        call.values = values;
        return buildFilter(call);
      },
    };
  }
}
