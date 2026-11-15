/** Limita los bytes recibidos antes de almacenar el cuerpo HTTP completo. */
export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  errorMessage = 'Remote JSON response exceeds the size limit',
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    await response.body?.cancel();
    throw new RangeError('Invalid response size limit');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new TypeError(errorMessage);
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new TypeError(errorMessage);
      }
      chunks.push(Buffer.from(result.value));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  errorMessage = 'Remote JSON response exceeds the size limit',
): Promise<string> {
  return new TextDecoder().decode(await readBoundedResponseBytes(response, maxBytes, errorMessage));
}
