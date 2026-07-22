import type { LocalAgentAdapter, LocalAgentId, LocalAgentRegistry } from "./types";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";

const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;

/**
 * ORDER IS SEMANTICS: registration order is the preference order. Detection
 * results, the CLI/desktop default agent pick and the planning gateway's
 * fallback chain all follow this list, so appending keeps today's behavior
 * while inserting changes which runtime is tried first.
 */
export const BUILT_IN_LOCAL_AGENT_ADAPTERS: readonly LocalAgentAdapter[] = [codexAdapter, claudeAdapter];

function assertValidAdapter(adapter: LocalAgentAdapter, registered: ReadonlyMap<LocalAgentId, LocalAgentAdapter>): void {
  if (!ADAPTER_ID_PATTERN.test(adapter.id)) {
    throw new Error(`Invalid local agent adapter id "${adapter.id}": use lowercase letters, digits and dashes.`);
  }
  if (registered.has(adapter.id)) {
    throw new Error(`Local agent adapter "${adapter.id}" is already registered.`);
  }
  if (!adapter.name.trim()) throw new Error(`Local agent adapter "${adapter.id}" needs a display name.`);
  if (!adapter.bin.trim()) throw new Error(`Local agent adapter "${adapter.id}" needs an executable name.`);
  if (!adapter.envVar.trim()) throw new Error(`Local agent adapter "${adapter.id}" needs an executable override env var.`);
}

export function createLocalAgentRegistry(
  adapters: readonly LocalAgentAdapter[] = BUILT_IN_LOCAL_AGENT_ADAPTERS,
): LocalAgentRegistry {
  const registered = new Map<LocalAgentId, LocalAgentAdapter>();
  const registry: LocalAgentRegistry = {
    register(adapter) {
      assertValidAdapter(adapter, registered);
      registered.set(adapter.id, adapter);
    },
    has(id) {
      return registered.has(id);
    },
    get(id) {
      return registered.get(id) ?? null;
    },
    list() {
      return [...registered.values()];
    },
    ids() {
      return [...registered.keys()];
    },
  };
  for (const adapter of adapters) registry.register(adapter);
  return registry;
}

/** The registry every consumer uses unless it injects its own. */
export const defaultLocalAgentRegistry: LocalAgentRegistry = createLocalAgentRegistry();

/** In-repo entry point for a community adapter that ships outside the built-ins. */
export function registerLocalAgentAdapter(adapter: LocalAgentAdapter): void {
  defaultLocalAgentRegistry.register(adapter);
}

export function listRegisteredLocalAgentIds(): LocalAgentId[] {
  return defaultLocalAgentRegistry.ids();
}
