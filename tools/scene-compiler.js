#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SUPPORTED_COLLISION_SHAPES = new Set(["box", "sphere", "capsule", "cylinder", "mesh"]);
const SUPPORTED_REPEAT_KINDS = new Set(["line", "rect_ring", "radial"]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument '${arg}'`);
    const key = arg.slice(2);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  for (const key of ["layout", "manifest", "out"]) {
    if (!out[key]) throw new Error(`missing required --${key}`);
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`failed to read JSON ${file}: ${err.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function compileSceneLayout(layout, baseManifest, options = {}) {
  const errors = [];
  validateLayoutHeader(layout, errors);
  const safeLayout = layout && typeof layout === "object" ? layout : {};
  const manifest = mergeRegistries(deepClone(baseManifest), options);
  if (safeLayout.module && manifest.module && safeLayout.module !== manifest.module) {
    errors.push(`layout.module '${safeLayout.module}' does not match manifest.module '${manifest.module}'`);
  }
  manifest.scene = manifest.scene || {};
  manifest.scene.nodes = manifest.scene.nodes || {};
  manifest.scene.instances = manifest.scene.instances || {};
  manifest.handles = manifest.handles || {};
  manifest.handles.nodes = manifest.handles.nodes || {};
  manifest.handles.instances = manifest.handles.instances || {};

  validateRenderGraphBindings(manifest, errors);

  const groups = safeLayout.instanceGroups || [];
  if (!Array.isArray(groups) || groups.length === 0) {
    errors.push("layout.instanceGroups must be a non-empty array");
  }

  const seenKeys = new Set();
  const generatedColliders = [];
  const generatedTriggers = [];

  for (const group of groups) {
    const errorCount = errors.length;
    validateGroup(group, manifest, seenKeys, errors);
    if (errors.length > errorCount) continue;
    let transforms;
    try {
      transforms = expandTransforms(group);
    } catch (err) {
      errors.push(`instanceGroups.${group.key}: ${err.message}`);
      continue;
    }
    if (!transforms.length) {
      errors.push(`instanceGroups.${group.key}.transforms must not be empty`);
      continue;
    }
    const first = transforms[0];
    manifest.scene.nodes[group.key] = {
      mesh: group.module,
      material: group.material,
      transform: toNodeTransform(first),
      instances: transforms.length
    };
    manifest.scene.instances[group.key] = {
      model: group.module,
      material: group.material,
      count: transforms.length,
      transforms
    };
    assignHandle(manifest.handles.nodes, group.key);
    assignHandle(manifest.handles.instances, group.key);
    collectCollision(group, transforms, generatedColliders, generatedTriggers);
  }

  applySkybox(safeLayout, manifest, errors);
  mergeCollision(safeLayout, manifest, generatedColliders, generatedTriggers, errors);
  mergeSceneMetadata(safeLayout, manifest, errors);
  applyDebugMetadata(safeLayout, manifest, options);
  validateGeneratedHandles(manifest.handles, errors);

  if (errors.length) {
    const err = new Error(`scene layout compile failed:\n- ${errors.join("\n- ")}`);
    err.errors = errors;
    throw err;
  }
  return stableObject(manifest);
}

function validateLayoutHeader(layout, errors) {
  if (!layout || typeof layout !== "object") {
    errors.push("layout must be a JSON object");
    return;
  }
  if (layout.kind && layout.kind !== "air-gfx-scene-layout") {
    errors.push(`layout.kind must be 'air-gfx-scene-layout'`);
  }
}

function validateGroup(group, manifest, seenKeys, errors) {
  if (!group || typeof group !== "object") {
    errors.push("instanceGroups entries must be objects");
    return;
  }
  if (!group.key || typeof group.key !== "string") {
    errors.push("instanceGroups[].key is required");
    return;
  }
  if (seenKeys.has(group.key)) errors.push(`duplicate instance key '${group.key}'`);
  seenKeys.add(group.key);
  if (!group.module || typeof group.module !== "string") {
    errors.push(`instanceGroups.${group.key}.module is required`);
  } else if (!(((manifest.assets || {}).models || {})[group.module])) {
    errors.push(`instanceGroups.${group.key} references unknown model '${group.module}'`);
  }
  if (!group.material || typeof group.material !== "string") {
    errors.push(`instanceGroups.${group.key}.material is required`);
  } else if (!((manifest.materials || {})[group.material])) {
    errors.push(`instanceGroups.${group.key} references unknown material '${group.material}'`);
  }
  if (!group.transforms && !group.repeat) {
    errors.push(`instanceGroups.${group.key} must define transforms or repeat`);
  }
  if (group.transforms !== undefined && !Array.isArray(group.transforms)) {
    errors.push(`instanceGroups.${group.key}.transforms must be an array`);
  }
  if (group.repeat && (!group.repeat.kind || !SUPPORTED_REPEAT_KINDS.has(group.repeat.kind))) {
    errors.push(`instanceGroups.${group.key}: repeat.kind '${(group.repeat && group.repeat.kind) || "<missing>"}' is unsupported; expected one of: ${Array.from(SUPPORTED_REPEAT_KINDS).join(", ")}`);
  }
  if (group.collision) validateCollisionDefinition(group.collision, `instanceGroups.${group.key}.collision`, errors);
}

function expandTransforms(group) {
  if (Array.isArray(group.transforms)) return group.transforms.map(normalizeTransform);
  const repeat = group.repeat || {};
  if (repeat.kind === "line") return expandLine(repeat);
  if (repeat.kind === "rect_ring") return expandRectRing(repeat);
  if (repeat.kind === "radial") return expandRadial(repeat);
  throw new Error(`repeat.kind '${repeat.kind || "<missing>"}' is unsupported; expected one of: ${Array.from(SUPPORTED_REPEAT_KINDS).join(", ")}`);
}

function expandLine(repeat) {
  const count = positiveInteger(repeat.count, "repeat.count");
  const start = vec(repeat.start || [0, 0, 0], 3, "repeat.start");
  const step = vec(repeat.step || [0, 0, 0], 3, "repeat.step");
  const rotation = vec(repeat.rotation || [0, 0, 0], 3, "repeat.rotation");
  const scale = vec(repeat.scale || [1, 1, 1], 3, "repeat.scale");
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ position: [start[0] + step[0] * i, start[1] + step[1] * i, start[2] + step[2] * i], rotation, scale });
  }
  return out;
}

