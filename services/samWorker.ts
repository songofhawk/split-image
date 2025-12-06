import { env, SamModel, AutoProcessor, RawImage, Tensor } from '@xenova/transformers';

console.log('[SAM Worker] Worker script loaded');

// Skip local model check
env.allowLocalModels = false;

// Check if browser cache is accessible (some environments block it)
async function checkCacheAccess(): Promise<boolean> {
    console.log('[SAM Worker] Checking cache accessibility...');
    try {
        if (typeof caches === 'undefined') {
            console.log('[SAM Worker] caches API is undefined');
            return false;
        }
        console.log('[SAM Worker] Opening test cache...');
        const testCache = await caches.open('transformers-cache-test');
        console.log('[SAM Worker] Test cache opened, deleting...');
        await caches.delete('transformers-cache-test');
        console.log('[SAM Worker] Cache test passed');
        return true;
    } catch (e) {
        console.error('[SAM Worker] Cache API error:', e);
        return false;
    }
}

// Initialize cache setting
let cacheCheckDone = false;
async function ensureCacheChecked() {
    if (cacheCheckDone) return;
    const canUseCache = await checkCacheAccess();
    env.useBrowserCache = canUseCache;
    cacheCheckDone = true;
    console.log('[SAM Worker] Final cache setting - useBrowserCache:', canUseCache);
}

interface SAMState {
    model: any;
    processor: any;
    imageEmbeddings: any;
    imageInputs: any;
    rawImage: any;
    currentModelId: string | null;
}

let samState: SAMState = {
    model: null,
    processor: null,
    imageEmbeddings: null,
    imageInputs: null,
    rawImage: null,
    currentModelId: null
};

// Message handlers
self.onmessage = async (e: MessageEvent) => {
    const { type, payload, id } = e.data;
    console.log('[SAM Worker] Received message:', type, 'id:', id);

    try {
        switch (type) {
            case 'loadModel':
                await handleLoadModel(payload.modelId, id);
                break;
            case 'computeEmbeddings':
                await handleComputeEmbeddings(payload.imageUrl, id);
                break;
            case 'generateMask':
                await handleGenerateMask(payload.points, id);
                break;
            default:
                throw new Error(`Unknown message type: ${type}`);
        }
    } catch (error) {
        console.error('[SAM Worker] Error in message handler:', error);
        self.postMessage({
            id,
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

async function handleLoadModel(modelId: string, messageId: string) {
    console.log('[SAM Worker] handleLoadModel called with:', modelId);
    
    // Check cache accessibility before loading
    await ensureCacheChecked();
    
    // If same model is already loaded, do nothing
    if (samState.model && samState.processor && samState.currentModelId === modelId) {
        console.log('[SAM Worker] Model already loaded, skipping');
        self.postMessage({ id: messageId, type: 'modelLoaded' });
        return;
    }

    // Reset state if switching models
    samState.model = null;
    samState.processor = null;
    samState.imageEmbeddings = null;
    samState.imageInputs = null;
    samState.currentModelId = null;

    console.log(`[SAM Worker] Starting model download: ${modelId}`);

    try {
        samState.model = await SamModel.from_pretrained(modelId, {
            quantized: true,
            progress_callback: (data: any) => {
                // Log all progress events for debugging
                console.log('[SAM Worker] Progress event:', data.status, data.progress ?? '', data.file ?? '');
                if (data.status === 'progress') {
                    self.postMessage({
                        id: messageId,
                        type: 'progress',
                        progress: data.progress
                    });
                }
            }
        });
        console.log('[SAM Worker] Model loaded successfully');
    } catch (e) {
        console.error('[SAM Worker] Model loading failed:', e);
        throw e;
    }

    console.log('[SAM Worker] Loading processor...');
    try {
        samState.processor = await AutoProcessor.from_pretrained(modelId);
        console.log('[SAM Worker] Processor loaded successfully');
    } catch (e) {
        console.error('[SAM Worker] Processor loading failed:', e);
        throw e;
    }
    
    samState.currentModelId = modelId;
    console.log('[SAM Worker] All loading complete, sending modelLoaded message');
    self.postMessage({ id: messageId, type: 'modelLoaded' });
}

async function handleComputeEmbeddings(imageUrl: string, messageId: string) {
    console.log('[SAM Worker] handleComputeEmbeddings called');
    
    if (!samState.model || !samState.processor) {
        throw new Error("Model not loaded");
    }

    console.log('[SAM Worker] Loading image from URL...');
    const image = await RawImage.fromURL(imageUrl);
    samState.rawImage = image;
    console.log('[SAM Worker] Image loaded:', image.width, 'x', image.height);

    console.log('[SAM Worker] Processing image...');
    const inputs = await samState.processor(image);
    samState.imageInputs = inputs;
    console.log('[SAM Worker] Image processed');

    // Compute embeddings
    console.log('[SAM Worker] Computing embeddings...');
    samState.imageEmbeddings = await samState.model.get_image_embeddings(inputs);
    console.log('[SAM Worker] Embeddings computed');

    self.postMessage({
        id: messageId,
        type: 'embeddingsComputed',
        result: {
            width: image.width,
            height: image.height
        }
    });
}

async function handleGenerateMask(points: { x: number, y: number, label: number }[], messageId: string) {
    if (!samState.model || !samState.processor || !samState.imageEmbeddings || !samState.rawImage || !samState.imageInputs) {
        throw new Error("Model or embeddings not ready");
    }

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

    const inputPointsTensor = new Tensor(
        'float32',
        new Float32Array(pointsFlat),
        [1, 1, n, 2]
    );

    const inputLabelsTensor = new Tensor(
        'int64',
        new BigInt64Array(labelsFlat.map(l => BigInt(l))),
        [1, 1, n]
    );

    // Run model
    const outputs = await samState.model({
        pixel_values: samState.imageInputs.pixel_values,
        image_embeddings: samState.imageEmbeddings,
        input_points: inputPointsTensor,
        input_labels: inputLabelsTensor,
    });

    // Post-process masks
    const originalSizes = [[originalHeight, originalWidth]];
    const reshapedInputSizes = [[Math.round(originalHeight * scale), Math.round(originalWidth * scale)]];

    const masks = await samState.processor.post_process_masks(
        outputs.pred_masks,
        originalSizes,
        reshapedInputSizes
    );

    const maskTensor = masks[0];

    // Select best mask based on iou_scores
    const scores = outputs.iou_scores.data;
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
    if (dims.length === 4) {
        h = dims[2];
        w = dims[3];
    } else {
        h = dims[1];
        w = dims[2];
    }

    const stride = h * w;
    const start = bestIndex * stride;
    const end = start + stride;
    
    // Convert to regular array for transfer
    const maskData = Array.from(maskTensor.data.slice(start, end));

    self.postMessage({
        id: messageId,
        type: 'maskGenerated',
        result: {
            data: maskData,
            width: w,
            height: h
        }
    });
}

