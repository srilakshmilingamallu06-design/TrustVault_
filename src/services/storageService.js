const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ALLOWED_MIME_TYPES = new Map([
  ['application/pdf', ['.pdf']],
  ['image/png', ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/gif', ['.gif']],
  ['image/webp', ['.webp']],
  ['image/svg+xml', ['.svg']],
  ['text/plain', ['.txt', '.log']],
  ['text/markdown', ['.md', '.markdown']],
  ['application/json', ['.json']],
  ['text/csv', ['.csv']],
  ['text/xml', ['.xml']],
  ['application/xml', ['.xml']],
  ['application/msword', ['.doc']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['.docx']]
]);

const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.vbs', '.js', '.mjs', '.cjs',
  '.dll', '.msi', '.scr', '.ps1', '.py', '.php', '.pl', '.jar', '.com'
]);

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

function getStorageDir() {
  const custom = process.env.STORAGE_DIR || 'storage';
  const resolved = path.isAbsolute(custom) ? custom : path.join(__dirname, '..', custom);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

/**
 * Validate file upload parameters before saving
 */
function validateUpload(file) {
  if (!file) {
    return { valid: false, error: 'No file was provided for upload.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds the maximum limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`
    };
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Files with extension "${ext}" are restricted for security reasons.`
    };
  }

  const mime = file.mimetype.toLowerCase();
  const validExtensions = ALLOWED_MIME_TYPES.get(mime);

  if (!validExtensions || !validExtensions.includes(ext)) {
    // If mime type doesn't match extension or not in allowlist
    return {
      valid: false,
      error: `Unsupported or mismatched file format (${mime} with ${ext}). Supported types: PDF, PNG, JPEG, GIF, WEBP, SVG, TXT, MD, JSON, CSV, DOC, DOCX.`
    };
  }

  return { valid: true };
}

/**
 * Save an uploaded file buffer to unpredictable storage location
 */
function saveFile(buffer, originalFilename) {
  const storageDir = getStorageDir();
  const ext = path.extname(originalFilename).toLowerCase();
  const randomName = `${crypto.randomUUID()}${ext}`;
  const fullPath = path.join(storageDir, randomName);

  fs.writeFileSync(fullPath, buffer);
  return randomName;
}

/**
 * Resolve full path to stored file and verify existence
 */
function getFilePath(storagePath) {
  const storageDir = getStorageDir();
  // Prevent directory traversal attacks
  const safeFilename = path.basename(storagePath);
  const fullPath = path.join(storageDir, safeFilename);

  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return fullPath;
}

/**
 * Safely delete a stored file from disk
 */
function deleteFile(storagePath) {
  if (!storagePath) return false;
  try {
    const filePath = getFilePath(storagePath);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    console.error(`[Storage] Failed to delete file ${storagePath}:`, err);
  }
  return false;
}

module.exports = {
  getStorageDir,
  validateUpload,
  saveFile,
  getFilePath,
  deleteFile,
  MAX_FILE_SIZE_BYTES
};
