// JSON Pointer (RFC 6901) helpers, used for the packet's py:/ and agency:/ references.

const unescape = (token) => token.replace(/~1/g, '/').replace(/~0/g, '~');
const escape = (token) => String(token).replace(/~/g, '~0').replace(/\//g, '~1');

/** Returns the value at `pointer` inside `root`, or undefined when any step is missing. */
export function getAtPointer(root, pointer) {
  if (pointer === '' || pointer === '/') return root;
  if (!pointer.startsWith('/')) return undefined;
  let node = root;
  for (const raw of pointer.slice(1).split('/')) {
    if (node === null || typeof node !== 'object') return undefined;
    const token = unescape(raw);
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(token)) return undefined;
      node = node[Number(token)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(node, token)) return undefined;
      node = node[token];
    }
  }
  return node;
}

/** Builds a pointer from path segments, escaping each one. */
export function toPointer(segments) {
  return '/' + segments.map(escape).join('/');
}
