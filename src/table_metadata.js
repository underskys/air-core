const path = require("path");
const { scalarByteWidth } = require("./types");

function staticTableMetadata(mod) {
  return (mod.tables || [])
    .map((table) => {
      const byteWidth = tableStorageByteWidth(table.type) || 0;
      const approximateStorageBytes = (table.length || 0) * byteWidth;
      const equivalentI32Bytes = (table.length || 0) * 4;
      const item = {
        name: table.name,
        type: table.type,
        elementType: table.type,
        storageType: table.type,
        length: table.length,
        byteWidth,
        byteSize: approximateStorageBytes,
        equivalentI32Bytes,
        estimatedI32SavingsBytes: Math.max(0, equivalentI32Bytes - approximateStorageBytes),
        staticBytes: approximateStorageBytes,
        approximateStorageBytes,
        module: mod.name,
        source: tableSource(table),
        origin: tableOrigin(table)
      };
      if (table.tablegroup) {
        item.tablegroup = table.tablegroup;
        item.tablegroupField = table.tablegroupField || null;
      }
      return item;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function tableGroupMetadata(mod) {
  const tables = new Map((mod.tables || []).map((table) => [table.name, table]));
  return (mod.tableGroups || [])
    .map((group) => {
      const fields = (group.fields || []).map((field) => {
        const table = tables.get(field.loweredTableName);
        const byteWidth = tableStorageByteWidth(field.type) || 0;
        const byteSize = (field.length || group.length || 0) * byteWidth;
        return {
          name: field.name,
          type: field.type,
          storageType: field.type,
          length: field.length || group.length,
          byteWidth,
          byteSize,
          loweredTableName: field.loweredTableName,
          diagnostics: [],
          source: tableSource(table || field)
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      return {
        name: group.name,
        length: group.length,
        fieldCount: fields.length,
        fields,
        byteSize: fields.reduce((sum, field) => sum + field.byteSize, 0),
        diagnostics: [],
        module: mod.name,
        source: groupSource(group),
        origin: "manual"
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function tableGroupSummary(mod) {
  const groups = tableGroupMetadata(mod);
  return {
    count: groups.length,
    names: groups.map((group) => group.name).sort(),
    totalByteSize: groups.reduce((sum, group) => sum + group.byteSize, 0)
  };
}

function staticTableSummary(mod) {
  const tables = staticTableMetadata(mod);
  return {
    count: tables.length,
    names: tables.map((table) => table.name).sort(),
    totalApproximateStorageBytes: tables.reduce((sum, table) => sum + table.approximateStorageBytes, 0),
    totalEquivalentI32Bytes: tables.reduce((sum, table) => sum + table.equivalentI32Bytes, 0),
    totalEstimatedI32SavingsBytes: tables.reduce((sum, table) => sum + table.estimatedI32SavingsBytes, 0)
  };
}

function tableStorageByteWidth(type) {
  if (type === "u8") return 1;
  if (type === "u16" || type === "i16") return 2;
  return scalarByteWidth(type);
}

function tableOrigin(table) {
  if (table && table.tablegroup) return "tablegroup";
  const file = table && table.loc && table.loc.file ? table.loc.file.replace(/\\/g, "/") : "";
  return /(^|\/)generated\//.test(file) ? "generated" : "manual";
}

function groupSource(group) {
  const file = group && group.loc && group.loc.file ? group.loc.file : null;
  if (!file) return null;
  return path.normalize(file).replace(/\\/g, "/");
}

function tableSource(table) {
  const file = table && table.loc && table.loc.file ? table.loc.file : null;
  if (!file) return null;
  return path.normalize(file).replace(/\\/g, "/");
}

module.exports = {
  staticTableMetadata,
  staticTableSummary,
  tableGroupMetadata,
  tableGroupSummary,
  tableOrigin,
  tableStorageByteWidth
};
