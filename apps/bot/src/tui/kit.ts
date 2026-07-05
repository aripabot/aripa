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
  type SelectOption,
  type SelectRenderableOptions,
  type TextOptions,
} from "@opentui/core";
import type { MinimalKeyEvent } from "@aripabot/core/onboarding-wizard/types.ts";

export type CliRenderer = Awaited<ReturnType<typeof createCliRenderer>>;
export type RawInputHandler = (chunk: Buffer | string) => void;

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

export class TuiControlState {
  private focusCurrentControl: (() => void) | null = null;
  private currentInput: InputRenderable | null = null;
  private currentSelect: SelectRenderable | null = null;
  private currentSelectHandler: ((option: SelectOption) => void) | null = null;
  currentKind: "input" | "select" | null = null;

  reset(): void {
    this.focusCurrentControl = null;
    this.currentKind = null;
    this.currentInput = null;
    this.currentSelect = null;
    this.currentSelectHandler = null;
  }

  focus(): void {
    this.focusCurrentControl?.();
  }

  registerInput(input: InputRenderable): void {
    this.focusCurrentControl = () => input.focus();
    this.currentKind = "input";
    this.currentInput = input;
  }

  registerSelect(select: SelectRenderable, onSelected: (option: SelectOption) => void): void {
    this.focusCurrentControl = () => select.focus();
    this.currentKind = "select";
    this.currentSelect = select;
    this.currentSelectHandler = onSelected;
  }

  hasSelect(): boolean {
    return this.currentSelect !== null;
  }

  submitCurrent(): boolean {
    if (this.currentKind === "input" && this.currentInput) {
      this.currentInput.submit();
      return true;
    }

    if (this.currentKind === "select" && this.currentSelect && this.currentSelectHandler) {
      const selectedOption = this.currentSelect.getSelectedOption();
      if (selectedOption) {
        this.currentSelectHandler(selectedOption);
      }
      return true;
    }

    return false;
  }

  moveSelectUp(): boolean {
    if (this.currentKind !== "select" || !this.currentSelect) {
      return false;
    }

    this.currentSelect.moveUp();
    return true;
  }

  moveSelectDown(): boolean {
    if (this.currentKind !== "select" || !this.currentSelect) {
      return false;
    }

    this.currentSelect.moveDown();
    return true;
  }
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

export function clearRendererRoot(renderer: CliRenderer | null): void {
  if (!renderer) {
    return;
  }

  for (const child of renderer.root.getChildren()) {
    renderer.root.remove(child.id);
  }
}

export function closeTuiRenderer(
  renderer: CliRenderer | null,
  rawInputHandler: RawInputHandler | null,
): null {
  if (rawInputHandler) {
    renderer?.stdin.off("data", rawInputHandler);
  }

  renderer?.destroy();
  return null;
}
