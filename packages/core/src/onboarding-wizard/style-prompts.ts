import { readdir } from "node:fs/promises";

export async function loadStylePrompts(selectedStylePrompt: string): Promise<string[]> {
  const stylesDirectory = new URL("../agent/prompts/styles", import.meta.url);
  const entries = await readdir(stylesDirectory);
  const stylePrompts = entries
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.slice(0, -".md".length))
    .sort((a, b) => a.localeCompare(b));

  const ordered = ["match", ...stylePrompts.filter((stylePrompt) => stylePrompt !== "match")];
  if (!ordered.includes(selectedStylePrompt)) {
    ordered.push(selectedStylePrompt);
  }

  return ordered;
}

export function stylePromptDescription(stylePrompt: string): string {
  switch (stylePrompt) {
    case "match":
      return "Adapt to the conversation's tone.";
    case "friendly":
      return "Warm and approachable.";
    case "concise":
      return "Short, direct responses.";
    case "formal":
      return "Polished and restrained.";
    case "playful":
      return "Light, casual energy.";
    case "original":
      return "The base Aripa personality.";
    default:
      return "Custom prompt style.";
  }
}
