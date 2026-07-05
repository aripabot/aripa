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

export function createWizardShell({
  backgroundColor,
  exitOutput,
  onFinish,
  rendererName,
  onKeyPress,
}: {
  backgroundColor: string;
  exitOutput: () => string | null;
  onFinish?: () => void;
  rendererName: string;
  onKeyPress: (key: MinimalKeyEvent) => boolean;
}): ReturnType<typeof createRenderableFactories> & {
  controls: TuiControlState;
  destroy: () => void;
  finish: (output: string) => void;
  handleControlKey: (key: MinimalKeyEvent, options?: { onBack?: () => boolean }) => boolean;
  isFinished: () => boolean;
  renderFrame: (...children: Renderable[]) => void;
  requireRenderer: () => CliRenderer;
  start: (render: () => void) => Promise<void>;
} {
  let renderer: CliRenderer | null = null;
  let rawInputHandler: RawInputHandler | null = null;
  let finished = false;
  const controls = new TuiControlState();

  function requireRenderer(): CliRenderer {
    if (!renderer) {
      throw new Error(`${rendererName} renderer has not been created.`);
    }

    return renderer;
  }

  const factories = createRenderableFactories(requireRenderer);

  function handleRawInput(chunk: Buffer | string): void {
    const sequence = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    const isDirectExitSequence = sequence === "\u0003" || sequence === "\u001B";
    const key = isDirectExitSequence ? null : parseMinimalKey(sequence);
    if (!isDirectExitSequence && (!key || !isExitKey(key))) {
      return;
    }

    const output = exitOutput();
    if (output !== null) {
      shell.finish(output);
    }
  }

  const shell = {
    ...factories,
    controls,
    destroy() {
      rawInputHandler = closeTuiRenderer(renderer, rawInputHandler);
      renderer = null;
    },
    finish(output: string): void {
      if (finished) {
        return;
      }

      finished = true;
      onFinish?.();
      rawInputHandler = closeTuiRenderer(renderer, rawInputHandler);
      renderer = null;
      console.log(output);
    },
    handleControlKey(key: MinimalKeyEvent, options: { onBack?: () => boolean } = {}): boolean {
      if (isExitKey(key)) {
        const output = exitOutput();
        if (output !== null) {
          shell.finish(output);
        }
        return true;
      }

      if (key.name === "return" || key.name === "linefeed") {
        return controls.submitCurrent();
      }

      if (key.name === "up") {
        return controls.moveSelectUp();
      }

      if (key.name === "down") {
        return controls.moveSelectDown();
      }

      if (key.name === "left" && controls.currentKind === "select") {
        return options.onBack?.() ?? false;
      }

      return false;
    },
    isFinished() {
      return finished;
    },
    renderFrame(...children: Renderable[]): void {
      if (!renderer || finished) {
        return;
      }

      clearRendererRoot(renderer);
      controls.reset();

      renderer.root.add(
        factories.Box(
          {
            width: "100%",
            height: "100%",
            backgroundColor,
            paddingX: 2,
            paddingY: 1,
            flexDirection: "column",
            gap: 1,
          },
          ...children,
        ),
      );

      controls.focus();
      renderer.requestRender();
    },
    requireRenderer,
    async start(render: () => void): Promise<void> {
      renderer = await createTuiRenderer({
        backgroundColor,
        onKeyPress,
      });

      rawInputHandler = handleRawInput;
      renderer.stdin.prependListener("data", rawInputHandler);
      render();
    },
  };

  return shell;
}
