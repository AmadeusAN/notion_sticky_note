import { LeafTheme } from "./theme/leaf";

/**
 * Transparent fx window entry — hosts the active visual theme.
 * Swap `LeafTheme` for another theme module to replace the whole skin.
 */
export function FxHost() {
  return <LeafTheme />;
}
