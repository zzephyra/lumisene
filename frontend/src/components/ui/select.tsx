import { Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

export type SelectOption = {
  value: string;
  label: string;
};

export function Select({
  id,
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "请选择",
  label,
  className,
  side = "bottom",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
  side?: "top" | "bottom";
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuWidth, setMenuWidth] = useState<number>();
  const selected = options.find((option) => option.value === value);
  const unavailable = disabled || options.length === 0;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && triggerRef.current) {
          setMenuWidth(triggerRef.current.offsetWidth);
        }
      }}
    >
      <DropdownMenuTrigger asChild disabled={unavailable}>
        <button
          ref={triggerRef}
          className={cn(
            "flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 text-left text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-pointer disabled:opacity-60",
            className,
          )}
          aria-label={label}
          disabled={unavailable}
          id={id}
          type="button"
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown aria-hidden className="shrink-0 text-muted" size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="z-[80] max-h-72 w-max max-w-80 overflow-y-auto p-1.5"
        side={side}
        style={menuWidth ? { minWidth: menuWidth, zIndex: 80 } : { zIndex: 80 }}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <DropdownMenuItem
              className="justify-between"
              key={option.value}
              onSelect={() => onChange(option.value)}
            >
              <span className="truncate">{option.label}</span>
              {active ? (
                <Check aria-hidden className="shrink-0 text-primary" size={16} />
              ) : (
                <span aria-hidden className="w-4 shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
