export interface ParsedBase64Image {
  mimeType: string;
  buffer: Buffer;
  extension: string;
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

export function parseBase64Image(input: string): ParsedBase64Image {
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (match) {
    const mimeType = match[1];

    return {
      mimeType,
      buffer: Buffer.from(match[2], 'base64'),
      extension: extensionFromMimeType(mimeType),
    };
  }

  const mimeType = 'image/png';

  return {
    mimeType,
    buffer: Buffer.from(input, 'base64'),
    extension: extensionFromMimeType(mimeType),
  };
}
