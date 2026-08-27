import { randomBytes } from "node:crypto";
import {
  parseProtocolAccessConfig,
  protocolConfigSecret,
  protocolConfigText,
  type ProtocolAccessConfig,
} from "../shared/protocolAccess";

export type ManagedMieruCredentialRow = {
  id: number;
  userId: number;
  credentialJson: unknown;
};

export type ManagedMieruCredentialPlan = {
  id: number;
  userId: number;
  credential: ProtocolAccessConfig;
  changed: boolean;
};

function positiveInteger(value: unknown) {
  const number = Math.floor(Number(value) || 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function sameCredential(left: ProtocolAccessConfig, right: ProtocolAccessConfig) {
  return protocolConfigText(left, "username") === protocolConfigText(right, "username")
    && protocolConfigSecret(left, "password") === protocolConfigSecret(right, "password");
}

function defaultUsername(userId: number, assignmentId: number) {
  return `forwardx-${userId}-${assignmentId}`;
}

function randomPassword() {
  return randomBytes(24).toString("base64url");
}

/**
 * Give every managed Mieru assignment a stable, unique username/password pair.
 *
 * Migration rule: the earliest assignment may inherit the endpoint's legacy
 * shared credential so an already-connected first user is not broken. Any
 * later assignment that is empty or collides gets a fresh assignment-owned
 * credential. Once written to protocol_user_access the result remains stable.
 */
export function planManagedMieruCredentialBackfill(
  endpointConfigValue: unknown,
  rows: ManagedMieruCredentialRow[],
  passwordFactory: () => string = randomPassword,
): ManagedMieruCredentialPlan[] {
  const endpointConfig = parseProtocolAccessConfig(endpointConfigValue);
  const legacyUsername = protocolConfigText(endpointConfig, "username");
  const legacyPassword = protocolConfigSecret(endpointConfig, "password");
  const ordered = [...(rows || [])]
    .filter((row) => positiveInteger(row?.id) && positiveInteger(row?.userId))
    .sort((left, right) => positiveInteger(left.id) - positiveInteger(right.id));
  const seenUsernames = new Set<string>();
  const seenPasswords = new Set<string>();

  return ordered.map((row, index) => {
    const assignmentId = positiveInteger(row.id);
    const userId = positiveInteger(row.userId);
    const current = parseProtocolAccessConfig(row.credentialJson);
    const next: ProtocolAccessConfig = { ...current };

    let username = protocolConfigText(current, "username");
    if (!username || seenUsernames.has(username)) {
      if (index === 0 && legacyUsername && !seenUsernames.has(legacyUsername)) {
        username = legacyUsername;
      } else {
        username = defaultUsername(userId, assignmentId);
        let suffix = 1;
        while (seenUsernames.has(username)) {
          username = `${defaultUsername(userId, assignmentId)}-${suffix++}`;
        }
      }
      next.username = username;
    }

    let password = protocolConfigSecret(current, "password");
    if (!password || seenPasswords.has(password)) {
      if (index === 0 && legacyPassword && !seenPasswords.has(legacyPassword)) {
        password = legacyPassword;
      } else {
        for (let attempts = 0; attempts < 16; attempts += 1) {
          const candidate = String(passwordFactory() || "");
          if (candidate && !seenPasswords.has(candidate)) {
            password = candidate;
            break;
          }
        }
        if (!password || seenPasswords.has(password)) {
          throw new Error(`无法为 Mieru 分配生成唯一密码: assignment=${assignmentId}`);
        }
      }
      next.password = password;
    }

    seenUsernames.add(username);
    seenPasswords.add(password);
    return {
      id: assignmentId,
      userId,
      credential: next,
      changed: !sameCredential(current, next),
    };
  });
}
