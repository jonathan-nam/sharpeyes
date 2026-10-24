// The in-game Sharp Eyes skill icon (classic art, symmetrized, with the eye
// outline softened from black to green), shipped as the brand mark so the header
// matches the favicon (app/icon.png) exactly.
//
// The 32x32 sprite is inlined as a data URI inside an <svg><image>, not an <img>:
// self-contained, crisp at integer multiples of 32 (image-rendering:
// pixelated), and it sidesteps the next/no-img-element lint rule. Regenerate from the
// sprite if it changes, do not hand-edit the base64.
//
// The game's 1px black icon frame is cleared to transparent (flood fill inward from the
// edge, pure black only, so interior art is untouched). Baked in, it read as a black box
// edge everywhere the mark sits on a dark surface. app/icon.png is the same pixels and
// must be regenerated the same way, otherwise the header stops matching the favicon.

const SPRITE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAERklEQVR42s1Xu5XrNhC9emedbYItAcyVQCWQJZDBFgB1sGSwoQPSHZAFOIBKIEsASwDcAVGAg3GAj0iRWu9Lno1zdITP4M6dwQwwBP7jdloPtDb0K5ReLtlpR6DWZVLeCrXbNM8zAOCGBu4JMANQogUACCF2681cpX53uZ0SAa0NCcF3gq1QSfGEDoBDLcYvrevmAgBDjjoRWePdDbK4XLJTInBDsxNq5gqc+b7kKilwANoHIs1cgAGJ4GC9Uuv2mAie2hCIHmimwDZXmzHn8K53QC0UmrnYEGjFiG6uAOaPwloc4sRx9MDLowvbXOE6VZsxgM1cN1c7D3RzBeuAGCB9vo0jdzAHAC9HwZYzhupWQJUjqtvdUlV6pdWtQGUL8BA20drNetgXMUrOMc/zYXBCa0NERFprUloSEVHei82/MjL1Y8t7cTinzBMMLUlrHXT5lH85SqXkMwCj1CiGS+oDQNGFcb0fR/kBlyQfsdiz1NHakNaaRl0TEdEYvCDqrXVxziwjmWUkUYvd+Eh+jTnqmrTWzz3gmUqf/87hcs2ge5PW7GRxWQUkgN04zV+zFFcM8vnl4T1QpzgQkpOQPFnGJScmGDHB6N9alOOr/RHvfv71gQeYZ3odKqjWX6dFcwUAmJUHAODmOvz+x5+buc+Pd5SsxqKXNJcFD4wBr2oq9FL5YHAHMSAkJ70o4iUnXvJDC9XS0rk5e0tMS9q0RER0bs6klvZwT8TTi0qe2Dx8WhsSktO49IeK1+5fK4/zaxKP8o9ExqUPJFYEhOSklpZYzg+Zq6UlHtbOzZlynScl8ZfrPBHgedhz4EkW1oTk9xiQMse1GrCM/qyzwp9d3Zc+jZ3bHJod7C6p7WDx+vaaLhHnHOq23OCZ0WAZDd6KDG2b4zoM+AEAXTOtlL8BcJB9CQfAWXf4/vOSgXEOxjl4ub9i1ntlXwJwARtYRoOumVZvQdifVW8AA4xafB9A2frNUebz491ngPgNXLCk7PWvv/H58Z4yysEBHLg1Q7DeY2bVG4xaEt7JW+PPI2/9QzE1M4wym8sEABgDxtZ8mYZFk8GtXBYvsazKNvgAYG/W1wNCcuKS+7MFwCXH3Pl+JBJBHufW7Wg9zol6i28Hi3mw94KkGgoo6d/raqjApX9rXdike/NzhWfwHAs4drAbfCXHbUUUo5xzC2s5qs7f76wOh3X7ydK3DMHYeVxVq4QdA2VTEcVCYZ49CVUHto9EvtnWiteG3fXYbUV0nYpQSo2JBGMlVK0wuAZTiImQ5U/K8jvJXHJI1kIIAeduSXnUI1mPw7K8mQrs68SHCngqULL24YFqDuWeYcWiNL0Ftc6/fGZrnW9kvup/Byu+BT/WZXUzF7tyO9b8kuWQLD9c/65cxF9X1C/xW01rQ3GhO6j54xcSw5Quz9l2m1qPAXAuD3vqQ5xH928+Tns1/pKP02tVnPB/af8A0tdYIGTt/pUAAAAASUVORK5CYII=";

export function SharpEyesMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="SharpEyes"
      style={{ display: "block" }}
    >
      <image href={SPRITE} width="32" height="32" style={{ imageRendering: "pixelated" }} />
    </svg>
  );
}
