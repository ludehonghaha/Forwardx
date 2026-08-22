import assert from "node:assert/strict";
import test from "node:test";
import { getDatabaseTableDefs, MIGRATION_TABLES } from "./dbSchema";

test("protocol access schema is additive and does not duplicate ForwardX network resources", () => {
  const tableNames = new Set(getDatabaseTableDefs().map((table) => table.name));
  for (const name of ["protocol_endpoints", "protocol_user_access", "protocol_feed_tokens"]) {
    assert.equal(tableNames.has(name), true, `${name} must be installed`);
    assert.equal((MIGRATION_TABLES as readonly string[]).includes(name), true, `${name} must migrate`);
  }
  for (const duplicate of ["nodes", "landings", "network_chains", "network_deployments", "tms_users"]) {
    assert.equal(tableNames.has(duplicate), false, `${duplicate} must not be copied into ForwardX`);
  }
});

test("protocol access rows reference existing users, hosts and forward rules", () => {
  const byName = new Map(getDatabaseTableDefs().map((table) => [table.name, table]));
  const endpointColumns = new Set(byName.get("protocol_endpoints")?.columns.map((column) => column.name));
  const accessColumns = new Set(byName.get("protocol_user_access")?.columns.map((column) => column.name));
  assert.equal(endpointColumns.has("hostId"), true);
  assert.equal(endpointColumns.has("forwardRuleId"), true);
  assert.equal(accessColumns.has("userId"), true);
  assert.equal(endpointColumns.has("trafficUsed"), false);
  assert.equal(accessColumns.has("trafficUsed"), false);
});
