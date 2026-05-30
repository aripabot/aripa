import { EmbedBuilder, type Message, type MessageReaction, type User } from "discord.js";
import type { LogLayer } from "loglayer";

const AGENT_CONFIRMATION_EMOJI = "\u2705";
const AGENT_CANCELLATION_EMOJI = "\u274c";
const AGENT_CONFIRMATION_UPDATE_INTERVAL_MS = 5_000;
const AGENT_CONFIRMATION_FINAL_UPDATE_INTERVAL_MS = 1_000;
const AGENT_CONFIRMATION_FINAL_UPDATE_THRESHOLD_MS = 5_000;
const AGENT_CONFIRMATION_INITIAL_COLOR = 0xffffff;
const AGENT_CONFIRMATION_CONFIRMED_COLOR = 0x2ecc71;
const AGENT_CONFIRMATION_TIMEOUT_COLOR = 0xf1c40f;
const AGENT_CONFIRMATION_CANCELLED_COLOR = 0xe74c3c;

export const DEFAULT_AGENT_CONFIRMATION_TIMEOUT_MS = 30_000;

export type AgentConfirmationStatus = "confirmed" | "cancelled" | "timed_out" | "failed";

export interface RequestAgentConfirmationOptions {
  message: Message;
  actionCall: string;
  timeoutMs: number;
  log: LogLayer;
  actionMetadata: Record<string, unknown>;
  lifecycle?: AgentConfirmationLifecycle;
}

type AgentConfirmationEmbedStatus = "pending" | "confirmed" | "timed_out" | "cancelled";

export interface AgentConfirmationLifecycle {
  onWaitStart?: () => void;
  onWaitEnd?: () => void;
}

export async function requestAgentConfirmation({
  message,
  actionCall,
  timeoutMs,
  log,
  actionMetadata,
  lifecycle,
}: RequestAgentConfirmationOptions): Promise<{ status: AgentConfirmationStatus }> {
  const formattedAction = formatActionCallForConfirmation(actionCall);
  const expiresAt = new Date(Date.now() + timeoutMs);
  const embed = buildAgentConfirmationEmbed({
    status: "pending",
    formattedAction,
    expiresAt,
  });

  try {
    lifecycle?.onWaitStart?.();

    const confirmationMessage = await message.reply({
      embeds: [embed],
      allowedMentions: { parse: [], repliedUser: false },
    });
    const stopUpdatingConfirmationEmbed = startAgentConfirmationEmbedUpdates({
      confirmationMessage,
      formattedAction,
      expiresAt,
      log,
      actionMetadata,
    });

    try {
      await confirmationMessage.react(AGENT_CONFIRMATION_EMOJI);
      await confirmationMessage.react(AGENT_CANCELLATION_EMOJI);

      const collected = await confirmationMessage.awaitReactions({
        filter: (reaction: MessageReaction, user: User) =>
          user.id === message.author.id &&
          (reaction.emoji.name === AGENT_CONFIRMATION_EMOJI ||
            reaction.emoji.name === AGENT_CANCELLATION_EMOJI),
        max: 1,
        time: timeoutMs,
      });

      const reaction = collected.first();

      if (reaction?.emoji.name === AGENT_CONFIRMATION_EMOJI) {
        stopUpdatingConfirmationEmbed();
        await editAgentConfirmationEmbed({
          confirmationMessage,
          formattedAction,
          expiresAt,
          status: "confirmed",
          log,
          actionMetadata,
        });
        return { status: "confirmed" };
      }

      if (reaction?.emoji.name === AGENT_CANCELLATION_EMOJI) {
        stopUpdatingConfirmationEmbed();
        await editAgentConfirmationEmbed({
          confirmationMessage,
          formattedAction,
          expiresAt,
          status: "cancelled",
          log,
          actionMetadata,
        });
        return { status: "cancelled" };
      }

      stopUpdatingConfirmationEmbed();
      await editAgentConfirmationEmbed({
        confirmationMessage,
        formattedAction,
        expiresAt,
        status: "timed_out",
        log,
        actionMetadata,
      });
      return { status: "timed_out" };
    } finally {
      stopUpdatingConfirmationEmbed();
    }
  } catch (error) {
    log
      .withError(error)
      .withMetadata(actionMetadata)
      .warn("Failed while waiting for agent action confirmation.");

    return { status: "failed" };
  } finally {
    lifecycle?.onWaitEnd?.();
  }
}

