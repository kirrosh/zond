const OPERATORS = ["!=", "==", ">=", "<=", ">", "<"] as const;

export function evaluateExpr(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed === "") return false;

  for (const op of OPERATORS) {
    const idx = trimmed.indexOf(op);
    if (idx !== -1) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + op.length).trim();
      return compareValues(left, right, op);
    }
  }

  // No operator — truthiness
  return isTruthy(trimmed);
}

function compareValues(left: string, right: string, op: string): boolean {
  const lNum = Number(left);
  const rNum = Number(right);
  const numeric = !isNaN(lNum) && !isNaN(rNum) && left !== "" && right !== "";

  switch (op) {
    case "==": return numeric ? lNum === rNum : left === right;
    case "!=": return numeric ? lNum !== rNum : left !== right;
    case ">":  return numeric ? lNum > rNum : left > right;
    case "<":  return numeric ? lNum < rNum : left < right;
    case ">=": return numeric ? lNum >= rNum : left >= right;
    case "<=": return numeric ? lNum <= rNum : left <= right;
    default: return false;
  }
}

function isTruthy(value: string): boolean {
  if (value === "" || value === "0" || value === "false" || value === "null" || value === "undefined") {
    return false;
  }
  return true;
}
