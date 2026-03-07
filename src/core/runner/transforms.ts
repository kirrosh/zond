const DIRECTIVES = new Set(["concat", "append", "length", "get", "first", "map_field"]);

export function applyTransform(directive: unknown): unknown {
  if (typeof directive !== "object" || directive === null || Array.isArray(directive)) {
    return directive;
  }

  const obj = directive as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (keys.length !== 1 || !DIRECTIVES.has(keys[0]!)) {
    return directive;
  }

  const op = keys[0]!;
  const arg = obj[op];

  switch (op) {
    case "concat": {
      if (!Array.isArray(arg)) return directive;
      const result: unknown[] = [];
      for (const item of arg) {
        if (Array.isArray(item)) result.push(...item);
        else result.push(item);
      }
      return result;
    }
    case "append": {
      if (!Array.isArray(arg) || arg.length < 2) return directive;
      const arr = Array.isArray(arg[0]) ? [...arg[0]] : [];
      return [...arr, ...arg.slice(1)];
    }
    case "length": {
      if (Array.isArray(arg)) return arg.length;
      if (typeof arg === "string") return arg.length;
      return 0;
    }
    case "get": {
      if (!Array.isArray(arg) || arg.length < 2) return directive;
      const [source, index] = arg;
      if (Array.isArray(source) && typeof index === "number") return source[index];
      if (typeof source === "object" && source !== null && typeof index === "string") {
        return (source as Record<string, unknown>)[index];
      }
      return undefined;
    }
    case "first": {
      if (Array.isArray(arg)) return arg[0];
      return undefined;
    }
    case "map_field": {
      if (!Array.isArray(arg) || arg.length < 2) return directive;
      const [items, field] = arg;
      if (!Array.isArray(items) || typeof field !== "string") return directive;
      return items.map((item) => {
        if (typeof item === "object" && item !== null) {
          return (item as Record<string, unknown>)[field];
        }
        return undefined;
      });
    }
    default:
      return directive;
  }
}
