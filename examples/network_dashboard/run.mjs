#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildPackage, loadPackage, instantiateAirModule, parseAir, createConformanceReport } = require("../../src");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDir = __dirname;
const root = path.resolve(demoDir, "..", "..");
const outDir = path.join(root, "build", "network_dashboard");

const args = parseArgs(process.argv.slice(2));
const latencyThreshold = numberArg(args["latency-threshold"], 120);
const lossThreshold = numberArg(args["loss-threshold"], 2.0);
const pressed = args.refresh === "1" || args.refresh === "true";

const calls = [];
const debugMetrics = [];
const mockInputFacts = {
  source: "checked-in static fixture",
  nodes: [
    { id: "edge-router", service: "gateway", latencyMs: 42, packetLossPct: 0.2, status: "ok" },
    { id: "api-gateway", service: "https", latencyMs: 138, packetLossPct: 2.75, status: "warn" },
    { id: "internal-dns", service: "dns", latencyMs: 215, packetLossPct: 1.4, status: "warn" }
  ],
  latencySamplesMs: [42, 138, 215],
  averageLatencyMs: 131,
  packetLossPct: 2.75,
  serviceDown: 0,
  staleRoute: 0
};
const airFile = path.join(demoDir, "network_dashboard.air");
const conformance = createConformanceReport(parseAir(fs.readFileSync(airFile, "utf8"), airFile));

await buildPackage({
  air: airFile,
  out: outDir
});
const pkg = loadPackage(outDir);
const instance = await instantiateAirModule({
  wasmBytes: pkg.wasmBytes,
  imports: {
    ui: {
      begin_frame: (width, height, timeMs) => calls.push({ op: "begin_frame", width, height, timeMs }),
      panel: (id, x, y, w, h, style) => calls.push({ op: "panel", id, x, y, w, h, style }),
      label: (id, x, y, label, style) => calls.push({ op: "label", id, x, y, label: labelText(label), style }),
      button: (id, x, y, w, h, label, style) => {
        calls.push({ op: "button", id, x, y, w, h, label: labelText(label), style, pressed });
        return pressed ? 1 : 0;
      },
      input_i32: (id, x, y, w, label, value, style) => {
        const current = id === 3 ? latencyThreshold : value;
        calls.push({ op: "input_i32", id, x, y, w, label: labelText(label), value, current, style });
        return current;
      },
      input_f32: (id, x, y, w, label, value, style) => {
        const current = id === 4 ? lossThreshold : value;
        calls.push({ op: "input_f32", id, x, y, w, label: labelText(label), value, current, style });
        return current;
      },
      metric: (id, x, y, label, value, unit, style) => calls.push({ op: "metric", id, x, y, label: labelText(label), value, unit: labelText(unit), style }),
      table: (id, x, y, w, h, rows, cols, data, style) => calls.push({ op: "table", id, x, y, w, h, rows, cols, data: datasetName(data), style }),
      chart: (id, x, y, w, h, series, style) => calls.push({ op: "chart", id, x, y, w, h, series: datasetName(series), style }),
      status: (id, x, y, label, severity, style) => calls.push({ op: "status", id, x, y, label: labelText(label), severity, text: severityText(severity), style }),
      warning: (id, x, y, label, severity, style) => calls.push({ op: "warning", id, x, y, label: labelText(label), severity, text: severityText(severity), style }),
      end_frame: () => calls.push({ op: "end_frame" })
    },
    debug: {
      metric: (id, value) => debugMetrics.push({ id, value })
    }
  }
});

const score = instance.exports.render(120, 2.0);
const statusCall = calls.find((call) => call.op === "status");
const status = severityText(statusCall?.severity ?? 0);
const report = {
  module: pkg.metadata.module,
  capabilities: pkg.metadata.capabilities,
  imports: pkg.metadata.imports,
  strictHostAbi: conformance.strictHostAbi,
  unsupportedHostFeatures: conformance.unsupportedHostFeatures,
  mockInputFacts,
  thresholds: {
    latencyMs: latencyThreshold,
    packetLossPct: lossThreshold
  },
  score,
  status,
  computedStatus: {
    score,
    severity: statusCall?.severity ?? 0,
    text: status
  },
  hostAccess: {
    network: false,
    filesystem: false,
    rawSockets: false,
    externalNetwork: false
  },
  ui: calls,
  debugMetrics,
  note: "Mock/static data only. No network, filesystem, OS scan, or raw socket access."
};

console.log(JSON.stringify(report, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument '${arg}'`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      out[key] = value;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid numeric argument '${value}'`);
  return parsed;
}

function labelText(id) {
  return {
    1300: "Network Health Dashboard",
    1301: "Latency threshold (ms)",
    1302: "Packet loss threshold (%)",
    1303: "Recompute",
    1304: "Overall health score",
    1305: "Network status",
    1306: "Risk summary",
    2004: "score",
    3002: "Mock nodes/services table",
    4002: "Mock latency/loss chart"
  }[id] || `label:${id}`;
}

function datasetName(id) {
  return labelText(id);
}

function severityText(severity) {
  if (severity >= 2) return "error";
  if (severity >= 1) return "warn";
  return "ok";
}
