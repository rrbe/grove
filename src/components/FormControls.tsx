import { forwardRef, type ComponentPropsWithoutRef } from "react";

/** Input with spellCheck/autoCorrect/autoCapitalize disabled by default. */
export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input">>(
  (props, ref) => (
    <input
      ref={ref}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      {...props}
    />
  ),
);
Input.displayName = "Input";

/** Textarea with spellCheck/autoCorrect/autoCapitalize disabled by default. */
export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(
  (props, ref) => (
    <textarea
      ref={ref}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

/** Select — thin wrapper for consistency; no spellCheck needed. */
export const Select = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<"select">>(
  (props, ref) => <select ref={ref} {...props} />,
);
Select.displayName = "Select";
