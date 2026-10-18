/**
 * True when `value` contains an object/array nested `maxDepth` or more levels below the root.
 * Iterative, so even a pathologically deep payload cannot overflow the call stack while being checked.
 */
export function exceedsDepth(value: unknown, maxDepth: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 0]];
  for (let entry = stack.pop(); entry; entry = stack.pop()) {
    const [node, depth] = entry;
    if (node === null || typeof node !== 'object') continue;
    if (depth >= maxDepth) return true;
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  return false;
}
