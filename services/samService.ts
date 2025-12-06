export const SAM_MODELS = {
    FAST: 'Xenova/slimsam-77-uniform',
    HIGH_QUALITY: 'Xenova/sam-vit-b'
};

// Worker instance
let worker: Worker | null = null;
let messageId = 0;
const pendingMessages = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    onProgress?: (progress: number) => void;
}>();

function getWorker(): Worker {
    if (!worker) {
        worker = new Worker(new URL('./samWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = handleWorkerMessage;
        worker.onerror = (e) => {
            console.error('[SAM Worker Error]', e);
        };
    }
    return worker;
}

function handleWorkerMessage(e: MessageEvent) {
    const { id, type, result, error, progress } = e.data;
    const pending = pendingMessages.get(id);
    
    if (!pending) {
        console.warn('Received message for unknown id:', id);
        return;
    }

    switch (type) {
        case 'progress':
            if (pending.onProgress) {
                pending.onProgress(progress);
            }
            break;
        case 'modelLoaded':
        case 'embeddingsComputed':
        case 'maskGenerated':
            pendingMessages.delete(id);
            pending.resolve(result);
            break;
        case 'error':
            pendingMessages.delete(id);
            pending.reject(new Error(error));
            break;
    }
}

function sendMessage<T>(
    type: string,
    payload: any,
    onProgress?: (progress: number) => void
): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = String(++messageId);
        pendingMessages.set(id, { resolve, reject, onProgress });
        getWorker().postMessage({ type, payload, id });
    });
}

export const loadSAMModel = async (modelId: string, onProgress?: (progress: number) => void) => {
    await sendMessage('loadModel', { modelId }, onProgress);
};

export const computeEmbeddings = async (imageUrl: string) => {
    return sendMessage<{ width: number; height: number }>('computeEmbeddings', { imageUrl });
};

export const generateMask = async (points: { x: number, y: number, label: number }[]) => {
    return sendMessage<{ data: number[]; width: number; height: number }>('generateMask', { points });
};
