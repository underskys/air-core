class AirError extends Error {
  constructor(message, loc) {
    super(loc ? `${loc.file}:${loc.line}: ${message}` : message);
    this.name = "AirError";
    this.loc = loc;
  }
}

module.exports = { AirError };
