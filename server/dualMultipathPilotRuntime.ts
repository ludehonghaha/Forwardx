import { z } from "zod";
import {
  dualPrivateCarrierClientEndpointDiscoverySchema,
  dualServerTargetDiscoverySnapshotSchema,
} from "../shared/dualMultipath";

export const DUAL_PILOT_MODE = "experimental-self-use-only" as const;
export const DUAL_PILOT_MITA_MTU = 1400 as const;

const dualPilotMieruSecretValuesSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(256),
}).strict();

/**
 * Materialize the dedicated Mita server used only by Dual Pilot.
 *
 * The production NoBrand Mita user deliberately keeps loopback access denied.
 * A Pilot carrier therefore needs its own listener/user so leg0 can reach the
 * loopback-only multipath listener without mutating production Mita state.
 */
export function buildDualPilotMitaServerConfig(
  serverTargetInput: unknown,
  privateCarrierClientEndpointInput: unknown,
  secretValuesInput: unknown,
) {
  const serverTarget = dualServerTargetDiscoverySnapshotSchema.parse(serverTargetInput);
  const privateCarrierClientEndpoint = dualPrivateCarrierClientEndpointDiscoverySchema.parse(
    privateCarrierClientEndpointInput,
  );
  const secretValues = dualPilotMieruSecretValuesSchema.parse(secretValuesInput);

  if (serverTarget.status !== "verified-read-only") {
    throw new Error("Dual Pilot Mita 必须先有 verified-read-only 服务端 discovery");
  }
  if (serverTarget.existingPrivateCarrier.serviceStatus !== "active") {
    throw new Error("现有生产 Mita 不是 active，拒绝启动 Dual Pilot");
  }
  if (serverTarget.existingPrivateCarrier.lifecycle !== "preserve") {
    throw new Error("Dual Pilot 只允许 preserve 现有生产 Mita");
  }
  if (privateCarrierClientEndpoint.status !== "verified-read-only") {
    throw new Error("Dual Pilot Mita 缺少 verified client-visible private carrier endpoint");
  }

  const pilotPort = privateCarrierClientEndpoint.endpoint.port;
  const productionPort = serverTarget.existingPrivateCarrier.listener.port;
  if (pilotPort < 1025) {
    throw new Error("Dual Pilot Mita listener 必须使用 1025-65535 端口");
  }
  if (pilotPort === productionPort) {
    throw new Error(`Dual Pilot Mita 禁止复用生产 listener ${productionPort}`);
  }

  return {
    portBindings: [{
      port: pilotPort,
      protocol: "TCP" as const,
    }],
    users: [{
      name: secretValues.username,
      password: secretValues.password,
      allowLoopbackIP: true as const,
    }],
    loggingLevel: "INFO" as const,
    mtu: DUAL_PILOT_MITA_MTU,
  };
}
