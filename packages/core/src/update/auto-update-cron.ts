export const AUTO_UPDATE_CRON_PRESETS = [
  {
    id: "daily-4am",
    name: "Daily at 04:00",
    description: "Install the latest release every morning.",
    cronExpression: "0 4 * * *",
  },
  {
    id: "weekly-sunday-4am",
    name: "Weekly on Sunday at 04:00",
    description: "Install the latest release during a quiet weekly window.",
    cronExpression: "0 4 * * 0",
  },
  {
    id: "monthly-first-4am",
    name: "Monthly on the 1st at 04:00",
    description: "Install the latest release once per month.",
    cronExpression: "0 4 1 * *",
  },
] as const;

export type AutoUpdateCronPresetId = (typeof AUTO_UPDATE_CRON_PRESETS)[number]["id"];
export type AutoUpdateCronExpression = (typeof AUTO_UPDATE_CRON_PRESETS)[number]["cronExpression"];