function buildAgentConfirmationEmbed(options: {
  status: AgentConfirmationEmbedStatus;
  formattedAction: string;
  expiresAt: Date;
}): EmbedBuilder {
  const statusConfig = getAgentConfirmationStatusConfig(options.status);

  return new EmbedBuilder()
    .setTitle(statusConfig.title)
    .setDescription(statusConfig.description(options.formattedAction))
    .setColor(statusConfig.color)
    .setFooter({ text: `Expires ${formatRelativeDuration(options.expiresAt)}` });
}

function getAgentConfirmationStatusConfig(status: AgentConfirmationEmbedStatus): {
  title: string;
  color: number;
  description: (formattedAction: string) => string;
} {
  switch (status) {
    case "confirmed":
      return {
        title: "Action Confirmed",
        color: AGENT_CONFIRMATION_CONFIRMED_COLOR,
        description: (formattedAction) => `Confirmed. I will run ${formattedAction}.`,
      };
    case "timed_out":
      return {
        title: "Confirmation Timed Out",
        color: AGENT_CONFIRMATION_TIMEOUT_COLOR,
        description: (formattedAction) => `Timed out. I did not run ${formattedAction}.`,
      };
    case "cancelled":
      return {
        title: "Action Cancelled",
        color: AGENT_CONFIRMATION_CANCELLED_COLOR,
        description: (formattedAction) => `Cancelled. I did not run ${formattedAction}.`,
      };
    case "pending":
      return {
        title: "Confirm Action",
        color: AGENT_CONFIRMATION_INITIAL_COLOR,
        description: (formattedAction) =>
          `I will run ${formattedAction}.\nReact with ${AGENT_CONFIRMATION_EMOJI} to confirm or ${AGENT_CANCELLATION_EMOJI} to cancel.`,
      };
  }
}

async function editAgentConfirmationEmbed(options: {
  confirmationMessage: Message;
  formattedAction: string;
  expiresAt: Date;
  status: AgentConfirmationEmbedStatus;
  log: LogLayer;
  actionMetadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await options.confirmationMessage.edit({
      embeds: [
        buildAgentConfirmationEmbed({
          status: options.status,
          formattedAction: options.formattedAction,
          expiresAt: options.expiresAt,
        }),
      ],
    });
  } catch (error) {
    options.log
      .withError(error)
      .withMetadata({ ...options.actionMetadata, confirmationStatus: options.status })
      .warn("Failed to edit agent action confirmation embed.");
  }
}

function startAgentConfirmationEmbedUpdates(options: {
  confirmationMessage: Message;
  formattedAction: string;
  expiresAt: Date;
  log: LogLayer;
  actionMetadata: Record<string, unknown>;
}): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const updateAndScheduleNext = () => {
    if (stopped) {
      return;
    }

    void editAgentConfirmationEmbed({
      confirmationMessage: options.confirmationMessage,
      formattedAction: options.formattedAction,
      expiresAt: options.expiresAt,
      status: "pending",
      log: options.log,
      actionMetadata: options.actionMetadata,
    });

    scheduleNextUpdate();
  };

  const scheduleNextUpdate = () => {
    if (stopped) {
      return;
    }

    const remainingMs = options.expiresAt.getTime() - Date.now();

    if (remainingMs <= 0) {
      return;
    }

    const delayMs =
      remainingMs <= AGENT_CONFIRMATION_FINAL_UPDATE_THRESHOLD_MS
        ? AGENT_CONFIRMATION_FINAL_UPDATE_INTERVAL_MS
        : Math.min(
            AGENT_CONFIRMATION_UPDATE_INTERVAL_MS,
            remainingMs - AGENT_CONFIRMATION_FINAL_UPDATE_THRESHOLD_MS,
          );

    timeout = setTimeout(updateAndScheduleNext, delayMs);
  };

  scheduleNextUpdate();

  return () => {
    stopped = true;

    if (timeout) {
      clearTimeout(timeout);
    }
  };
}

function formatRelativeDuration(date: Date, now = new Date()): string {
  const remainingSeconds = Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 1000));

  if (remainingSeconds === 0) {
    return "now";
  }

  if (remainingSeconds === 1) {
    return "in 1 second";
  }

  if (remainingSeconds < 60) {
    return `in ${remainingSeconds} seconds`;
  }

  const remainingMinutes = Math.ceil(remainingSeconds / 60);

  if (remainingMinutes === 1) {
    return "in 1 minute";
  }

  return `in ${remainingMinutes} minutes`;
}

function formatActionCallForConfirmation(actionCall: string): string {
  if (actionCall.length <= 900) {
    return actionCall;
  }

  return `${actionCall.slice(0, 897)}...`;
}
