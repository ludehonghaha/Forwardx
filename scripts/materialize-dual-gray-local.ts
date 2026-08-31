import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dualMultipathDraftSchema } from "../shared/dualMultipath";
import { defaultDualMultipathInfrastructure } from "../server/dualMultipathControlPlane";
import { buildDualMultipathGrayRuntimeBundle } from "../server/dualMultipathGrayRuntimeBundle";

const [outputArg, certificateArg, keyArg, authFileArg] = process.argv.slice(2);
if (!outputArg || !certificateArg || !keyArg || !authFileArg) {
  throw new Error(
    "usage: materialize-dual-gray-local.ts <outside-repo-output-dir> <certificate-path> <key-path> <auth-secret-file>",
  );
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(outputArg);
const certificatePath = resolve(certificateArg);
const keyPath = resolve(keyArg);
const authFilePath = resolve(authFileArg);

function assertOutsideRepository(path: string, label: string) {
  const pathFromRepository = relative(repositoryRoot, path);
  if (pathFromRepository === "" || (!pathFromRepository.startsWith("..") && !isAbsolute(pathFromRepository))) {
    throw new Error(`${label} 必须位于 ForwardX 仓库之外，避免 Gray secret 被 Git 跟踪`);
  }
}

assertOutsideRepository(outputDir, "output directory");
assertOutsideRepository(keyPath, "TLS private key");
assertOutsideRepository(authFilePath, "HY2 auth secret file");

const hy2AuthSecret = readFileSync(authFilePath, "utf8").trim();
if (hy2AuthSecret.length < 16 || hy2AuthSecret.length > 512) {
  throw new Error("Gray HY2 auth 长度必须在 16 到 512 字符之间");
}

const infrastructure = defaultDualMultipathInfrastructure();
const draft = dualMultipathDraftSchema.parse({
  version: 5,
  state: "draft",
  name: "NoBrand Dual local Gray materialization",
  ...infrastructure,
  line: {
    ...infrastructure.line,
    activationThresholdMbps: 120,
    activationWindow: "1s",
  },
  legs: [
    { ...infrastructure.legs[0], expectedBandwidthMbps: 200 },
    { ...infrastructure.legs[1], expectedBandwidthMbps: 1000 },
  ],
});

const bundle = buildDualMultipathGrayRuntimeBundle(draft, {
  windowsSidecarIngressPort: 24180,
  windowsPrivateSocksPort: 24181,
  pureMieruProxyRef: null,
  hy2Port: 61464,
  tlsServerName: "forwardx-dual-gray.test",
  tlsCertificatePath: certificatePath,
  tlsPrivateKeyPath: keyPath,
  tlsMode: "self-signed-gray",
});

const windowsConfig = structuredClone(bundle.fragments.windowsSidecarConfig);
const serverConfig = structuredClone(bundle.fragments.serverConfig);
windowsConfig.outbounds[1].password = hy2AuthSecret;
serverConfig.inbounds[0].users[0].password = hy2AuthSecret;

mkdirSync(outputDir, { recursive: true, mode: 0o700 });
chmodSync(outputDir, 0o700);

function writePrivateJson(filename: string, value: unknown) {
  const path = resolve(outputDir, filename);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

writePrivateJson("dual-test.json", windowsConfig);
writePrivateJson("server-gray.json", serverConfig);
writePrivateJson("materialization-metadata.json", {
  purpose: "local Gray sing-box check only",
  readyForRuntime: false,
  containsRealHy2Auth: true,
  tlsMode: bundle.safety.tlsMode,
  serverDiscovery: {
    mitaBinary: bundle.topology.privateLeg.existingServerBinaryPath,
    mitaUnit: bundle.topology.privateLeg.existingServerUnitName,
    mitaTcpPort: bundle.topology.privateLeg.existingServerListenerPort,
    publicAddress: bundle.topology.directLeg.serverBind,
    hy2UdpPort: bundle.topology.directLeg.serverPort,
    multipathListen: bundle.topology.multipath.serverListen,
    multipathPort: bundle.topology.multipath.serverPort,
  },
  windows: {
    ingressPort: 24180,
    privateSocksPort: 24181,
    dedicatedMieruResolved: false,
  },
});

console.log(`Materialized secret-bearing Gray configs outside the repository: ${outputDir}`);
console.log("HY2 auth was not printed; readyForRuntime remains false; dedicated Mieru remains unresolved.");
