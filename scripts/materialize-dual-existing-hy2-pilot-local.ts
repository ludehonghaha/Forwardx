import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dualMultipathDraftSchema,
  dualPrivateCarrierClientEndpointDiscoverySchema,
} from "../shared/dualMultipath";
import { defaultDualMultipathInfrastructure } from "../server/dualMultipathControlPlane";
import {
  buildDualMultipathGrayRuntimeBundle,
  dualExistingForwardxHy2DiscoverySchema,
} from "../server/dualMultipathGrayRuntimeBundle";
import { materializeDualMieruClientConfig } from "../server/dualMultipathMieruSidecar";
import { buildDualPilotMitaServerConfig, DUAL_PILOT_MODE } from "../server/dualMultipathPilotRuntime";

const [
  outputArg,
  privateCarrierEndpointFileArg,
  existingHy2DiscoveryFileArg,
  hy2AuthFileArg,
  hy2ObfsPasswordFileArg,
  mieruUsernameFileArg,
  mieruPasswordFileArg,
] = process.argv.slice(2);

if (
  !outputArg
  || !privateCarrierEndpointFileArg
  || !existingHy2DiscoveryFileArg
  || !hy2AuthFileArg
  || !hy2ObfsPasswordFileArg
  || !mieruUsernameFileArg
  || !mieruPasswordFileArg
) {
  throw new Error(
    "usage: materialize-dual-existing-hy2-pilot-local.ts <outside-repo-output-dir> <verified-pilot-mieru-endpoint-file> <verified-existing-hy2-discovery-file> <hy2-auth-file> <hy2-obfs-password-file> <mieru-username-file> <mieru-password-file>",
  );
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(outputArg);
const inputPaths = [
  resolve(privateCarrierEndpointFileArg),
  resolve(existingHy2DiscoveryFileArg),
  resolve(hy2AuthFileArg),
  resolve(hy2ObfsPasswordFileArg),
  resolve(mieruUsernameFileArg),
  resolve(mieruPasswordFileArg),
];

function assertOutsideRepository(path: string, label: string) {
  const pathFromRepository = relative(repositoryRoot, path);
  if (pathFromRepository === "" || (!pathFromRepository.startsWith("..") && !isAbsolute(pathFromRepository))) {
    throw new Error(`${label} 必须位于 ForwardX 仓库之外，避免 Pilot secret 被 Git 跟踪`);
  }
}

assertOutsideRepository(outputDir, "output directory");
for (const [index, path] of inputPaths.entries()) assertOutsideRepository(path, `runtime input ${index + 1}`);

const [
  privateCarrierEndpointFilePath,
  existingHy2DiscoveryFilePath,
  hy2AuthFilePath,
  hy2ObfsPasswordFilePath,
  mieruUsernameFilePath,
  mieruPasswordFilePath,
] = inputPaths;

const privateCarrierClientEndpoint = dualPrivateCarrierClientEndpointDiscoverySchema.parse(
  JSON.parse(readFileSync(privateCarrierEndpointFilePath, "utf8")) as unknown,
);
const existingForwardxHy2 = dualExistingForwardxHy2DiscoverySchema.parse(
  JSON.parse(readFileSync(existingHy2DiscoveryFilePath, "utf8")) as unknown,
);
const hy2Auth = readFileSync(hy2AuthFilePath, "utf8").trim();
const hy2ObfsPassword = readFileSync(hy2ObfsPasswordFilePath, "utf8").trim();
const mieruUsername = readFileSync(mieruUsernameFilePath, "utf8").trim();
const mieruPassword = readFileSync(mieruPasswordFilePath, "utf8").trim();
for (const [label, value] of [
  ["HY2 auth", hy2Auth],
  ["HY2 obfs password", hy2ObfsPassword],
  ["Mieru username", mieruUsername],
  ["Mieru password", mieruPassword],
] as const) {
  if (!value || value.length > 512) throw new Error(`${label} 未解析或长度异常`);
}

const infrastructure = defaultDualMultipathInfrastructure();
const draft = dualMultipathDraftSchema.parse({
  version: 5,
  state: "draft",
  name: "NoBrand Dual self-use Pilot",
  ...infrastructure,
  line: {
    ...infrastructure.line,
    activationThresholdMbps: 120,
    activationWindow: "1s",
    tcpFastOpen: false,
  },
  legs: [
    { ...infrastructure.legs[0], expectedBandwidthMbps: 200 },
    { ...infrastructure.legs[1], expectedBandwidthMbps: 1000 },
  ],
});

// Validate the dedicated Pilot Mita before creating any output. In particular,
// this rejects accidental reuse of the protected production listener (11464
// in the current verified NoBrand snapshot).
const mitaConfig = buildDualPilotMitaServerConfig(
  draft.serverTargetDiscovery,
  privateCarrierClientEndpoint,
  { username: mieruUsername, password: mieruPassword },
);

const bundle = buildDualMultipathGrayRuntimeBundle(draft, {
  windowsSidecarIngressPort: 24180,
  windowsPrivateSocksPort: 24181,
  privateCarrierClientEndpoint,
  existingForwardxHy2,
});
const clientConfig = structuredClone(bundle.fragments.windowsSidecarConfig);
const serverConfig = structuredClone(bundle.fragments.serverConfig);
const mieruConfig = materializeDualMieruClientConfig(draft, 24181, privateCarrierClientEndpoint, {
  username: mieruUsername,
  password: mieruPassword,
});

clientConfig.outbounds[1].password = hy2Auth;
if (!("obfs" in clientConfig.outbounds[1]) || !clientConfig.outbounds[1].obfs) {
  throw new Error("Verified existing HY2 requires Salamander obfs but the runtime template omitted it");
}
clientConfig.outbounds[1].obfs.password = hy2ObfsPassword;
Object.assign(clientConfig.outbounds[2], { status_file: resolve(outputDir, "multipath-status.json") });

mkdirSync(outputDir, { recursive: true, mode: 0o700 });
chmodSync(outputDir, 0o700);

function writePrivateJson(filename: string, value: unknown) {
  const path = resolve(outputDir, filename);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

writePrivateJson("dual-test.json", clientConfig);
writePrivateJson("server-gray.json", serverConfig);
writePrivateJson("mieru-gray.json", mieruConfig);
writePrivateJson("mita-pilot.json", mitaConfig);
writePrivateJson("materialization-metadata.json", {
  purpose: "Dual experimental self-use Pilot; reuse existing HY2 and preserve production Mita",
  pilotMode: DUAL_PILOT_MODE,
  readyForRuntime: false,
  readyToDeploy: false,
  productionReady: false,
  knownLimitation: "256 MiB repeated/long-flow reset remains unresolved",
  policy: {
    activationThresholdMbps: 120,
    activationWindow: "1s",
    activationAfterBytes: null,
    tcpFastOpen: false,
  },
  containsRealMieruCredential: true,
  containsRealHy2Auth: true,
  containsRealHy2ObfsPassword: true,
  clientIngress: { listen: "127.0.0.1", port: 24180 },
  privateSocks: { listen: "127.0.0.1", port: 24181 },
  privateCarrierClientEndpoint: bundle.topology.privateLeg.clientVisibleIngress,
  dedicatedPilotMita: {
    port: mitaConfig.portBindings[0].port,
    protocol: mitaConfig.portBindings[0].protocol,
    allowLoopbackIPForDedicatedPilotUserOnly: true,
    protectedProductionMitaPort: draft.serverTargetDiscovery.status === "verified-read-only"
      ? draft.serverTargetDiscovery.existingPrivateCarrier.listener.port
      : null,
    productionMitaLifecycle: "preserve",
    configFile: "mita-pilot.json",
    udsScope: "runtime-specific",
  },
  directCarrier: {
    mode: bundle.topology.directLeg.mode,
    endpoint: {
      server: bundle.topology.directLeg.serverAddress,
      port: bundle.topology.directLeg.serverPort,
      protocol: "UDP",
    },
    actualListener: bundle.topology.directLeg.existingRuntime?.actualListener,
    runtimeOwner: bundle.topology.directLeg.existingRuntime?.runtimeOwner,
    mapping: bundle.topology.directLeg.existingRuntime?.mapping,
  },
  serverMultipath: {
    listen: bundle.topology.multipath.serverListen,
    port: bundle.topology.multipath.serverPort,
  },
  safety: {
    ...bundle.safety,
    existingProductionMitaMutation: false,
    existingHy2Mutation: false,
    routeMutation: false,
    firewallMutation: false,
    systemdWrite: false,
  },
});

console.log(`Materialized secret-bearing Dual Pilot configs outside the repository: ${outputDir}`);
console.log("Pilot keeps readyToDeploy=false; production Mita/HY2 remain preserve-only and secrets were not printed.");
