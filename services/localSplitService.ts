import { SplitDirection } from "../types";

/**
 * Detects split lines using local image processing algorithms (Canvas API).
 * Replaces the AI-based approach for faster and offline-capable splitting.
 */
export const detectSeamsLocal = async (
    imageSrc: string,
    width: number,
    height: number,
    direction: SplitDirection = SplitDirection.HORIZONTAL
): Promise<number[]> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");

                if (!ctx) {
                    reject(new Error("Could not get canvas context"));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);
                const imageData = ctx.getImageData(0, 0, width, height);
                const splits = processImageData(imageData, direction);
                resolve(splits);
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = (err) => reject(err);
        img.src = imageSrc;
    });
};

const processImageData = (
    imageData: ImageData,
    direction: SplitDirection
): number[] => {
    const { width, height, data } = imageData;
    const isHorizontal = direction === SplitDirection.HORIZONTAL;
    const limit = isHorizontal ? height : width;
    const crossLimit = isHorizontal ? width : height;

    // Store the "energy" or "difference" score for each line
    const scores: number[] = new Array(limit).fill(0);

    // 1. Calculate difference between adjacent lines (Gradient)
    // We start from 1 because we compare with i-1
    for (let i = 1; i < limit; i++) {
        let diffSum = 0;

        // Optimization: Don't check every single pixel if image is huge
        // But for accuracy on "visible boundaries", checking all is safer.
        // We can skip alpha channel for now or assume opacity.

        for (let j = 0; j < crossLimit; j++) {
            const idx1 = isHorizontal
                ? (i * width + j) * 4
                : (j * width + i) * 4;

            const idx2 = isHorizontal
                ? ((i - 1) * width + j) * 4
                : (j * width + (i - 1)) * 4;

            // Simple Euclidean distance or Manhattan distance of RGB
            const rDiff = Math.abs(data[idx1] - data[idx2]);
            const gDiff = Math.abs(data[idx1 + 1] - data[idx2 + 1]);
            const bDiff = Math.abs(data[idx1 + 2] - data[idx2 + 2]);

            // We can weigh them or just sum
            diffSum += (rDiff + gDiff + bDiff);
        }

        // Normalize by width/height to get average pixel difference
        scores[i] = diffSum / crossLimit;
    }

    // 2. Detect Peaks
    // A split line usually has a significantly higher difference than neighbors
    // OR it is a "solid color line" which might have low difference internally but high difference at edges.
    // Let's stick to "high difference" (Gradient) for now as it covers "visible boundaries".

    // Heuristic: Calculate mean and standard deviation of scores to set a dynamic threshold
    const nonZeroScores = scores.filter(s => s > 0);
    if (nonZeroScores.length === 0) return [];

    const mean = nonZeroScores.reduce((a, b) => a + b, 0) / nonZeroScores.length;
    const variance = nonZeroScores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nonZeroScores.length;
    const stdDev = Math.sqrt(variance);

    // Threshold: This is the tricky part. 
    // If the image is very clean, boundaries are huge spikes.
    // If the image is noisy, boundaries might be buried.
    // Let's try Mean + 2 * StdDev as a starting point for "significant change".
    const threshold = mean + 1.5 * stdDev;

    const candidates: number[] = [];

    // 3. Peak extraction with Non-Maximum Suppression window
    const windowSize = 10; // Minimum distance between splits (pixels)

    for (let i = 1; i < limit - 1; i++) {
        if (scores[i] > threshold) {
            // Check if it's a local maximum
            let isMax = true;
            const start = Math.max(0, i - 5);
            const end = Math.min(limit, i + 5);

            for (let k = start; k < end; k++) {
                if (scores[k] > scores[i]) {
                    isMax = false;
                    break;
                }
            }

            if (isMax) {
                // Ensure we don't add points too close to existing ones
                if (candidates.length === 0 || i - candidates[candidates.length - 1] > windowSize) {
                    candidates.push(i);
                }
            }
        }
    }

    return candidates;
};
