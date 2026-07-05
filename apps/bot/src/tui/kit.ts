import {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  TextRenderable,
  createCliRenderer,
  type BoxOptions,
  type InputRenderableOptions,
  type Renderable,
  type SelectRenderableOptions,
  type TextOptions,
} from "@opentui/core";

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
