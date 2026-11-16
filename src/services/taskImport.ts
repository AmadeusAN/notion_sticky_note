/** Keep task order and intentional duplicates; discard only blank segments. */
export function splitTaskText(text: string): string[] {
  return text.split(/[;；]+/u).map((title) => title.trim()).filter(Boolean);
}