function expandRectRing(repeat) {
  const countPerSide = positiveInteger(repeat.countPerSide, "repeat.countPerSide");
  const halfExtent = finiteNumber(repeat.halfExtent, "repeat.halfExtent");
  const y = finiteNumber(repeat.y || 0, "repeat.y");
  const scale = vec(repeat.scale || [1, 1, 1], 3, "repeat.scale");
  const out = [];
  const step = countPerSide === 1 ? 0 : (halfExtent * 2) / (countPerSide - 1);
  for (let i = 0; i < countPerSide; i++) {
    const p = -halfExtent + step * i;
    out.push({ position: [p, y, -halfExtent], rotation: [0, 0, 0], scale });
    out.push({ position: [p, y, halfExtent], rotation: [180, 0, 0], scale });
    out.push({ position: [-halfExtent, y, p], rotation: [-90, 0, 0], scale });
    out.push({ position: [halfExtent, y, p], rotation: [90, 0, 0], scale });
  }
  return out;
}

function expandRadial(repeat) {
  const count = positiveInteger(repeat.count, "repeat.count");
  const radius = finiteNumber(repeat.radius, "repeat.radius");
  const y = finiteNumber(repeat.y || 0, "repeat.y");
  const startAngle = finiteNumber(repeat.startAngle || 0, "repeat.startAngle");
  const scale = vec(repeat.scale || [1, 1, 1], 3, "repeat.scale");
  const out = [];
  for (let i = 0; i < count; i++) {
    const yaw = startAngle + (360 / count) * i;
    const rad = yaw * Math.PI / 180;
    out.push({
      position: [round(Math.sin(rad) * radius), y, round(-Math.cos(rad) * radius)],
      rotation: [yaw, 0, 0],
      scale
    });
  }
  return out;
}

