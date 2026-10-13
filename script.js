
"use strict";

// ==========================================
// 1. GET HTML ELEMENTS
// ==========================================

const fileInput = document.querySelector("#file-input");
const uploadArea = document.querySelector("#upload-area");
const editor = document.querySelector("#editor");
const imagePreview = document.querySelector("#image-preview");
const imageInfo = document.querySelector("#image-info");

const originalSize = document.querySelector("#original-size");
const compressedSize = document.querySelector("#compressed-size");
const targetSize = document.querySelector("#target-size");

const errorMessage = document.querySelector("#error-message");
const statusMessage = document.querySelector("#status-message");
const compressionResult = document.querySelector("#compression-result");

const removeButton = document.querySelector("#remove-image-button");
const compressButton = document.querySelector("#compress-button");
const downloadButton = document.querySelector("#download-button");

const outputFormat = document.querySelector("#output-format");
const resizeWidth = document.querySelector("#resize-width");
const resizeHeight = document.querySelector("#resize-height");
const keepRatio = document.querySelector("#keep-ratio");
const transformButton = document.querySelector("#transform-button");
const transformationResult = document.querySelector("#transformation-result");

// ==========================================
// 2. APP STATE
// ==========================================

let selectedFile = null;
let previewUrl = null;
let downloadUrl = null;
let dragDepth = 0;
let isCompressing = false;
let isTransforming = false;

const MAX_FILE_SIZE = 15 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

// Quality values are tried from highest to lowest.
const QUALITY_LEVELS = [
  0.92, 0.85, 0.78, 0.70,
  0.62, 0.55, 0.45, 0.35
];

// ==========================================
// 3. MESSAGES AND FILE SIZES
// ==========================================

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  statusMessage.textContent = "";
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return bytes + " bytes";
  }

  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }

  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

// ==========================================
// 4. CLEAN UP TEMPORARY URLS
// ==========================================

function clearPreviewUrl() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

function clearDownloadUrl() {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }

  downloadButton.removeAttribute("href");
  downloadButton.hidden = true;
}

// ==========================================
// 5. REMOVE THE SELECTED IMAGE
// ==========================================

function removeImage() {
  selectedFile = null;

  clearPreviewUrl();
  clearDownloadUrl();

  fileInput.value = "";
  imagePreview.removeAttribute("src");
  imageInfo.textContent = "";

  editor.hidden = true;

  originalSize.textContent = "—";
  compressedSize.textContent = "Not compressed";
  compressionResult.textContent = "";

  clearError();
  statusMessage.textContent = "Image removed.";

  dragDepth = 0;
  uploadArea.classList.remove("dragging");
}

// ==========================================
// 6. SELECT AND PREVIEW AN IMAGE
// ==========================================

function handleFile(file) {
  if (!file) return;

  clearError();

  if (!ALLOWED_TYPES.includes(file.type)) {
    showError("Choose a JPG, PNG, or WebP image.");
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showError("The maximum allowed file size is 15 MB.");
    return;
  }

  // Release resources from the previous image.
  clearPreviewUrl();
  clearDownloadUrl();

  selectedFile = file;

  const newUrl = URL.createObjectURL(file);
  previewUrl = newUrl;

  imagePreview.onload = () => {
    if (previewUrl !== newUrl) return;

    imageInfo.textContent =
      imagePreview.naturalWidth + " × " +
      imagePreview.naturalHeight + " pixels";

    statusMessage.textContent = "Image ready!";
  };

  imagePreview.onerror = () => {
    if (previewUrl !== newUrl) return;

    removeImage();
    showError("Could not read this image. Try another file.");
  };

  imagePreview.src = newUrl;

  editor.hidden = false;

  originalSize.textContent = formatFileSize(file.size);
  compressedSize.textContent = "Not compressed";
  compressionResult.textContent = "";

  statusMessage.textContent = "Loading image preview...";
}

// ==========================================
// 7. ENCODE A CANVAS AS JPEG
// ==========================================

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not encode this image."));
          return;
        }

        if (blob.type !== "image/jpeg") {
          reject(new Error("JPEG export is not supported by this browser."));
          return;
        }

        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

// ==========================================
// 8. THE COMPRESSION ENGINE
// ==========================================

