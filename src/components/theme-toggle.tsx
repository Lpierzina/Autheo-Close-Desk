"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { getServerThemeChoice, getThemeChoice, setThemeChoice, subscribeToTheme, type ThemeChoice } from "@/theme/preference";
import { cx } from "./ui";

const OPTIONS = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const satisfies readonly { id: ThemeChoice; label: string; icon: typeof Sun }[];

/**
 * Light, Dark or System, from a menu in the header. It changes how the page is drawn
 * and nothing else: the session lives in SessionProvider and is not touched here.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribeToTheme, getThemeChoice, getServerThemeChoice);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = OPTIONS.find((option) => option.id === choice) ?? OPTIONS[2];
  const SelectedIcon = selected.icon;

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const closeIfOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function choose(next: ThemeChoice) {
    setThemeChoice(next);
    close();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") setOpen(false);
  }

  return (
    <div ref={wrapper} className="relative z-30">
      <button
        ref={button}
        type="button"
        aria-label={`Theme: ${selected.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="theme-toggle"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cx(
          "flex h-9 w-9 items-center justify-center rounded-md border border-line-strong text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink",
          open ? "bg-paper-2 text-ink" : "bg-surface",
        )}
      >
        <SelectedIcon aria-hidden className="h-4 w-4" />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Theme"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full mt-2 w-40 rounded-md border border-line-strong bg-surface p-1 shadow-[0_16px_40px_-16px_var(--shadow-color)]"
        >
          {OPTIONS.map(({ id, label, icon: Icon }) => {
            const checked = id === choice;
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => choose(id)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-paper-2 focus-visible:outline-offset-[-2px]",
                  checked ? "font-semibold text-ink" : "font-medium text-ink-2",
                )}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {checked ? <Check aria-hidden className="h-4 w-4 shrink-0 text-accent" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
