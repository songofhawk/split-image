import { env, SamModel, AutoProcessor, RawImage, Tensor } from '@xenova/transformers';

// Skip local model check
env.allowLocalModels = false;

// Use HuggingFace mirror for better accessibility
env.remoteHost = 'https://hf-mirror.com';

export const SAM_MODELS = {
    FAST: 'Xenova/slimsam-77-uniform',
    HIGH_QUALITY: 'Xenova/sam-vit-b'
};

interface SAMState {
    model: any;
    processor: any;
    imageEmbeddings: any;
    imageInputs: any;
    rawImage: any;
    currentModelId: string | null;
    isInitializing: boolean;
}

let samState: SAMState = {
    model: null,
    processor: null,
    imageEmbeddings: null,
    imageInputs: null,
    rawImage: null,
    currentModelId: null,
    isInitializing: false
};

export const loadSAMModel = async (modelId: string, onProgress?: (progress: number) => void) => {
    // If same model is already loaded, do nothing
    if (samState.model && samState.processor && samState.currentModelId === modelId) {
        return;
    }

    // Prevent concurrent initialization
    if (samState.isInitializing) {
        throw new Error('Model is already being initialized');
    }

    // Reset state if switching models
    samState.model = null;
    samState.processor = null;
    samState.imageEmbeddings = null;
    samState.imageInputs = null;
    samState.currentModelId = null;
    samState.isInitializing = true;

    console.log(`Loading SAM Model: ${modelId}`, env);

    try {
        samState.model = await SamModel.from_pretrained(modelId, {
            quantized: true,
            progress_callback: (data: any) => {
                if (data.status === 'progress' && onProgress) {
                    onProgress(data.progress);
                }
            }
        });

        samState.processor = await AutoProcessor.from_pretrained(modelId);
        samState.currentModelId = modelId;
    } catch (err) {
        console.error("Failed to load SAM model", err);
        samState.isInitializing = false;
        throw err;
    } finally {
        samState.isInitializing = false;
    }
};

export const computeEmbeddings = async (imageUrl: string) => {
    if (!samState.model || !samState.processor) {
        throw new Error("Model not loaded");
    }

    const image = await RawImage.fromURL(imageUrl);
    samState.rawImage = image;

    const inputs = await samState.processor(image);
    samState.imageInputs = inputs;

    // Compute embeddings
    samState.imageEmbeddings = await samState.model.get_image_embeddings(inputs);

    return {
        width: image.width,
        height: image.height
    };
};

export const generateMask = async (points: { x: number, y: number, label: number }[]) => {
    if (!samState.model || !samState.processor || !samState.imageEmbeddings || !samState.rawImage || !samState.imageInputs) {
        throw new Error("Model or embeddings not ready");
    }

    // Get dimensions from imageInputs (computed during computeEmbeddings)
    const originalHeight = samState.rawImage.height;
    const originalWidth = samState.rawImage.width;

    // Calculate scale factor (SAM resizes longest side to 1024)
    const targetSize = 1024;
    const scale = targetSize / Math.max(originalHeight, originalWidth);

    // Resize points
    const resizedPoints = points.map(p => [p.x * scale, p.y * scale]);

    // Create Tensors
    const n = points.length;
    const pointsFlat = resizedPoints.flat();
    const labelsFlat = points.map(p => p.label);

    // Shape: [batch_size, point_batch_size, nb_points_per_image, 2] -> [1, 1, n, 2]
    const inputPointsTensor = new Tensor(
        'float32',
        new Float32Array(pointsFlat),
        [1, 1, n, 2]
    );

    // Shape: [batch_size, point_batch_size, nb_points_per_image] -> [1, 1, n]
    const inputLabelsTensor = new Tensor(
        'int64',
        new BigInt64Array(labelsFlat.map(l => BigInt(l))),
        [1, 1, n]
    );

    console.log("SAM Inputs:", {
        image_embeddings: samState.imageEmbeddings,
        input_points: inputPointsTensor,
        input_labels: inputLabelsTensor,
        pixel_values: samState.imageInputs.pixel_values
    });

    // Run model with precomputed embeddings
    // Note: pixel_values are required by the model signature even if we provide embeddings
    const outputs = await samState.model({
        pixel_values: samState.imageInputs.pixel_values,
        image_embeddings: samState.imageEmbeddings,
        input_points: inputPointsTensor,
        input_labels: inputLabelsTensor,
    });

    // Post-process masks
    // The output masks are low-res (256x256). We need to resize them to original image size.
    // We can use the processor's post_process_masks if available, or just return the mask and let the UI scale it?
    // UI scaling is faster (canvas drawImage).
    // But `post_process_masks` also handles thresholding and selecting the best mask.

    // Let's try to use processor.post_process_masks. 
    // It requires original_sizes and reshaped_input_sizes.
    // We can construct them.

    const originalSizes = [[originalHeight, originalWidth]];
    const reshapedInputSizes = [[Math.round(originalHeight * scale), Math.round(originalWidth * scale)]];

    const masks = await samState.processor.post_process_masks(
        outputs.pred_masks,
        originalSizes,
        reshapedInputSizes
    );

    // masks is a list of Tensors. We take the first one (batch index 0).
    const maskTensor = masks[0]; // Batch 0

    // maskTensor shape: [3, height, width] (3 candidate masks)
    // Select best mask based on iou_scores
    const scores = outputs.iou_scores.data; // Float32Array
    let bestIndex = 0;
    let maxScore = -1;
    for (let i = 0; i < scores.length; i++) {
        if (scores[i] > maxScore) {
            maxScore = scores[i];
            bestIndex = i;
        }
    }

    // Extract the best mask
    const dims = maskTensor.dims;
    let h, w;
    // Check if dims is 4D [batch, num_masks, height, width] or 3D [num_masks, height, width]
    if (dims.length === 4) {
        // [1, 3, H, W]
        h = dims[2];
        w = dims[3];
    } else {
        // [3, H, W]
        h = dims[1];
        w = dims[2];
    }

    const stride = h * w;
    const start = bestIndex * stride;
    const end = start + stride;
    const maskData = maskTensor.data.slice(start, end);

    return {
        data: maskData,
        width: w,
        height: h
    };
};
