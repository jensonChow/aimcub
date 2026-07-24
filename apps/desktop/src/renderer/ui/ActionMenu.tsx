import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type CloseMenu = (focusTrigger?: boolean) => void;

export interface ActionMenuState {
  closeMenu: CloseMenu;
}

export interface ActionMenuProps {
  label: string;
  title?: string;
  className?: string;
  menuClassName?: string;
  /** Replaces the default three-dot icon with custom trigger content (e.g. a model chip). */
  triggerContent?: ReactNode;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  children: (state: ActionMenuState) => ReactNode;
}

export interface ActionMenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  danger?: boolean;
}

export interface ActionMenuRadioItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "aria-checked"> {
  checked: boolean;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function MoreActionsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="5" cy="10" r="1.25" />
      <circle cx="10" cy="10" r="1.25" />
      <circle cx="15" cy="10" r="1.25" />
    </svg>
  );
}

export const ActionMenuItem = forwardRef<HTMLButtonElement, ActionMenuItemProps>(function ActionMenuItem(
  { className, danger = false, type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      role="menuitem"
      className={cx("od-action-menu-item", className)}
      data-tone={danger ? "danger" : undefined}
    />
  );
});

/** One exclusive-choice row (model pickers etc.): checked state + a trailing check glyph. */
export const ActionMenuRadioItem = forwardRef<HTMLButtonElement, ActionMenuRadioItemProps>(function ActionMenuRadioItem(
  { className, checked, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      role="menuitemradio"
      aria-checked={checked}
      className={cx("od-action-menu-item", "od-action-menu-radio", className)}
    >
      <span className="od-action-menu-radio-label">{children}</span>
      {checked ? <span className="od-action-menu-radio-check" aria-hidden="true">✓</span> : null}
    </button>
  );
});

export function ActionMenu(props: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const focusFirstItemOnOpen = useRef(false);
  const menuId = useId();

  function setMenuOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  }

  function closeMenu(focusTrigger = false) {
    focusFirstItemOnOpen.current = false;
    setMenuOpen(false);
    if (focusTrigger) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function openMenu(focusFirstItem = false) {
    focusFirstItemOnOpen.current = focusFirstItem;
    setMenuOpen(true);
  }

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }
    openMenu();
  }

  function menuItems(): HTMLButtonElement[] {
    const menu = menuRef.current;
    if (!menu) return [];
    return Array.from(menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled), [role='menuitemradio']:not(:disabled)"));
  }

  function focusMenuItem(offset: number) {
    const items = menuItems();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    items[(baseIndex + offset + items.length) % items.length]?.focus();
  }

  function focusMenuEdge(edge: "first" | "last") {
    const items = menuItems();
    const item = edge === "first" ? items[0] : items[items.length - 1];
    item?.focus();
  }

  useEffect(() => {
    if (!open) return;
    if (!focusFirstItemOnOpen.current) return;
    const frame = window.requestAnimationFrame(() => {
      menuItems()[0]?.focus();
      focusFirstItemOnOpen.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      closeMenu();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu(true);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className={cx("od-action-menu-anchor", props.className)} ref={rootRef}>
      <button
        className={cx(props.triggerContent ? "od-action-menu-chip-trigger" : "od-action-menu-trigger", props.triggerClassName)}
        ref={triggerRef}
        type="button"
        aria-label={props.label}
        title={props.title ?? props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu(true);
        }}
      >
        {props.triggerContent ?? <MoreActionsIcon />}
      </button>

      {open ? (
        <div
          className={cx("od-action-menu", props.menuClassName)}
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={props.label}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusMenuItem(1);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              focusMenuItem(-1);
              return;
            }
            if (event.key === "Home") {
              event.preventDefault();
              focusMenuEdge("first");
              return;
            }
            if (event.key === "End") {
              event.preventDefault();
              focusMenuEdge("last");
            }
          }}
        >
          {props.children({ closeMenu })}
        </div>
      ) : null}
    </div>
  );
}
