#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_OUT = path.join("examples", "gfx_fixtures", "assets");

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, fixture: "cube" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      options.out = requireValue(argv, ++i, arg);
    } else if (arg === "--fixture") {
      options.fixture = requireValue(argv, ++i, arg);
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unexpected argument '${arg}'`);
    }
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
  return value;
}

function usage() {
  return [
    "Usage: node tools/generate-gfx-fixtures.js [--out <dir>] [--fixture cube]",
    "",
    "Generates deterministic GLB fixtures for AIR GFX host/package tests.",
    "v0.11 minimum fixture: cube",
    "Deferred to v0.12/post-v0.11: uv_test, primitive_set, material_test"
  ].join("\n");
}

function listFixtures() {
  return [
    "cube: implemented v0.11 minimum indexed GLB fixture",
    "uv_test: deferred v0.12/post-v0.11 UV-coordinate fixture",
    "primitive_set: deferred v0.12/post-v0.11 primitive topology fixture",
    "material_test: deferred v0.12/post-v0.11 material binding fixture"
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.list) {
    console.log(listFixtures());
    return;
  }
  if (options.fixture !== "cube") {
    throw new Error(`fixture '${options.fixture}' is planned but not implemented yet`);
  }
  const outDir = path.resolve(options.out);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "cube.glb");
  fs.writeFileSync(outFile, createCubeGlb());
  console.log(`wrote ${path.relative(process.cwd(), outFile)}`);
}

function createCubeGlb() {
  const positions = [
    -1, -1, -1,
     1, -1, -1,
     1,  1, -1,
    -1,  1, -1,
    -1, -1,  1,
     1, -1,  1,
     1,  1,  1,
    -1,  1,  1
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5,
    3, 0, 4, 3, 4, 7
  ];

  const positionBytes = writeFloat32Array(positions);
  const indexBytes = writeUint16Array(indices);
  const bin = Buffer.concat([positionBytes, indexBytes]);

  const gltf = {
    asset: { version: "2.0", generator: "AIR tools/generate-gfx-fixtures.js" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "cube_node" }],
    meshes: [{
      name: "cube",
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        mode: 4
      }]
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length, target: 34963 }
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: 8,
        type: "VEC3",
        min: [-1, -1, -1],
        max: [1, 1, 1]
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5123,
        count: indices.length,
        type: "SCALAR",
        min: [0],
        max: [7]
      }
    ]
  };

  return makeGlb(gltf, bin);
}

function writeFloat32Array(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function writeUint16Array(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return pad4(buffer, 0);
}

function makeGlb(gltf, binChunk) {
  const jsonChunk = pad4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
  const bin = pad4(binChunk, 0);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 0x4e4f534a),
    jsonChunk,
    chunkHeader(bin.length, 0x004e4942),
    bin
  ]);
}

function chunkHeader(length, type) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(length, 0);
  header.writeUInt32LE(type, 4);
  return header;
}

function pad4(buffer, byte) {
  const padding = (4 - (buffer.length % 4)) % 4;
  if (!padding) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(padding, byte)]);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`generate-gfx-fixtures: ${err.message}`);
    process.exit(1);
  }
}
