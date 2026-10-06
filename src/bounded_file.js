"use strict";

const fs = require("fs");
const { AirError } = require("./errors");

const BOUNDED_FILE_MAX_BYTES = 4 * 1024 * 1024;

// Open nonblocking, then inspect and read the same descriptor. This rejects
// FIFOs/devices without blocking and bounds reads even if a regular file grows.
function readBoundedRegularFile(file, options = {}) {
  const maxBytes = options.maxBytes === undefined ? BOUNDED_FILE_MAX_BYTES : options.maxBytes;
  const label = options.label || "source";
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new AirError(`air.cli.file_invalid: ${label} must be a regular file`);
    if (stat.size > maxBytes) throw new AirError(`air.cli.file_too_large: ${label} exceeds ${maxBytes} bytes`);
    const chunks = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total));
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!count) return Buffer.concat(chunks, total).toString("utf8");
      total += count;
      if (total > maxBytes) throw new AirError(`air.cli.file_too_large: ${label} exceeds ${maxBytes} bytes`);
      chunks.push(chunk.subarray(0, count));
    }
    throw new AirError(`air.cli.file_too_large: ${label} exceeds ${maxBytes} bytes`);
  } catch (error) {
    if (error instanceof AirError) throw error;
    if (error && error.code === "ENOENT") throw new AirError(`air.cli.file_missing: ${label} file does not exist`);
    if (error && ["EISDIR", "ENOTDIR", "ELOOP", "ENAMETOOLONG", "EINVAL"].includes(error.code)) {
      throw new AirError(`air.cli.file_invalid: invalid ${label} file path`);
    }
    throw new AirError(`air.cli.file_read_failed: ${label} file could not be read`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// JSON syntax errors keep their existing native SyntaxError behaviour.
function readBoundedJsonFile(file, options = {}) {
  return JSON.parse(readBoundedRegularFile(file, { ...options, label: options.label || "JSON input" }));
}

module.exports = { BOUNDED_FILE_MAX_BYTES, readBoundedJsonFile, readBoundedRegularFile };
