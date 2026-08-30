import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_BRAND_DUAL_DISCOVERY_SNAPSHOT,
  createDefaultDualMultipathInfrastructure,
  type DualTargetDiscoverySnapshot,
} from "../shared/dualMultipath";
import { hysteria2CarrierAdapter, mieruCarrierAdapter } from "./dualCarrierAdapters";

const multipathTarget = { host: "127.0.0.1" as const, port: 39000 };

function currentDraft() {
  return {
    version: 3 as const,
    state: "draft" as const,
    name: "NoBrand Dual",
    ...createDefaultDualMultipathInfrastructure(NO_BRAND_DUAL_DISCOVERY_SNAPSHOT),
  };
}

test("Mieru adapter keeps server local listener and external entry as separate fields", () => {
  const dryRun = mieruCarrierAdapter.dryRun({
    targetDiscovery: NO_BRAND_DUAL_DISCOVERY_SNAPSHOT,
    multipathTarget,
    externalEntry: { host: "198.51.100.20", port: 15000 },
  });
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.discovery.localListener?.port, 11464);
  assert.equal(dryRun.discovery.externalEntry?.host, "198.51.100.20");
  assert.notEqual(dryRun.discovery.localListener?.listen, dryRun.discovery.externalEntry?.host);
  assert.equal(dryRun.validation.valid, true);
  assert.deepEqual(dryRun.safety, {
    commandExecution: false,
    packageInstall: false,
    serviceMutation: false,
    firewallMutation: false,
    routeMutation: false,
  });
});

test("Mieru adapter does not invent an external/mobile entry from the local listener", () => {
  const dryRun = mieruCarrierAdapter.dryRun({
    targetDiscovery: NO_BRAND_DUAL_DISCOVERY_SNAPSHOT,
    multipathTarget,
  });
  assert.equal(dryRun.discovery.localListener?.port, 11464);
  assert.equal(dryRun.discovery.externalEntry, null);
  assert.equal(dryRun.validation.valid, false);
  assert.match(dryRun.validation.blockers.join("\n"), /external\/mobile entry/);
});

test("Hysteria2 adapter derives bind facts from a second synthetic Dual without schema changes", () => {
  const syntheticDiscovery: DualTargetDiscoverySnapshot = {
    status: "verified-read-only",
    targetId: "synthetic-dual-ens3",
    platform: { kernel: "Linux", architecture: "x86_64" },
    publicSide: {
      interfaceName: "ens3",
      sourceAddress: "203.0.113.20",
      addresses: ["203.0.113.20/24"],
      gateway: "203.0.113.1",
    },
    privateSide: {
      interfaceName: "ens8",
      sourceAddress: "10.44.0.12",
      addresses: ["10.44.0.12/24"],
    },
    defaultRoute: { via: "203.0.113.1", dev: "ens3" },
    existingPrivateCarrier: {
      type: "mita",
      binaryPath: "/opt/mita",
      serviceStatus: "active",
      listener: { network: "tcp", listen: "*", port: 22464 },
      lifecycle: "preserve",
    },
    installedBinaries: { singBox: false, hysteria: false, standaloneMieru: false },
  };
  const infrastructure = createDefaultDualMultipathInfrastructure(syntheticDiscovery);
  const draft = {
    version: 3 as const,
    state: "draft" as const,
    name: "Synthetic Dual",
    ...infrastructure,
    directCarrier: {
      ...infrastructure.directCarrier,
      status: "resolved" as const,
      serverPort: 24443,
      tls: { serverName: "synthetic.example.test" },
    },
  };
  const dryRun = hysteria2CarrierAdapter.dryRun({ draft });
  assert.equal(dryRun.discovery.bind?.interfaceName, "ens3");
  assert.equal(dryRun.discovery.bind?.sourceAddress, "203.0.113.20");
  assert.equal(dryRun.discovery.endpoint?.port, 24443);
  assert.equal(dryRun.validation.valid, true);
});
