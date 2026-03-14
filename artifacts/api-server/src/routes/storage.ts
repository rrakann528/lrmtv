import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import multer from "multer";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient, parseObjectPath } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const RequestUploadUrlBody = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().min(1).max(127),
});

const RequestUploadUrlResponse = z.object({
  uploadURL: z.string().url(),
  objectPath: z.string(),
  metadata: z.object({
    name: z.string(),
    size: z.number(),
    contentType: z.string(),
  }),
});

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * POST /storage/upload-image
 *
 * Proxy image upload: client sends multipart/form-data with `file` field.
 * Server streams it to GCS directly, returns { objectPath, url }.
 * Avoids browser CORS restrictions with direct GCS presigned PUT.
 */
router.post("/storage/upload-image", requireAuth, upload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const { buffer, mimetype, originalname } = req.file;

    const ext = originalname.split('.').pop()?.toLowerCase() || 'jpg';
    const objectId = randomUUID();
    const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!privateObjectDir) {
      res.status(500).json({ error: "Object storage not configured" });
      return;
    }

    const fullPath = `${privateObjectDir}/uploads/${objectId}.${ext}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    const gcsFile = objectStorageClient.bucket(bucketName).file(objectName);
    await gcsFile.save(buffer, { contentType: mimetype, resumable: false });

    const uploadId = objectName.split('/').pop();
    const objectPath = `/objects/uploads/${uploadId}`;
    res.json({ objectPath });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving public object:", error);
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving object:", error);
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
