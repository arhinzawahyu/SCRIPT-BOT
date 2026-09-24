import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

let client: S3Client | null = null;

export function s3Enabled(): boolean {
  return !!(process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_ENDPOINT_URL_S3.startsWith("https://") && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.S3_BUCKET);
}

export function getS3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: process.env.AWS_REGION || "us-east-2",
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
    forcePathStyle: true,
  });
  return client;
}

export function bucket(): string {
  const b = process.env.S3_BUCKET || "";
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(b)) throw new Error("S3_BUCKET tidak valid");
  return b;
}

export function newObjectKey(kind: string, mime: string): string {
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") || mime.includes("audio") ? "ogg" : mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return `wa/${kind}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
}

export async function s3Put(key: string, body: Buffer, contentType: string) {
  await getS3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function s3Get(key: string): Promise<{ body: Buffer; contentType: string }> {
  const out = await getS3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const chunks: Buffer[] = [];
  const stream = out.Body as any;
  for await (const c of stream) chunks.push(Buffer.from(c));
  return { body: Buffer.concat(chunks), contentType: (out.ContentType as string) || "application/octet-stream" };
}

export async function s3Delete(key: string) {
  await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export async function s3SignedUrl(key: string, seconds = 900): Promise<string> {
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: seconds });
}
