import { createSaveChecksumFromJson } from "../src/core/saves/checksum";
import {
  GZIP_JSON_ENCODING,
  decodeSavePayloadJson,
  encodeSavePayloadJson
} from "../src/core/saves/saveCodec";
import { createWorldSession } from "../src/world/generation/createWorld";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const session = createWorldSession("save-codec-regression-49");
  const json = JSON.stringify(session);
  const checksum = createSaveChecksumFromJson(json);
  const encoded = await encodeSavePayloadJson(json);
  const restored = await decodeSavePayloadJson(encoded);

  assert(restored === json, "save codec changed the serialized world");
  assert(createSaveChecksumFromJson(restored) === checksum, "save checksum changed after round-trip");
  assert(JSON.parse(restored).world.meta.seed === session.world.meta.seed, "decoded save has the wrong world");

  const storedBytes = encoded.payloadData instanceof Blob
    ? encoded.payloadData.size
    : new TextEncoder().encode(encoded.payloadData).byteLength;
  if (encoded.payloadEncoding === GZIP_JSON_ENCODING) {
    assert(encoded.payloadData instanceof Blob, "gzip save is not stored as a Blob");
    assert(storedBytes < json.length * 0.25, `gzip save is too large: ${storedBytes} / ${json.length}`);
  }

  console.log(JSON.stringify({
    encoding: encoded.payloadEncoding,
    rawBytes: json.length,
    storedBytes,
    ratio: Math.round(storedBytes / json.length * 10_000) / 10_000,
    checksum
  }, null, 2));
}

void main();
