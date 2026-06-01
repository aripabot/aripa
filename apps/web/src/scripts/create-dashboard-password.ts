import { createDashboardPassword } from "@/server/dashboard-auth";

const force = Bun.argv.includes("--force");

try {
  const result = await createDashboardPassword({ force });

  console.log(
    result.replacedExisting ? "Dashboard password replaced." : "Dashboard password created.",
  );
  console.log(`Auth file: ${result.authPath}`);
  console.log("");
  console.log("Password:");
  console.log(result.password);
  console.log("");
  console.log("Store this password now. It will not be shown again.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to create dashboard password.");
  process.exitCode = 1;
}
