import { reserveAvailableHostPort, type HostPortReservation } from "./portReservations";
import type { ForwardRuleProtocol } from "../shared/forwardTypes";

export type ManagedProtocolPortAllocatorOptions = {
  hostId: number;
  protocol: ForwardRuleProtocol;
  excludedPorts?: Iterable<number>;
  findAvailablePort: (excludedPorts: number[]) => Promise<number | null>;
  isPortUsed: (port: number) => Promise<boolean>;
};

function normalizeExcludedPorts(values: Iterable<number> | undefined) {
  return Array.from(new Set(Array.from(values || [])
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535)))
    .sort((left, right) => left - right);
}

export async function reserveManagedProtocolPort(
  options: ManagedProtocolPortAllocatorOptions,
): Promise<HostPortReservation | null> {
  const fixedExcluded = normalizeExcludedPorts(options.excludedPorts);
  const rejectedPorts = new Set<number>();
  return reserveAvailableHostPort({
    hostId: options.hostId,
    protocol: options.protocol,
    findPort: async (reservedPorts) => options.findAvailablePort(normalizeExcludedPorts([
      ...fixedExcluded,
      ...rejectedPorts,
      ...reservedPorts,
    ])),
    isUsed: async (port) => {
      const used = await options.isPortUsed(port);
      if (used) rejectedPorts.add(port);
      return used;
    },
    maxAttempts: 128,
  });
}
