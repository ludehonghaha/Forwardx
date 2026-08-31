import { z } from "zod";
import {
  dualMultipathDraftSchema,
  dualPortSchema,
  type DualMultipathDraftV5,
} from "../shared/dualMultipath";

export const DUAL_MIERU_UPSTREAM = {
  repository: "enfein/mieru",
  version: "3.36.0",
  tag: "v3.36.0",
  commit: "155ebbd60f86e472586a60d7ffe58ec8f8682cb1",
  license: "GPL-3.0",
  releaseUrl: "https://github.com/enfein/mieru/releases/tag/v3.36.0",
  sourceUrl: "https://github.com/enfein/mieru/tree/155ebbd60f86e472586a60d7ffe58ec8f8682cb1",
  assets: {
    windowsAmd64: {
      name: "mieru_3.36.0_windows_amd64.zip",
      sha256: "f0136fa3bbfb1489a0a41c1ef5c3aa58ecf5b4793dc51d5a813cf7f5803017d1",
      executableSha256: "ed9dbf733321c3010f4e3431b46f65b7d1560f6b633f79a76f33219986d9e927",
    },
    linuxAmd64: {
      name: "mieru_3.36.0_linux_amd64.tar.gz",
      sha256: "b3f8b32a8b5728c01f31e33ff7a71b3b33f3fd8e1341684fcb98d5ecebb7db7a",
      executableSha256: "acbf1b6ea9d48a6f88af9397fa9f1897cdb0f5f6ec456608b55307d7f1dcbdfc",
    },
    linuxArm64: {
      name: "mieru_3.36.0_linux_arm64.tar.gz",
      sha256: "9206d3cb89b9a591ce4adc0ddfda72f1124f75a8a4e6f45bee501d89320e101e",
    },
    linuxArmv7: {
      name: "mieru_3.36.0_linux_armv7.tar.gz",
      sha256: "b42c66279ad6888695139a24fbbeedf35e9952e707925c9ecbd535fe0d351e03",
    },
    linuxRiscv64: {
      name: "mieru_3.36.0_linux_riscv64.tar.gz",
      sha256: "8f4315601444a11cfe59ce360d954cb73cd7464d30171d6ab5f0de285ac06d9f",
    },
  },
} as const;

const mieruSecretValuesSchema = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(256),
}).strict();

function secretPlaceholder(reference: string) {
  return `<secret:${reference}>`;
}

function managedBridge(draft: DualMultipathDraftV5) {
  if (draft.privateCarrierBridge.type !== "forwardx-managed-mieru-sidecar") {
    throw new Error("Windows Dual Gray 必须使用 ForwardX-managed official Mieru sidecar");
  }
  if (draft.serverTargetDiscovery.status !== "verified-read-only") {
    throw new Error("Mieru sidecar 必须先有 verified-read-only 服务端 discovery");
  }
  if (draft.serverTargetDiscovery.existingPrivateCarrier.serviceStatus !== "active") {
    throw new Error("现有 Mita private carrier 不是 active，拒绝生成 Mieru client 配置");
  }
  return draft.privateCarrierBridge;
}

export function buildDualMieruClientConfigTemplate(draftInput: unknown, socks5PortInput: unknown) {
  const draft = dualMultipathDraftSchema.parse(draftInput);
  const socks5Port = dualPortSchema.parse(socks5PortInput);
  const bridge = managedBridge(draft);
  const discovery = draft.serverTargetDiscovery;
  if (discovery.status !== "verified-read-only") throw new Error("unreachable discovery state");

  return {
    profiles: [{
      profileName: "forwardx-dual-private",
      user: {
        name: secretPlaceholder(bridge.carrier.usernameSecretRef),
        password: secretPlaceholder(bridge.carrier.passwordSecretRef),
      },
      servers: [{
        ipAddress: discovery.privateSide.sourceAddress,
        portBindings: [{
          port: discovery.existingPrivateCarrier.listener.port,
          protocol: bridge.carrier.transport,
        }],
      }],
    }],
    activeProfile: "forwardx-dual-private",
    rpcPort: 0,
    socks5Port,
    loggingLevel: "INFO" as const,
    socks5ListenLAN: false as const,
  };
}

export function materializeDualMieruClientConfig(
  draftInput: unknown,
  socks5PortInput: unknown,
  secretValuesInput: unknown,
) {
  const config = structuredClone(buildDualMieruClientConfigTemplate(draftInput, socks5PortInput));
  const secretValues = mieruSecretValuesSchema.parse(secretValuesInput);
  config.profiles[0].user.name = secretValues.username;
  config.profiles[0].user.password = secretValues.password;
  return config;
}
