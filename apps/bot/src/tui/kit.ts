import {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  TextRenderable,
  createCliRenderer,
  parseKeypress,
  type BoxOptions,
  type InputRenderableOptions,
  type Renderable,
  type SelectRenderableOptions,
  type TextOptions,
} from "@opentui/core";
import type { MinimalKeyEvent } from "@aripabot/core/onboarding-wizard/types.ts";

export type CliRenderer = Awaited<ReturnType<typeof createCliRenderer>>;

export function createRenderableFactories(requireRenderer: () => CliRenderer): {
  Box: (options: BoxOptions, ...children: Renderable[]) => BoxRenderable;
  Text: (options: TextOptions) => TextRenderable;
  Input: (options: InputRenderableOptions) => InputRenderable;
  Select: (options: SelectRenderableOptions) => SelectRenderable;
} {
  return {
    Box(options, ...children) {
      const box = new BoxRenderable(requireRenderer(), options);
      for (const child of children) {
        box.add(child);
      }

      return box;
    },
    Text(options) {
      return new TextRenderable(requireRenderer(), options);
    },
    Input(options) {
      return new InputRenderable(requireRenderer(), options);
    },
    Select(options) {
      return new SelectRenderable(requireRenderer(), options);
    },
  };
}

export function parseMinimalKey(sequence: string): MinimalKeyEvent | null {
  const key = parseKeypress(sequence);
  if (key?.name) {
    return key;
  }

  const kittyKey = parseKeypress(sequence, { useKittyKeyboard: true });
  return kittyKey?.name ? kittyKey : null;
}

export function isExitKey(key: MinimalKeyEvent): boolean {
  return (
    key.name === "escape" ||
    (key.ctrl && (key.name === "c" || key.name === "C" || key.name === "\u0003"))
  );
}