async function compressImage(file, targetBytes) {
  let bitmap;

  try {
    // Decode the image locally in the browser.
    bitmap = await createImageBitmap(file);

    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;

    if (!originalWidth || !originalHeight) {
      throw new Error("The image has invalid dimensions.");
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Your browser could not create a canvas.");
    }

    let bestBlob = null;
    let bestWidth = 0;
    let bestHeight = 0;

    // Try the original dimensions, then progressively smaller ones.
    const MAX_ATTEMPTS = 15;
    const DIMENSION_FACTOR = 0.82;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const scale = Math.pow(DIMENSION_FACTOR, attempt);

      const width = Math.max(
        1,
        Math.round(originalWidth * scale)
      );

      const height = Math.max(
        1,
        Math.round(originalHeight * scale)
      );

      canvas.width = width;
      canvas.height = height;

      // JPEG has no transparency. Fill white behind transparent pixels.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);

      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of QUALITY_LEVELS) {
        const blob = await canvasToJpeg(canvas, quality);

        // Keep the smallest result in case the target is impossible.
        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
          bestWidth = width;
          bestHeight = height;
        }

        // The target is a maximum file size, not an exact byte count.
        if (blob.size <= targetBytes) {
          return {
            blob,
            width,
            height,
            targetReached: true
          };
        }
      }

      // Report progress before trying smaller dimensions.
      statusMessage.textContent =
        "Still compressing... trying smaller dimensions.";
    }

    // Return our smallest attempt, but don't claim the target was met.
    return {
      blob: bestBlob,
      width: bestWidth,
      height: bestHeight,
      targetReached: bestBlob !== null &&
        bestBlob.size <= targetBytes
    };

  } finally {
    // Release decoded image memory even if encoding fails.
    if (bitmap) {
      bitmap.close();
    }
  }
}

// ==========================================
// 9. COMPRESS BUTTON
// ==========================================

compressButton.addEventListener("click", async () => {
  if (isCompressing || isTransforming) {
  return;
}

if (!selectedFile) {
  showError("Please choose an image first.");
  return;
}
transformButton.disabled = true;


isCompressing = true;

  const file = selectedFile;
  const targetBytes = Number(targetSize.value);

  clearError();
  clearDownloadUrl();

  compressButton.disabled = true;
  compressButton.textContent = "Compressing...";
  compressionResult.textContent = "";
  compressedSize.textContent = "Working...";

  statusMessage.textContent =
    "Processing your image locally. Please wait...";

  try {
    const result = await compressImage(file, targetBytes);

    // Ignore the result if the user changed or removed the image.
    if (selectedFile !== file) {
      return;
    }

    if (!result.blob) {
      throw new Error("No compressed image could be created.");
    }

    compressedSize.textContent = formatFileSize(result.blob.size);

    const reduction =
      ((file.size - result.blob.size) / file.size) * 100;

    if (result.targetReached) {
      compressionResult.textContent =
        "Target achieved! Output dimensions: " +
        result.width + " × " + result.height + " pixels. " +
        "Size change: " + reduction.toFixed(1) + "%.";

      statusMessage.textContent = "Compression complete!";
    } else {
      compressionResult.textContent =
        "The target of " + formatFileSize(targetBytes) +
        " could not be reached. The smallest result was " +
        formatFileSize(result.blob.size) + ". " +
        "You can download this best-effort result.";

      statusMessage.textContent = "Compression finished; target not reached.";
    }

    // Make a local download link for the output file.
    downloadUrl = URL.createObjectURL(result.blob);
    downloadButton.href = downloadUrl;
    downloadButton.download =
      (file.name.replace(/\.[^.]+$/, "") || "formsnap-image") +
      "-compressed.jpg";

    downloadButton.hidden = false;

  } catch (error) {
    console.error("FormSnap compression error:", error);

    compressedSize.textContent = "Failed";
    showError(
      error.message ||
      "Compression failed. Try another image or a different browser."
    );

    } finally {
    isCompressing = false;
    compressButton.disabled = false;
    compressButton.textContent = "Compress Image";
    transformButton.disabled = false;
  }
});

// ==========================================
// 10. FILE PICKER
// ==========================================

fileInput.addEventListener("change", () => {
  handleFile(fileInput.files[0]);
  fileInput.value = "";
});

// ==========================================
// 11. DRAG AND DROP
// ==========================================

uploadArea.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth++;
  uploadArea.classList.add("dragging");
});

uploadArea.addEventListener("dragover", (event) => {
  event.preventDefault();

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
});