function normalizeTransform(raw) {
  const transform = raw || {};
  return {
    position: vec(transform.position || transform.translation || [0, 0, 0], 3, "transform.position"),
    rotation: vec(transform.rotation || [0, 0, 0], 3, "transform.rotation"),
    scale: vec(transform.scale || [1, 1, 1], 3, "transform.scale")
  };
}

function toNodeTransform(transform) {
  return {
    translation: transform.position,
    rotation: transform.rotation,
    scale: transform.scale
  };
}

function collectCollision(group, transforms, colliders, triggers) {
  if (!group.collision) return;
  const collision = group.collision;
  const target = collision.trigger ? triggers : colliders;
  if (collision.perInstance === false) {
    target.push({ ...collision, id: collision.id || `${group.key}_collision` });
    return;
  }
  transforms.forEach((transform, index) => {
    const item = {
      ...collision,
      id: `${collision.id || group.key}_${index}`,
      target: collision.target || group.key,
      transform
    };
    delete item.perInstance;
    target.push(item);
  });
}

function validateCollisionDefinition(collision, label, errors) {
  if (!collision || typeof collision !== "object") {
    errors.push(`${label} must be an object`);
    return;
  }
  const shape = collision.shape || collision;
  if (!shape || typeof shape !== "object") {
    errors.push(`${label}.shape must be an object`);
    return;
  }
  const type = shape.type || collision.type;
  if (!type || typeof type !== "string") {
    errors.push(`${label}.type is required`);
    return;
  }
  if (!SUPPORTED_COLLISION_SHAPES.has(type)) {
    errors.push(`${label}.type '${type}' is unsupported; expected one of: ${Array.from(SUPPORTED_COLLISION_SHAPES).join(", ")}`);
    return;
  }
  if (type === "box") {
    if (!Array.isArray(shape.size || collision.size)) errors.push(`${label}.size is required for box collision`);
    else validateVec(shape.size || collision.size, 3, `${label}.size`, errors);
  }
  if (type === "sphere") {
    const radius = shape.radius !== undefined ? shape.radius : collision.radius;
    if (!Number.isFinite(radius) || radius <= 0) errors.push(`${label}.radius must be a positive finite number for sphere collision`);
  }
  if (type === "capsule") {
    const radius = shape.radius !== undefined ? shape.radius : collision.radius;
    const height = shape.height !== undefined ? shape.height : collision.height;
    if (!Number.isFinite(radius) || radius <= 0) errors.push(`${label}.radius must be a positive finite number for capsule collision`);
    if (!Number.isFinite(height) || height <= 0) errors.push(`${label}.height must be a positive finite number for capsule collision`);
  }
  if (type === "cylinder") {
    const radius = shape.radius !== undefined ? shape.radius : collision.radius;
    const height = shape.height !== undefined ? shape.height : collision.height;
    if (!Number.isFinite(radius) || radius <= 0) errors.push(`${label}.radius must be a positive finite number for cylinder collision`);
    if (!Number.isFinite(height) || height <= 0) errors.push(`${label}.height must be a positive finite number for cylinder collision`);
  }
  if (type === "mesh") {
    const asset = shape.asset || collision.asset || collision.mesh;
    if (!asset || typeof asset !== "string") errors.push(`${label}.asset is required for mesh collision`);
  }
}

