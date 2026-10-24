"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { CopyAmount } from "@/components/copy-amount";
import { failureText } from "@/lib/api";
import { formatMesos } from "@/lib/drop-split";
import type { SettlementListing } from "@/types/settlement-listing";

// The payee's auction house listing on a Settlement card: posted from a closing act, and drawn beside
// the payer's act that pays it. Which listing is good for which figure is lib/settlement-listings.ts.

/** What a card needs to show and post listings. Each write answers once the list is read back. */
export type ListingKit = {
  listings: SettlementListing[];
  busy: boolean;
  post: (personId: string, amount: number, image: Blob) => Promise<void>;
  remove: (id: string) => Promise<void>;
  image: (id: string) => Promise<Blob>;
};

/** What a posted listing is called, on the card and in its pop-up. */
const LABEL = "Auction House Screenshot";

/** The backend's own bar. See SettlementListingRoutes.kt. */
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

// A listing is never edited, only replaced under a new id, so one fetch per id serves every mount.
const objectUrls = new Map<string, Promise<string>>();

function useListingUrl(listing: SettlementListing, kit: ListingKit): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let pending = objectUrls.get(listing.id);
    if (!pending) {
      pending = kit.image(listing.id).then((blob) => URL.createObjectURL(blob));
      // A failed fetch is not cached, so the next mount asks again.
      pending.catch(() => objectUrls.delete(listing.id));
      objectUrls.set(listing.id, pending);
    }
    pending.then((value) => live && setUrl(value)).catch(() => {});
    return () => {
      live = false;
    };
  }, [listing.id, kit]);
  return url;
}

/**
 * The listing's thumbnail, opening it whole. With `onReplace` and `onRemove`, the poster can post
 * another or take it back from there.
 */
export function ListingThumb({
  listing,
  kit,
  onReplace,
  onRemove,
}: {
  listing: SettlementListing;
  kit: ListingKit;
  onReplace?: (image: Blob) => Promise<void>;
  onRemove?: () => void;
}) {
  const url = useListingUrl(listing, kit);
  const [open, setOpen] = useState<"view" | "replace" | null>(null);
  return (
    <span className="ledger-listing">
      <button
        type="button"
        className="ledger-listing-open"
        onClick={() => setOpen("view")}
        aria-label={`View listing for ${formatMesos(listing.amount, true)}`}
      >
        {url ? (
          <img className="ledger-listing-thumb" src={url} alt="" />
        ) : (
          <span className="ledger-listing-thumb" aria-hidden="true" />
        )}
        <span className="ledger-listing-label">{LABEL}</span>
      </button>
      {open === "view" && url && (
        <ListingView
          url={url}
          onReplace={onReplace && (() => setOpen("replace"))}
          onRemove={onRemove}
          busy={kit.busy}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "replace" && onReplace && (
        <PostListingDialog
          amount={listing.amount}
          onPost={onReplace}
          onClose={() => setOpen(null)}
        />
      )}
    </span>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function ListingView({
  url,
  onReplace,
  onRemove,
  busy,
  onClose,
}: {
  url: string;
  onReplace?: () => void;
  onRemove?: () => void;
  busy: boolean;
  onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <div className="invite-backdrop listing-backdrop" role="presentation" onClick={onClose}>
      <div
        className="invite-dialog listing-dialog is-view"
        role="dialog"
        aria-modal="true"
        aria-label={LABEL}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="invite-title">{LABEL}</h2>
        <img className="listing-full" src={url} alt={LABEL} />
        <div className="invite-actions">
          {onReplace && (
            <Button variant="primary" onClick={onReplace}>
              Replace Screenshot
            </Button>
          )}
          {onRemove && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              Remove Screenshot
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The first image on a clipboard or in a drop, if there is one. */
function imageIn(items: DataTransferItemList | null | undefined): File | null {
  for (const item of Array.from(items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/** Choose, paste or drop a screenshot, see it, and post it for [amount]. */
export function PostListingDialog({
  amount,
  onPost,
  onClose,
}: {
  amount: number;
  onPost: (image: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  useEscape(onClose);

  const take = useCallback((next: File | null) => {
    if (!next) return;
    if (!TYPES.includes(next.type)) {
      setError("Couldn't read that image. Post a PNG, JPEG or WebP.");
      return;
    }
    if (next.size > MAX_BYTES) {
      setError("Screenshot is too large. Crop it and try again.");
      return;
    }
    setError(null);
    setFile(next);
  }, []);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // A screenshot is usually on the clipboard, so a paste anywhere while this is open takes it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = imageIn(e.clipboardData?.items);
      if (pasted) {
        e.preventDefault();
        take(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [take]);

  const post = async () => {
    if (!file) return;
    setPosting(true);
    setError(null);
    try {
      await onPost(file);
      onClose();
    } catch (e) {
      setError(failureText(e, "That didn't post. Try again."));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="invite-backdrop listing-backdrop" role="presentation" onClick={onClose}>
      <div
        className="invite-dialog listing-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Post Listing"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="invite-title">
          {"Post Listing for "}
          <CopyAmount value={amount} display={formatMesos(amount, true)} />
        </h2>
        <label
          className="listing-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            take(imageIn(e.dataTransfer.items) ?? e.dataTransfer.files[0] ?? null);
          }}
        >
          {preview ? (
            <img className="listing-full" src={preview} alt="Screenshot to post" />
          ) : (
            <span className="party-cancel">Choose or Paste Screenshot</span>
          )}
          <input
            className="visually-hidden"
            type="file"
            accept={TYPES.join(",")}
            onChange={(e) => take(e.target.files?.[0] ?? null)}
          />
        </label>
        {error && <span className="split-error">{error}</span>}
        <div className="invite-actions">
          <Button variant="primary" disabled={!file || posting} onClick={() => void post()}>
            Post
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
