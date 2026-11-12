/**
 * HTML escaping for the marketing pages.
 *
 * These pages are built by composing strings rather than React elements, so escaping is
 * a call someone has to remember rather than something the renderer does for them. That
 * is a real difference from the rest of this app — `components/ui/markdown.tsx` is
 * structurally safe because it returns React nodes and never a string — and it is the
 * reason this lives in one place with one name.
 *
 * Every value interpolated into marketing HTML goes through this, including values that
 * look like they could not possibly contain markup. The content here is static today,
 * but the compliance pack is read from a package and docs are read from disk, so "it is
 * all trusted" is a property of the current wiring and not of the code.
 */
export const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
