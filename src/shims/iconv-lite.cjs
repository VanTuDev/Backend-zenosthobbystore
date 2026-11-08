// Workers shim for `iconv-lite`, which body-parser/raw-body pull in. The real package's stream
// helpers break under workerd's `stream` polyfill; request bodies here are UTF-8 JSON, so the
// platform TextDecoder covers every charset we actually receive.
function make(encoding) {
  try {
    return new TextDecoder(String(encoding || "utf-8").toLowerCase());
  } catch {
    return null;
  }
}
module.exports = {
  encodingExists(encoding) {
    return make(encoding) !== null;
  },
  decode(buffer, encoding) {
    const decoder = make(encoding);
    if (!decoder) throw new Error(`encoding not supported: ${encoding}`);
    return decoder.decode(buffer);
  },
  getDecoder(encoding) {
    const decoder = make(encoding);
    if (!decoder) throw new Error(`encoding not supported: ${encoding}`);
    return {
      write: (chunk) => decoder.decode(chunk, { stream: true }),
      end: () => decoder.decode(),
    };
  },
};
