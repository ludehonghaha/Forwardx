import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dualMultipathDraftSchema } from "../shared/dualMultipath";
import { defaultDualMultipathInfrastructure } from "../server/dualMultipathControlPlane";
import { buildDualMultipathGrayRuntimeBundle } from "../server/dualMultipathGrayRuntimeBundle";
import { materializeDualMieruClientConfig } from "../server/dualMultipathMieruSidecar";

const [outputArg, certificateArg, keyArg] = process.argv.slice(2);
if (!outputArg || !certificateArg || !keyArg) {
  throw new Error("usage: generate-dual-gray-ci-fixtures.ts <output-dir> <certificate-path> <key-path>");
}

const outputDir = resolve(outputArg);
const certificatePath = resolve(certificateArg);
const keyPath = resolve(keyArg);
mkdirSync(outputDir, { recursive: true });

const infrastructure = defaultDualMultipathInfrastructure();
const draft = dualMultipathDraftSchema.parse({
  version: 5,
  state: "draft",
  name: "NoBrand Dual CI Gray fixture",
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
  hy2Port: 61464,
  tlsServerName: "forwardx-dual-gray.test",
  tlsCertificatePath: certificatePath,
  tlsPrivateKeyPath: keyPath,
  tlsMode: "self-signed-gray",
});
const mieruConfig = materializeDualMieruClientConfig(draft, 24181, {
  username: "forwardx-gray-test-user",
  password: "forwardx-gray-test-password",
});

writeFileSync(
  resolve(outputDir, "mieru-test.json"),
  `${JSON.stringify(mieruConfig, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  resolve(outputDir, "dual-test.json"),
  `${JSON.stringify(bundle.fragments.windowsSidecarConfig, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  resolve(outputDir, "server-gray.json"),
  `${JSON.stringify(bundle.fragments.serverConfig, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  resolve(outputDir, "fixture-metadata.json"),
  `${JSON.stringify({
    purpose: "CI syntax validation only",
    readyForRuntime: bundle.readyForRuntime,
    upstreamCommit: bundle.artifacts.server.upstream.commit,
    tlsMode: bundle.safety.tlsMode,
    containsRealSecrets: false,
    mieruCredentials: "synthetic-ci-only",
  }, null, 2)}\n`,
  "utf8",
);

console.log(`Generated Dual Gray CI fixtures in ${outputDir}`);
