"use client";

import { DashboardOnboardingLayout } from "@/components/dashboard/dashboard-onboarding-layout";
import { DashboardOnboardingStepContent } from "@/components/dashboard/dashboard-onboarding-step-content";
import { useDashboardOnboarding } from "@/components/dashboard/use-dashboard-onboarding";
import type { CompleteOnboardingResponse, DashboardStatus } from "@/lib/api-types";

export function DashboardOnboardingScreen({
  initialStatus,
  onComplete,
  onSignOut,
}: {
  initialStatus: DashboardStatus;
  onComplete: (result: CompleteOnboardingResponse) => void;
  onSignOut: () => void;
}) {
  const onboarding = useDashboardOnboarding({ initialStatus, onComplete });

  return (
    <DashboardOnboardingLayout
      activeProgressIndex={onboarding.activeProgressIndex}
      canGoBack={onboarding.canGoBack}
      configPath={initialStatus.configPath}
      description={onboarding.description}
      error={onboarding.error}
      loadingOptions={onboarding.loadingOptions}
      message={onboarding.message}
      onBack={onboarding.onBack}
      onContinue={onboarding.onContinue}
      onSignOut={onSignOut}
      primaryDisabled={onboarding.primaryDisabled}
      primaryLabel={onboarding.primaryLabel}
      showPrimarySaveIcon={onboarding.showPrimarySaveIcon}
      stepContent={<DashboardOnboardingStepContent {...onboarding.stepContentProps} />}
      title={onboarding.title}
    />
  );
}