function applySkybox(layout, manifest, errors) {
  const skybox = layout.skybox;
  if (!skybox) return;
  const key = skybox.environment || skybox.id || skybox.texture;
  if (!key) {
    errors.push("skybox.environment or skybox.id is required");
    return;
  }
  if (!(((manifest.assets || {}).cubemaps || {})[key])) {
    errors.push(`skybox references unknown cubemap '${key}'`);
    return;
  }
  for (const graph of Object.values(manifest.renderGraphs || {})) {
    for (const pass of graph.passes || []) {
      if (pass.kind === "skybox" || pass.kind === "environment") pass.environment = key;
    }
  }
  manifest.scene.skybox = {
    environment: key,
    rotation: vec(skybox.rotation || [0, 0, 0], 3, "skybox.rotation"),
    exposure: skybox.exposure === undefined ? 1 : finiteNumber(skybox.exposure, "skybox.exposure")
  };
  if (skybox.layout !== undefined) manifest.scene.skybox.layout = String(skybox.layout);
  if (skybox.projection !== undefined) manifest.scene.skybox.projection = String(skybox.projection);
}

function mergeCollision(layout, manifest, generatedColliders, generatedTriggers, errors) {
  const collision = layout.collision || {};
  const explicitColliders = arrayField(collision.colliders, "collision.colliders", errors);
  const explicitTriggers = arrayField(collision.triggers, "collision.triggers", errors);
  for (const collider of explicitColliders) validateCollisionDefinition(collider, `collision.colliders.${collider.id || "<unnamed>"}`, errors);
  for (const trigger of explicitTriggers) validateCollisionDefinition(trigger.shape || trigger, `collision.triggers.${trigger.id || "<unnamed>"}`, errors);
  const colliders = [...explicitColliders, ...generatedColliders];
  const triggers = [...explicitTriggers, ...generatedTriggers];
  if (!colliders.length && !triggers.length) return;
  manifest.collision = {
    version: collision.version || "0.1",
    kind: "air-gfx-collision",
    units: collision.units || layout.units || "meters",
    upAxis: collision.upAxis || layout.upAxis || "Y",
    layers: collision.layers || {},
    colliders,
    triggers
  };
}

function mergeSceneMetadata(layout, manifest, errors) {
  const source = layout.layout && typeof layout.layout === "object" ? layout.layout : layout;
  const groups = {
    spawns: source.spawns,
    pickups: source.pickups,
    triggers: source.triggers,
    jumpPads: source.jumpPads || source.jump_pads,
    teleporters: source.teleporters || source.teleportPads || source.teleport_pads
  };
  const out = {};
  for (const [key, value] of Object.entries(groups)) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      errors.push(`${key} must be an array when present`);
      continue;
    }
    validateUniqueIds(value, key, errors);
    out[key] = value.map((item) => stableObject(item));
  }
  if (Object.keys(out).length) manifest.scene.interactions = stableObject(out);
}

function validateUniqueIds(items, label, errors) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") {
      errors.push(`${label}.${index} must be an object`);
      continue;
    }
    if (!item.id || typeof item.id !== "string") {
      errors.push(`${label}.${index}.id is required`);
      continue;
    }
    if (seen.has(item.id)) errors.push(`${label}.${index}.id duplicates '${item.id}'`);
    seen.add(item.id);
  }
}

function applyDebugMetadata(layout, manifest, options) {
  const debug = layout.debug || options.debug;
  if (!debug) return;
  manifest.debug = manifest.debug || {};
  manifest.debug.sceneCompiler = {
    tool: "tools/scene-compiler.js",
    layoutVersion: layout.version || "unknown",
    groups: Array.isArray(layout.instanceGroups) ? layout.instanceGroups.length : 0,
    generatedAt: options.generatedAt || "deterministic"
  };
}

