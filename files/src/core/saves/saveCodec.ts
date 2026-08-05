export const GZIP_JSON_ENCODING = "gzip-json-v1";
export const PLAIN_JSON_ENCODING = "json-v1";

export type SavePayloadEncoding = typeof GZIP_JSON_ENCODING | typeof PLAIN_JSON_ENCODING;

export interface EncodedSavePayload {
  payloadEncoding: SavePayloadEncoding;
  payloadData: Blob | string;
}

export async function encodeSavePayloadJson(json: string): Promise<EncodedSavePayload> {
  if (typeof CompressionStream === "undefined") {
    return { payloadEncoding: PLAIN_JSON_ENCODING, payloadData: json };
  }
  try {
    const stream = new Blob([json], { type: "application/json" })
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const payloadData = await new Response(stream).blob();
    return { payloadEncoding: GZIP_JSON_ENCODING, payloadData };
  } catch {
    return { payloadEncoding: PLAIN_JSON_ENCODING, payloadData: json };
  }
}

export async function decodeSavePayloadJson(payload: EncodedSavePayload): Promise<string> {
  if (payload.payloadEncoding === PLAIN_JSON_ENCODING) {
    if (typeof payload.payloadData !== "string") throw new Error("Plain save payload is invalid");
    return payload.payloadData;
  }
  if (typeof DecompressionStream === "undefined" || !(payload.payloadData instanceof Blob)) {
    throw new Error("Compressed save payload is unsupported");
  }
  const stream = payload.payloadData.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
