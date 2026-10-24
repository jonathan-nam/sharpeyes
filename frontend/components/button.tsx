import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

// The app's one button. `primary` is the act a row or dialog is for, `secondary` everything beside it.
// The classes underneath are the ones globals.css has always styled, so a layout class passed in
// (`add-plus`, `ledger-add`) still lands on the same element.

export type ButtonVariant = "primary" | "secondary";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "party-save",
  secondary: "party-cancel",
};

const classes = (variant: ButtonVariant, extra?: string) =>
  extra ? `${VARIANT[variant]} ${extra}` : VARIANT[variant];

export function Button({
  variant,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant: ButtonVariant }) {
  return <button type={type} className={classes(variant, className)} {...rest} />;
}

/** A link that looks like a [Button], for an act that goes somewhere rather than writes. */
export function ButtonLink({
  variant,
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant: ButtonVariant }) {
  return <Link className={classes(variant, className)} {...rest} />;
}
