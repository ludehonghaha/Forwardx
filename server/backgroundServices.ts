import { startScheduler } from "./scheduler";
import { startTelegramBot } from "./telegramBot";
import { isDevPanelMode } from "./devPanel";
import { startUserTrafficDailyHistory } from "./userTrafficHistory";
import { reconcileManagedProtocolTrafficBridges } from "./protocolTrafficBridge";

let backgroundServicesStarted = false;

export function startBackgroundServices() {
  if (backgroundServicesStarted) return false;
  if (isDevPanelMode()) {
    backgroundServicesStarted = true;
    console.info("[DevPanel] Background scheduler and Telegram bot are disabled in local development panel mode");
    return true;
  }
  backgroundServicesStarted = true;
  startScheduler();
  startUserTrafficDailyHistory();
  reconcileManagedProtocolTrafficBridges()
    .then((result) => {
      if (result.changed > 0) {
        console.info(`[ProtocolTraffic] Reconciled managed endpoint bridges changed=${result.changed} scanned=${result.scanned}`);
      }
      for (const failure of result.failures) {
        console.warn(`[ProtocolTraffic] Reconcile skipped endpoint=${failure.endpointId}: ${failure.message}`);
      }
    })
    .catch((error) => {
      console.warn(`[ProtocolTraffic] Startup reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  startTelegramBot().catch((error) => {
    console.warn(`[Telegram] Failed to start bot: ${error instanceof Error ? error.message : String(error)}`);
  });
  return true;
}
