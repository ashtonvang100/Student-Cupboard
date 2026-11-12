import sharp from "sharp";
import { createHash } from "node:crypto";
import { ApiError } from "../middleware/error-handler.js";
export const MAX_UPLOAD_BYTES = 26 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export type ScanImage = { dataUrl: string; hash: string };
export async function prepareImages(files: File[]): Promise<ScanImage[]> {
  if (files.length < 1 || files.length > 5)
    throw new ApiError(
      400,
      "INVALID_IMAGES",
      "Upload between one and five images",
    );
  const images: ScanImage[] = [];
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (file.size > MAX_IMAGE_BYTES || total > 24 * 1024 * 1024)
      throw new ApiError(
        413,
        "IMAGE_TOO_LARGE",
        "Maximum 8 MiB per image and 24 MiB combined",
      );
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new ApiError(
        415,
        "INVALID_IMAGE_TYPE",
        "Only JPEG, PNG and WebP are supported",
      );
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const pipeline = sharp(bytes, {
        limitInputPixels: 40000000,
        failOn: "warning",
      });
      const metadata = await pipeline.metadata();
      const expected = {
        "image/jpeg": "jpeg",
        "image/png": "png",
        "image/webp": "webp",
      }[file.type];
      if (metadata.format !== expected || (metadata.pages ?? 1) !== 1)
        throw new Error("Invalid image");
      const output = await pipeline
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toBuffer();
      const hash = createHash("sha256").update(output).digest("hex");
      if (!images.some((i) => i.hash === hash))
        images.push({
          dataUrl: `data:image/jpeg;base64,${output.toString("base64")}`,
          hash,
        });
    } catch {
      throw new ApiError(
        400,
        "INVALID_IMAGE",
        "Image could not be decoded or exceeds pixel limits",
      );
    }
  }
  return images;
}
