// Parses an experience/project `detail` string into display bullets.
// Data looks like "• a  \n\n• b": split on newlines, trim, strip one leading
// bullet marker (•, -, *, –) plus whitespace, drop empty lines. Output is
// plain text meant for text expressions, never set:html.
export function parseDetailBullets(detail: string | null | undefined): string[] {
  return (detail ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[•\-*–]\s*/, '').trim())
    .filter((line) => line.length > 0);
}
