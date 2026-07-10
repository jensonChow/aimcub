export type ConfirmationFlowOutcome<Detail, Progress> =
  | { status: "confirmation_failed"; error: unknown }
  | { status: "confirmed"; detail: Detail; progress: Progress }
  | { status: "refresh_failed"; detail: Detail; error: unknown };

export async function confirmMilestoneAndRefresh<Detail, Progress>(
  confirm: () => Promise<Detail>,
  refresh: () => Promise<Progress>,
): Promise<ConfirmationFlowOutcome<Detail, Progress>> {
  let detail: Detail;
  try {
    detail = await confirm();
  } catch (error) {
    return { status: "confirmation_failed", error };
  }

  try {
    return { status: "confirmed", detail, progress: await refresh() };
  } catch (error) {
    return { status: "refresh_failed", detail, error };
  }
}