function validateRenderGraphBindings(manifest, errors) {
  const graphs = manifest.renderGraphs || {};
  const pipelines = manifest.pipelines || {};
  const materials = manifest.materials || {};
  const renderTargets = manifest.renderTargets || {};
  const postPipelines = manifest.postPipelines || {};
  for (const [graphKey, graph] of Object.entries(graphs)) {
    if (!graph || typeof graph !== "object") {
      errors.push(`renderGraphs.${graphKey} must be an object`);
      continue;
    }
    if (!Array.isArray(graph.passes)) {
      errors.push(`renderGraphs.${graphKey}.passes must be an array`);
      continue;
    }
    for (const [index, pass] of graph.passes.entries()) {
      const label = `renderGraphs.${graphKey}.passes.${index}`;
      if (pass.pipeline && !pipelines[pass.pipeline]) errors.push(`${label} references unknown pipeline '${pass.pipeline}'`);
      if (pass.material && !materials[pass.material]) errors.push(`${label} references unknown material '${pass.material}'`);
      if (pass.target && pass.target !== "surface" && !renderTargets[pass.target]) errors.push(`${label} references unknown render target '${pass.target}'`);
      if (pass.output && pass.output !== "surface" && !renderTargets[pass.output]) errors.push(`${label} references unknown render target '${pass.output}'`);
      if (pass.effect && !postPipelines[pass.effect] && !(manifest.post || {})[pass.effect]) errors.push(`${label} references unknown post effect '${pass.effect}'`);
    }
  }
}

function arrayField(value, label, errors) {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  errors.push(`${label} must be an array when present`);
  return [];
}

function assignHandle(map, key) {
  if (map[key]) return map[key];
  const used = Object.values(map).filter(Number.isInteger);
  const next = used.length ? Math.max(...used) + 1 : 1;
  map[key] = next;
  return next;
}

function validateGeneratedHandles(handles, errors) {
  for (const [kind, map] of Object.entries(handles || {})) {
    const seen = new Set();
    for (const [key, handle] of Object.entries(map || {})) {
      if (!Number.isInteger(handle) || handle <= 0) {
        errors.push(`handles.${kind}.${key} must be a positive integer`);
      }
      if (seen.has(handle)) errors.push(`handles.${kind}.${key} duplicates handle ${handle}`);
      seen.add(handle);
    }
  }
}

function mergeRegistries(manifest, options) {
  if (options.assets) {
    manifest.assets = mergePlainObjects(manifest.assets || {}, normalizeAssetsRegistry(options.assets));
  }
  if (options.materials) {
    manifest.materials = mergePlainObjects(manifest.materials || {}, options.materials.materials || options.materials);
  }
  return manifest;
}

function normalizeAssetsRegistry(registry) {
  if (registry.assets) return registry.assets;
  if (registry.models || registry.textures || registry.cubemaps || registry.sprites || registry.vectors) return registry;
  return { models: registry };
}

function mergePlainObjects(base, extra) {
  const out = deepClone(base || {});
  for (const [key, value] of Object.entries(extra || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = mergePlainObjects(out[key], value);
    } else {
      out[key] = deepClone(value);
    }
  }
  return out;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function finiteNumber(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function vec(value, size, name) {
  if (!Array.isArray(value) || value.length !== size || !value.every(Number.isFinite)) {
    throw new Error(`${name} must be an array of ${size} finite numbers`);
  }
  return value.map(round);
}

function validateVec(value, size, name, errors) {
  try {
    vec(value, size, name);
  } catch (err) {
    errors.push(err.message);
  }
}

function round(value) {
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const layout = readJson(args.layout);
    const manifest = readJson(args.manifest);
    const generated = compileSceneLayout(layout, manifest, {
      assets: args.assets ? readJson(args.assets) : null,
      materials: args.materials ? readJson(args.materials) : null,
      debug: args.debug === "true" || args.debug === "1"
    });
    writeJson(args.out, generated);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  SUPPORTED_COLLISION_SHAPES,
  SUPPORTED_REPEAT_KINDS,
  compileSceneLayout,
  parseArgs
};
