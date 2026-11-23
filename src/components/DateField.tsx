"use client";

import { useRef } from "react";
import { formatDisplayDate } from "@/lib/format";

/**
 * A date field that shows the date as 23-Nov-2026 and opens the calendar of the browser.
 * The value is YYYY-MM-DD. The browser shows its own format (for example 11/23/2026) in a normal
 * date box, so this field shows the text itself and keeps the real date box out of sight.
 */
export function DateField({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  label: string;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const native = useRef<HTMLInputElement>(null);

  function open() {
    const input = native.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus(); // an old browser: the person can still type in the box
      input.click();
    }
  }

  return (
    <span className="datefield">
      <button
        type="button"
        className={`datefield-button${className ? ` ${className}` : ""}`}
        onClick={open}
        disabled={disabled}
        aria-label={`${label}: ${value === "" ? "no date" : formatDisplayDate(value)}. Press to change.`}
      >
        <span>{value === "" ? "Choose date" : formatDisplayDate(value)}</span>
        <span aria-hidden="true" className="datefield-icon">▾</span>
      </button>
      <input
        ref={native}
        type="date"
        className="datefield-native"
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}
