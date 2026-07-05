import {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  SelectRenderableEvents,
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

export async function createTuiRenderer({
  backgroundColor,
  onKeyPress,
}: {
  backgroundColor: string;
  onKeyPress: (key: MinimalKeyEvent) => boolean;
}): Promise<CliRenderer> {
  return createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    backgroundColor,
    openConsoleOnError: false,
    prependInputHandlers: [
      (sequence) => {
        const key = parseMinimalKey(sequence);
        return key ? onKeyPress(key) : false;
      },
    ],
  });
}

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

export function createSelectControlFactory({
  Select,
  controls,
  colors,
}: {
  Select: (options: SelectRenderableOptions) => SelectRenderable;
  controls: TuiControlState;
  colors: {
    input: string;
    text: string;
    accentMuted: string;
    accent: string;
    muted: string;
  };
}): (
  options: SelectOption[],
  onSelected: (option: SelectOption) => void,
  height: number,
  selectedIndex?: number,
) => SelectRenderable {
  return (options, onSelected, height, selectedIndex = 0) => {
    const select = Select({
      width: "100%",
      height,
      options,
      selectedIndex: Math.max(0, selectedIndex),
      backgroundColor: colors.input,
      textColor: colors.text,
      focusedBackgroundColor: colors.input,
      focusedTextColor: colors.text,
      selectedBackgroundColor: colors.accentMuted,
      selectedTextColor: colors.accent,
      descriptionColor: colors.muted,
      selectedDescriptionColor: colors.text,
      showScrollIndicator: true,
      showDescription: true,
      wrapSelection: true,
    });

    select.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) =>
      onSelected(option),
    );
    controls.registerSelect(select, onSelected);
    return select;
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
