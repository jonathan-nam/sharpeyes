/** A linked account's Discord avatar, in a circle. Draws nothing for an account without one. */
export function DiscordAvatar({
  image,
  size = "md",
}: {
  image: string | null | undefined;
  /** md is the People row's 28px; sm sits inline with a line of text. */
  size?: "sm" | "md";
}) {
  if (!image) return null;
  return (
    <span className={`discord-avatar is-${size}`} aria-hidden="true">
      <img src={image} alt="" />
    </span>
  );
}