uploadArea.addEventListener("dragleave", (event) => {
  event.preventDefault();

  dragDepth = Math.max(0, dragDepth - 1);

  if (dragDepth === 0) {
    uploadArea.classList.remove("dragging");
  }
});

uploadArea.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();

  dragDepth = 0;
  uploadArea.classList.remove("dragging");

  const file = event.dataTransfer?.files?.[0];

  if (file) {
    handleFile(file);
  } else {
    showError("No file detected. Please try again.");
  }
});

// Prevent dropped files from navigating the page.
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
  }
});

window.addEventListener("drop", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
  }
});

// ==========================================
// 12. REMOVE IMAGE AND CLEAN UP
// ==========================================

removeButton.addEventListener("click", removeImage);

window.addEventListener("pagehide", () => {
  clearPreviewUrl();
  clearDownloadUrl();
});

console.log("FormSnap compression engine initialized.");


/* ==========================================
   13. CONVERSION AND RESIZING
   ========================================== */

function syncResizeDimensions(changedField) {
  const width = Number(resizeWidth.value);
  const height = Number(resizeHeight.value);

  if (!keepRatio.checked || !imagePreview.naturalWidth) {
    return;
  }

  const ratio = imagePreview.naturalWidth / imagePreview.naturalHeight;

  if (changedField === "width" && width > 0) {
    resizeHeight.value = Math.max(1, Math.round(width / ratio));
  } else if (changedField === "height" && height > 0) {
    resizeWidth.value = Math.max(1, Math.round(height * ratio));
  }
}

imagePreview.addEventListener("load", () => {
  resizeWidth.value = imagePreview.naturalWidth;
  resizeHeight.value = imagePreview.naturalHeight;
  transformationResult.textContent = "";
});

resizeWidth.addEventListener("input", () => {
  syncResizeDimensions("width");
});

resizeHeight.addEventListener("input", () => {
  syncResizeDimensions("height");
});

keepRatio.addEventListener("change", () => {
  if (keepRatio.checked) {
    syncResizeDimensions("width");
  }
});

transformButton.addEventListener("click", async () => {
  if (isCompressing || isTransforming) return;

  const file = selectedFile;

  if (!file) {
    showError("Please choose an image first.");
    return;
  }

  const width = Number(resizeWidth.value);
  const height = Number(resizeHeight.value);
  const mimeType = outputFormat.value;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 12000 ||
    height > 12000
  ) {
    showError("Enter valid dimensions between 1 and 12,000 pixels.");
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    showError("Choose a supported output format.");
    return;
  }

  isTransforming = true;
  compressButton.disabled = true;
  transformButton.disabled = true;
  transformButton.textContent = "Processing...";
  clearError();
  clearDownloadUrl();
  transformationResult.textContent = "";
  statusMessage.textContent = "Processing locally in your browser...";

  let bitmap;

  try {
    bitmap = await createImageBitmap(file);

    if (selectedFile !== file) return;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create the image canvas.");
    }

    // JPEG cannot preserve transparency, so use a white background.
    if (mimeType === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }

    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (!result) {
            reject(new Error("The browser could not export this image."));
            return;
          }

          resolve(result);
        },
        mimeType,
        0.92
      );
    });

    if (selectedFile !== file) return;

    // Never give the download a misleading file extension.
    if (blob.type !== mimeType) {
      throw new Error(
        "Your browser does not support this output format."
      );
    }

    clearDownloadUrl();
    downloadUrl = URL.createObjectURL(blob);
    downloadButton.href = downloadUrl;

    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    }[blob.type];

    const baseName =
      file.name.replace(/\.[^.]+$/, "") || "formsnap-image";

    downloadButton.download = `${baseName}-converted.${extension}`;
    downloadButton.textContent = "Download Converted Image";
    downloadButton.hidden = false;

    transformationResult.textContent =
      `Done! ${width} × ${height} pixels · ` +
      `${formatFileSize(blob.size)} · ${extension.toUpperCase()}`;

    statusMessage.textContent = "Conversion / resizing complete!";
  } catch (error) {
    console.error("FormSnap conversion error:", error);

    if (selectedFile === file) {
      showError(
        error.message || "Could not convert this image. Try smaller dimensions."
      );
    }
  } finally {
    if (bitmap) bitmap.close();

    isTransforming = false;
    compressButton.disabled = false;
    transformButton.disabled = false;
    transformButton.textContent = "Convert / Resize Image";
  }
});

console.log("FormSnap conversion and resizing tools initialized.");

