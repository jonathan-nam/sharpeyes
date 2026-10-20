"use client";

import { Fragment } from "react";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { spriteUrl } from "@/lib/api";

/** The steps a fresh account takes. An invited one has accepting its link in front of these. */
export const SETUP_STEPS = ["World", "Characters", "Parties"] as const;
export const INVITED_STEPS = ["Invite", ...SETUP_STEPS] as const;

/**
 * "Welcome" over the row of steps, on /join and /welcome alike, so the two ways in read as one flow
 * that meets at World. "Welcome, IGN" beside the main's sprite once one is starred.
 *
 * Steps before `locked` are done and cannot be gone back to (an accepted link is spent). Any other
 * step reached is a click away; the ones past it wait.
 */
export function WelcomeHeader({
  main,
  steps,
  step,
  reached,
  locked = 0,
  onStep,
}: {
  main: { name: string; sprite: string | null } | null;
  steps: readonly string[];
  step: number;
  reached: number;
  locked?: number;
  onStep?: (step: number) => void;
}) {
  return (
    <div className="welcome-head">
      {/* The site header is hidden while an account is set up (see isSetupPath), so the brand is
          said here instead, as the first thing a new account sees. 64px is twice the mark's own
          32px grid, so the pixel art scales whole. */}
      <div className="welcome-brand">
        <SharpEyesMark size={64} />
        <span className="welcome-brand-name">SharpEyes</span>
      </div>
      {main ? (
        <div className="welcome-hero">
          <h1 className="page-title">Welcome, {main.name}</h1>
          {main.sprite && <img className="hero-sprite" src={spriteUrl(main.sprite)} alt="" />}
        </div>
      ) : (
        <h1 className="page-title">Welcome</h1>
      )}
      <nav aria-label="Setup progress">
        <ol className="welcome-steps">
          {steps.map((label, i) => {
            const state = i === step ? "is-current" : i <= reached ? "is-done" : "is-todo";
            return (
              <Fragment key={label}>
                {i > 0 && (
                  <li
                    className={
                      i <= reached ? "welcome-step-arrow is-reached" : "welcome-step-arrow"
                    }
                    aria-hidden="true"
                  >
                    {"→"}
                  </li>
                )}
                <li className={`welcome-step ${state}`}>
                  <button
                    type="button"
                    className="welcome-step-link"
                    aria-current={i === step ? "step" : undefined}
                    disabled={i > reached || i < locked || !onStep}
                    onClick={() => onStep?.(i)}
                  >
                    {state === "is-done" ? `✓ ${label}` : label}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
