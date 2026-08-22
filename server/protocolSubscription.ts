import {
  effectiveProtocolSecret,
  protocolConfigBool,
  protocolConfigPort,
  protocolConfigSecret,
  protocolConfigText,
  type ProtocolFeedEntry,
  validateProtocolFeedEntry,
} from "../shared/protocolAccess";

export type ProtocolSubscriptionRenderResult = {
  content: string;
  included: number;
  skipped: Array<{ assignmentId: number; reason: string }>;
};

function yamlString(value: unknown) {
  return JSON.stringify(String(value ?? ""));
}

function uriHost(value: string) {
  const host = value.trim();
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function sip002UserInfo(cipher: string, password: string) {
  return Buffer.from(`${cipher}:${password}`, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function uniqueEntryNames(entries: ProtocolFeedEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const name = entry.name.trim();
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return new Map(entries.map((entry) => {
    const name = entry.name.trim();
    return [entry.assignmentId, counts.get(name) === 1 ? name : `${name} #${entry.endpointId}`];
  }));
}

export function renderProtocolUriSubscription(entries: ProtocolFeedEntry[]): ProtocolSubscriptionRenderResult {
  const links: string[] = [];
  const skipped: ProtocolSubscriptionRenderResult["skipped"] = [];
  const names = uniqueEntryNames(entries);

  for (const entry of entries) {
    const errors = validateProtocolFeedEntry(entry);
    if (errors.length > 0) {
      skipped.push({ assignmentId: entry.assignmentId, reason: errors.join("；") });
      continue;
    }
    if (entry.protocol !== "shadowsocks") {
      skipped.push({ assignmentId: entry.assignmentId, reason: "该复合协议只能输出 Mihomo 订阅" });
      continue;
    }
    const cipher = protocolConfigText(entry.endpointConfig, "cipher");
    const password = effectiveProtocolSecret(entry);
    const name = names.get(entry.assignmentId) || entry.name.trim();
    links.push(
      `ss://${sip002UserInfo(cipher, password)}@${uriHost(entry.publicHost)}:${entry.publicPort}`
      + `#${encodeURIComponent(name)}`,
    );
  }

  return {
    content: Buffer.from(links.join("\n"), "utf8").toString("base64"),
    included: links.length,
    skipped,
  };
}

function renderShadowsocksProxy(entry: ProtocolFeedEntry, name: string) {
  const cipher = protocolConfigText(entry.endpointConfig, "cipher");
  const password = effectiveProtocolSecret(entry);
  return [
    `  - name: ${yamlString(name)}`,
    "    type: ss",
    `    server: ${yamlString(entry.publicHost)}`,
    `    port: ${entry.publicPort}`,
    `    cipher: ${yamlString(cipher)}`,
    `    password: ${yamlString(password)}`,
    `    udp: ${protocolConfigBool(entry.endpointConfig, "udp", false)}`,
  ].join("\n");
}

function renderSshShadowsocksProxy(entry: ProtocolFeedEntry, name: string) {
  const cipher = protocolConfigText(entry.endpointConfig, "cipher");
  const password = effectiveProtocolSecret(entry);
  const remotePort = protocolConfigPort(entry.endpointConfig, "remotePort");
  const sshUsername = protocolConfigText(entry.endpointConfig, "sshUsername");
  const sshPrivateKey = protocolConfigSecret(entry.endpointConfig, "sshPrivateKey").replace(/\r/g, "").trim();
  const sshName = `${name} · SSH`;
  const keyLines = sshPrivateKey.split("\n").map((line) => `      ${line}`);
  return [
    `  - name: ${yamlString(sshName)}`,
    "    type: ssh",
    `    server: ${yamlString(entry.publicHost)}`,
    `    port: ${entry.publicPort}`,
    `    username: ${yamlString(sshUsername)}`,
    "    private-key: |",
    ...keyLines,
    `  - name: ${yamlString(name)}`,
    "    type: ss",
    "    server: 127.0.0.1",
    `    port: ${remotePort}`,
    `    cipher: ${yamlString(cipher)}`,
    `    password: ${yamlString(password)}`,
    "    udp: false",
    `    dialer-proxy: ${yamlString(sshName)}`,
    "    smux:",
    "      enabled: true",
    "      protocol: smux",
    "      only-tcp: true",
  ].join("\n");
}

export function renderProtocolMihomoSubscription(entries: ProtocolFeedEntry[]): ProtocolSubscriptionRenderResult {
  const blocks: string[] = [];
  const skipped: ProtocolSubscriptionRenderResult["skipped"] = [];
  const names = uniqueEntryNames(entries);

  for (const entry of entries) {
    const errors = validateProtocolFeedEntry(entry);
    if (errors.length > 0) {
      skipped.push({ assignmentId: entry.assignmentId, reason: errors.join("；") });
      continue;
    }
    const name = names.get(entry.assignmentId) || entry.name.trim();
    blocks.push(entry.protocol === "shadowsocks_ssh"
      ? renderSshShadowsocksProxy(entry, name)
      : renderShadowsocksProxy(entry, name));
  }

  return {
    content: blocks.length > 0 ? `proxies:\n${blocks.join("\n")}\n` : "proxies: []\n",
    included: blocks.length,
    skipped,
  };
}
