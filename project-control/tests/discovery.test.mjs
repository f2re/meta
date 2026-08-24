import test from "node:test";
import assert from "node:assert/strict";

import { parseNginxText, parseSize, parseSsOutput, projectHintForPath } from "../src/discovery.mjs";

test("ss parser extracts listening endpoints and process", () => {
  const parsed = parseSsOutput([
    'LISTEN 0 511 0.0.0.0:9090 0.0.0.0:* users:(("node",pid=1234,fd=20))',
    'LISTEN 0 128 [::1]:8001 [::]:* users:(("python",pid=77,fd=8))'
  ].join("\n"));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    protocol: "tcp", address: "0.0.0.0", port: 9090,
    process: "node", pid: 1234,
    raw: 'LISTEN 0 511 0.0.0.0:9090 0.0.0.0:* users:(("node",pid=1234,fd=20))'
  });
  assert.equal(parsed[1].address, "::1");
  assert.equal(parsed[1].port, 8001);
});

test("nginx parser records prefix, upstream and body limit", () => {
  const config = `
server {
  listen 443 ssl;
  server_name apps.example.local;
  client_max_body_size 1m;
  location /project-control/ {
    proxy_pass http://127.0.0.1:9090/;
  }
  location /boris/ {
    proxy_pass http://127.0.0.1:8001/;
  }
}`;
  const parsed = parseNginxText(config, "/etc/nginx/sites-enabled/apps.conf");
  assert.equal(parsed.routes.length, 2);
  assert.equal(parsed.routes[0].location, "/project-control/");
  assert.equal(parsed.routes[0].upstreamHost, "127.0.0.1");
  assert.equal(parsed.routes[0].upstreamPort, 9090);
  assert.equal(parsed.routes[0].clientMaxBodyBytes, 1024 * 1024);
  assert.deepEqual(parsed.routes[0].serverNames, ["apps.example.local"]);
  assert.equal(parsed.routes[1].upstreamPort, 8001);
});

test("size parser supports nginx units", () => {
  assert.equal(parseSize("512k"), 512 * 1024);
  assert.equal(parseSize("20M"), 20 * 1024 * 1024);
  assert.equal(parseSize("2g"), 2 * 1024 * 1024 * 1024);
  assert.equal(parseSize("off"), null);
});

test("opt path hints identify managed projects", () => {
  assert.equal(projectHintForPath("/opt/docomator/releases/0.6.3"), "docomator");
  assert.equal(projectHintForPath("/opt/planner-solving/current"), "planer-solving");
  assert.equal(projectHintForPath("/srv/kafedra-planner"), "kafedra-planner");
  assert.equal(projectHintForPath("/opt/unrelated"), null);
});
