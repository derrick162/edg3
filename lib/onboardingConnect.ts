// R24 — pure logic for the onboarding "Connect your tools" step. Kept out of the React
// component so the gating + pre-check mapping is unit-testable without a DOM.

export interface ConnectStepState {
  calendarConnected: boolean;
  calendarEmail: string | null;
  whoopConnected: boolean;
}

// Map the /api/auth/accounts + /api/whoop/status responses to the step's connection state.
export function deriveConnectState(
  accounts: { calendar?: { connected?: boolean; email?: string | null } } | null | undefined,
  whoopStatus: { connected?: boolean } | null | undefined,
): ConnectStepState {
  return {
    calendarConnected: !!accounts?.calendar?.connected,
    calendarEmail: accounts?.calendar?.email ?? null,
    whoopConnected: !!whoopStatus?.connected,
  };
}

// The Continue gate: Google Calendar is required; Whoop is optional and never blocks.
export function canContinue(calendarConnected: boolean): boolean {
  return calendarConnected;
}
