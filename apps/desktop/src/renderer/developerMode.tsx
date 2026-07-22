/**
 * Developer mode — the single switch every debug-shaped surface reads.
 *
 * "Product-first, debug-second" is a design rule (docs/memory/design-system.md): with the toggle
 * OFF the cockpit shows no traces, raw payloads, or diagnostic dumps anywhere. It is a context
 * rather than a prop chain so a deeply nested card can opt into hiding itself without every
 * intermediate component having to carry the flag.
 *
 * The default is `false` on purpose, including for a component rendered with no provider: a
 * surface that forgets to be wrapped hides its debug affordance, it does not leak it.
 */
import { createContext, useContext, type ReactNode } from "react";

const DeveloperModeContext = createContext<boolean>(false);

export function DeveloperModeProvider(props: { enabled: boolean; children: ReactNode }) {
  return (
    <DeveloperModeContext.Provider value={props.enabled}>
      {props.children}
    </DeveloperModeContext.Provider>
  );
}

/** True only when the user has explicitly turned developer mode on in Settings. */
export function useDeveloperMode(): boolean {
  return useContext(DeveloperModeContext);
}
