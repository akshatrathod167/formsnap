
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
const transformationResult = document.querySelector("#transformation-result");

// ==========================================
// 2. APP STATE
// ==========================================

let selectedFile = null;
let previewUrl = null;
let downloadUrl = null;
let dragDepth = 0;
let isProcessing = false;

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
// 7. ENCODE THE IMAGE IN THE SELECTED FORMAT
// ==========================================

function canvasToBlob(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The browser could not export this image."));
        return;
      }

      if (blob.type !== format) {
        reject(new Error("This image format is not supported by your browser."));
        return;
      }

      resolve(blob);
    }, format, quality);
  });
}

// ==========================================
// 8. COMPRESSION, RESIZING AND CONVERSION
// ==========================================

async function compressImage(
  file,
  targetBytes,
  format,
  requestedWidth,
  requestedHeight
) {
  let bitmap;

  try {
    bitmap = await createImageBitmap(file);

    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;

    if (!originalWidth || !originalHeight) {
      throw new Error("The image has invalid dimensions.");
    }

    const widthInput = Number(requestedWidth);
    const heightInput = Number(requestedHeight);

    if (
      !Number.isInteger(widthInput) ||
      !Number.isInteger(heightInput) ||
      widthInput < 1 ||
      heightInput < 1 ||
      widthInput > 12000 ||
      heightInput > 12000
    ) {
      throw new Error("Width and height must be between 1 and 12000 pixels.");
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Your browser could not create a canvas.");
    }

    let bestBlob = null;
    let bestWidth = 0;
    let bestHeight = 0;

    const MAX_ATTEMPTS = 15;
    const DIMENSION_FACTOR = 0.82;

    // JPEG and WebP support quality adjustments.
    // PNG ignores the quality parameter, so reduce its dimensions instead.
    const qualities = format === "image/png"
      ? [undefined]
      : QUALITY_LEVELS;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const scale = Math.pow(DIMENSION_FACTOR, attempt);

      const width = Math.max(
        1,
        Math.round(widthInput * scale)
      );

      const height = Math.max(
        1,
        Math.round(heightInput * scale)
      );

      canvas.width = width;
      canvas.height = height;

      context.clearRect(0, 0, width, height);

      // JPEG cannot preserve transparency, so use a white background.
      if (format === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
      }

      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, format, quality);

        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
          bestWidth = width;
          bestHeight = height;
        }

        if (blob.size <= targetBytes) {
          return {
            blob,
            width,
            height,
            targetReached: true
          };
        }
      }

      statusMessage.textContent =
        "Optimizing image size... please wait.";
    }

    return {
      blob: bestBlob,
      width: bestWidth,
      height: bestHeight,
      targetReached: Boolean(
        bestBlob && bestBlob.size <= targetBytes
      )
    };

  } finally {
    if (bitmap) {
      bitmap.close();
    }
  }
}

// ==========================================
// 9. APPLY ALL SETTINGS WITH ONE BUTTON
// ==========================================

compressButton.addEventListener("click", async () => {
  if (!selectedFile || isProcessing) return;

  clearError();
  clearDownloadUrl();

  isProcessing = true;
  compressButton.disabled = true;
  compressButton.textContent = "Applying Changes...";
  statusMessage.textContent = "Preparing your image...";

  try {
    const targetBytes = Number(targetSize.value);
    const format = outputFormat.value;

    let width = Number(resizeWidth.value);
    let height = Number(resizeHeight.value);

    if (!Number.isFinite(targetBytes) || targetBytes <= 0) {
      throw new Error("Please select a valid target file size.");
    }

    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 12000 ||
      height > 12000
    ) {
      throw new Error("Enter a valid width and height from 1 to 12000.");
    }

    // Recalculate dimensions if aspect ratio is enabled.
    if (keepRatio.checked && imagePreview.naturalWidth) {
      const ratio =
        imagePreview.naturalWidth / imagePreview.naturalHeight;

      // Use the changed dimension as the reference.
      // If both fields were edited, width takes priority.
      height = Math.max(1, Math.round(width / ratio));

      if (height > 12000) {
        height = 12000;
        width = Math.max(1, Math.round(height * ratio));
      }

      resizeWidth.value = width;
      resizeHeight.value = height;
    }

    statusMessage.textContent =
      "Applying resize, format and compression settings...";

    const result = await compressImage(
      selectedFile,
      targetBytes,
      format,
      width,
      height
    );

    if (!result.blob) {
      throw new Error("Could not process this image. Try another file.");
    }

    clearDownloadUrl();

    downloadUrl = URL.createObjectURL(result.blob);

    const extensions = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    };

    downloadButton.href = downloadUrl;
    downloadButton.download =
      "formsnap-image." + extensions[format];
    downloadButton.hidden = false;

    compressedSize.textContent = formatFileSize(result.blob.size);

    transformationResult.textContent =
      "Final image: " + result.width + " × " +
      result.height + " pixels · " +
      extensions[format].toUpperCase() + " format.";

    if (result.targetReached) {
      compressionResult.textContent =
        "Success! Your image meets the selected file-size limit.";
      statusMessage.textContent = "All changes applied successfully!";
    } else {
      compressionResult.textContent =
        "Your target size could not be reached. " +
        "The smallest result is " + formatFileSize(result.blob.size) + ".";
      statusMessage.textContent =
        "Image processed, but the target size was not reached.";
    }

  } catch (error) {
    showError(
      error.message || "Something went wrong while processing the image."
    );
  } finally {
    isProcessing = false;
    compressButton.disabled = false;
    compressButton.textContent = "Apply Changes";
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



console.log("FormSnap conversion and resizing tools initialized.");

