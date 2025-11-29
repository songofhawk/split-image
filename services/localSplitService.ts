import { SplitDirection } from "../types";

export interface DetectedSplits {
    rowSplits: number[];
    colSplits: number[];
}

/**
 * Detects split lines using local image processing algorithms (Canvas API).
 * Replaces the AI-based approach for faster and offline-capable splitting.
 */
export const detectSeamsLocal = async (
    imageSrc: string,
    width: number,
    height: number
): Promise<DetectedSplits> => {
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

                const rowSplits = detectAxis(imageData, SplitDirection.HORIZONTAL);
                const colSplits = detectAxis(imageData, SplitDirection.VERTICAL);

                resolve({ rowSplits, colSplits });
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = (err) => reject(err);
        img.src = imageSrc;
    });
};

const detectAxis = (
    imageData: ImageData,
    direction: SplitDirection
): number[] => {
    const { width, height, data } = imageData;
    const isHorizontal = direction === SplitDirection.HORIZONTAL;
    const limit = isHorizontal ? height : width;
    const crossLimit = isHorizontal ? width : height;

    // --- Method 1: Gap Detection (Low Variance) ---
    // Ideal for images with whitespace/padding between grid items.

    const variances = new Float32Array(limit);

    // Calculate variance for each line
    for (let i = 0; i < limit; i++) {
        let sum = 0;
        let sumSq = 0;
        let count = 0;

        // Sampling optimization
        const step = 4;

        for (let j = 0; j < crossLimit; j += step) {
            const idx = isHorizontal
                ? (i * width + j) * 4
                : (j * width + i) * 4;

            // Convert to grayscale for variance calculation
            const val = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            sum += val;
            sumSq += val * val;
            count++;
        }

        const mean = sum / count;
        // Variance = E[X^2] - (E[X])^2
        variances[i] = (sumSq / count) - (mean * mean);
    }

    // Find continuous regions of low variance
    // Threshold: Pure color is 0. Allow some noise (compression artifacts, paper texture).
    // 100 is a safe bet for "solid-ish" areas in 0-255^2 space.
    const gapThreshold = 100;
    const gaps: number[] = [];
    let inGap = false;
    let gapStart = 0;

    for (let i = 0; i < limit; i++) {
        if (variances[i] < gapThreshold) {
            if (!inGap) {
                inGap = true;
                gapStart = i;
            }
        } else {
            if (inGap) {
                inGap = false;
                const gapEnd = i - 1;
                // Only consider gaps that are wide enough (e.g. > 2px) to avoid noise
                if (gapEnd - gapStart >= 2) {
                    gaps.push(Math.floor((gapStart + gapEnd) / 2));
                }
            }
        }
    }
    // Handle gap at the very end
    if (inGap) {
        const gapEnd = limit - 1;
        if (gapEnd - gapStart >= 2) {
            gaps.push(Math.floor((gapStart + gapEnd) / 2));
        }
    }

    // --- Method 2: Gradient Detection (Edges) ---
    // Good for seamless stitches or when gaps are not solid colors.

    const scores = new Float32Array(limit);
    for (let i = 1; i < limit; i++) {
        let diffSum = 0;
        const step = 2;
        for (let j = 0; j < crossLimit; j += step) {
            const idx1 = isHorizontal ? (i * width + j) * 4 : (j * width + i) * 4;
            const idx2 = isHorizontal ? ((i - 1) * width + j) * 4 : (j * width + (i - 1)) * 4;
            const rDiff = Math.abs(data[idx1] - data[idx2]);
            const gDiff = Math.abs(data[idx1 + 1] - data[idx2 + 1]);
            const bDiff = Math.abs(data[idx1 + 2] - data[idx2 + 2]);
            diffSum += (rDiff + gDiff + bDiff);
        }
        scores[i] = diffSum / (crossLimit / step);
    }

    // Smooth scores
    const smoothedScores = new Float32Array(limit);
    const smoothWindow = 2;
    for (let i = smoothWindow; i < limit - smoothWindow; i++) {
        let sum = 0;
        for (let k = -smoothWindow; k <= smoothWindow; k++) {
            sum += scores[i + k];
        }
        smoothedScores[i] = sum / (2 * smoothWindow + 1);
    }

    // Detect Peaks
    const edges: number[] = [];
    const nonZeroScores = Array.from(smoothedScores).filter(s => s > 0);
    if (nonZeroScores.length > 0) {
        const mean = nonZeroScores.reduce((a, b) => a + b, 0) / nonZeroScores.length;
        const variance = nonZeroScores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nonZeroScores.length;
        const stdDev = Math.sqrt(variance);

        // Significantly increased threshold to avoid splitting objects inside images
        // Mean + 3.5 * StdDev targets only the most prominent lines
        const threshold = mean + 3.5 * stdDev;

        // Dynamic minimum distance: Assume grid items are not tiny.
        // e.g. at most 10 items per axis -> min distance is 1/15 of total length
        const minDistance = Math.max(50, limit / 15);

        for (let i = 1; i < limit - 1; i++) {
            if (smoothedScores[i] > threshold) {
                let isMax = true;
                const localCheck = 10; // Wider local check
                const start = Math.max(0, i - localCheck);
                const end = Math.min(limit, i + localCheck);
                for (let k = start; k < end; k++) {
                    if (smoothedScores[k] > smoothedScores[i]) {
                        isMax = false;
                        break;
                    }
                }
                if (isMax) {
                    edges.push(i);
                }
            }
        }

        // Filter edges by distance
        const filteredEdges: number[] = [];
        if (edges.length > 0) {
            // Sort by score to prefer stronger lines?
            // No, we need spatial order. But we can greedily pick strongest in a window.
            // For simplicity, let's stick to sequential but respect minDistance.

            // Better approach: Iteratively pick the highest score, remove neighbors, repeat.
            // This ensures we keep the "real" line and not a shadow, and don't skip a strong line just because a weak one came first.

            let candidates = edges.map(idx => ({ idx, score: smoothedScores[idx] }));
            candidates.sort((a, b) => b.score - a.score); // Sort by score desc

            const selected: number[] = [];

            while (candidates.length > 0) {
                const best = candidates[0];
                selected.push(best.idx);

                // Remove all candidates too close to this one
                candidates = candidates.filter(c => Math.abs(c.idx - best.idx) >= minDistance);
            }

            filteredEdges.push(...selected.sort((a, b) => a - b));
        }
        edges.splice(0, edges.length, ...filteredEdges);
    }

    // --- Method 3: Background Coverage Detection ---
    // Best for grids with solid background color (white, gray, black, etc.)
    // Checks if a line is composed almost entirely of the background color.

    const bgGaps: number[] = [];

    // Estimate background color from the edges of the image
    // Sample top-left, top-right, bottom-left, bottom-right
    const corners = [
        0,
        (width - 1) * 4,
        (width * (height - 1)) * 4,
        (width * height - 1) * 4
    ];

    // Simple heuristic: Average of corners, or just pick top-left if they vary?
    // Let's try to find the most common color among edge pixels (Mode)
    // Sampling edges
    const edgeSamples: { r: number, g: number, b: number }[] = [];
    const edgeStep = Math.max(1, Math.floor(limit / 50)); // Sample ~50 points per edge

    // Top & Bottom edges
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 50))) {
        const idxTop = x * 4;
        const idxBot = (width * (height - 1) + x) * 4;
        edgeSamples.push({ r: data[idxTop], g: data[idxTop + 1], b: data[idxTop + 2] });
        edgeSamples.push({ r: data[idxBot], g: data[idxBot + 1], b: data[idxBot + 2] });
    }
    // Left & Right edges
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 50))) {
        const idxLeft = (y * width) * 4;
        const idxRight = (y * width + width - 1) * 4;
        edgeSamples.push({ r: data[idxLeft], g: data[idxLeft + 1], b: data[idxLeft + 2] });
        edgeSamples.push({ r: data[idxRight], g: data[idxRight + 1], b: data[idxRight + 2] });
    }

    // Find median/mode color to be robust against noise/watermarks
    // Quantize colors to bucket similar ones
    const colorBuckets: { [key: string]: number } = {};
    let maxCount = 0;
    let bgColor = { r: 255, g: 255, b: 255 }; // Default white

    for (const c of edgeSamples) {
        const key = `${Math.floor(c.r / 10)},${Math.floor(c.g / 10)},${Math.floor(c.b / 10)}`;
        colorBuckets[key] = (colorBuckets[key] || 0) + 1;
        if (colorBuckets[key] > maxCount) {
            maxCount = colorBuckets[key];
            bgColor = c;
        }
    }

    // Scan for lines that match background color
    const bgThreshold = 30; // Tolerance for background color matching
    const coverageThreshold = 0.98; // Line must be 98% background

    let inBgGap = false;
    let bgGapStart = 0;

    for (let i = 0; i < limit; i++) {
        let bgMatchCount = 0;
        let totalCount = 0;
        const step = 4;

        for (let j = 0; j < crossLimit; j += step) {
            const idx = isHorizontal
                ? (i * width + j) * 4
                : (j * width + i) * 4;

            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            if (Math.abs(r - bgColor.r) < bgThreshold &&
                Math.abs(g - bgColor.g) < bgThreshold &&
                Math.abs(b - bgColor.b) < bgThreshold) {
                bgMatchCount++;
            }
            totalCount++;
        }

        const coverage = bgMatchCount / totalCount;

        if (coverage >= coverageThreshold) {
            if (!inBgGap) {
                inBgGap = true;
                bgGapStart = i;
            }
        } else {
            if (inBgGap) {
                inBgGap = false;
                const bgGapEnd = i - 1;
                if (bgGapEnd - bgGapStart >= 1) {
                    bgGaps.push(Math.floor((bgGapStart + bgGapEnd) / 2));
                }
            }
        }
    }
    if (inBgGap) {
        const bgGapEnd = limit - 1;
        if (bgGapEnd - bgGapStart >= 1) {
            bgGaps.push(Math.floor((bgGapStart + bgGapEnd) / 2));
        }
    }

    // --- Method 4: Solid Line Detection with Strict Color Complexity ---

    const solidLines: number[] = [];
    const solidLineThreshold = 30; // Moderate variance threshold

    for (let i = 0; i < limit; i++) {
        if (variances[i] < solidLineThreshold) {
            const uniqueColors = new Set<string>();
            let rSum = 0, gSum = 0, bSum = 0, count = 0;

            const step = 2;
            for (let j = 0; j < crossLimit; j += step) {
                const idx = isHorizontal ? (i * width + j) * 4 : (j * width + i) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];

                // Quantize to 32 levels for stricter matching
                const key = `${Math.floor(r / 32)},${Math.floor(g / 32)},${Math.floor(b / 32)}`;
                uniqueColors.add(key);

                rSum += r; gSum += g; bSum += b;
                count++;
            }

            // STRICT: True split lines should have very few colors (2-3 max)
            if (uniqueColors.size <= 3) {
                const rAvg = rSum / count;
                const gAvg = gSum / count;
                const bAvg = bSum / count;

                const isBg = Math.abs(rAvg - bgColor.r) < bgThreshold &&
                    Math.abs(gAvg - bgColor.g) < bgThreshold &&
                    Math.abs(bAvg - bgColor.b) < bgThreshold;

                if (!isBg) {
                    solidLines.push(i);
                }
            }
        }
    }

    // Group adjacent solid lines
    const mergedSolidLines: number[] = [];
    if (solidLines.length > 0) {
        let start = solidLines[0];
        let prev = solidLines[0];
        for (let i = 1; i < solidLines.length; i++) {
            if (solidLines[i] - prev > 1) {
                mergedSolidLines.push(Math.floor((start + prev) / 2));
                start = solidLines[i];
            }
            prev = solidLines[i];
        }
        mergedSolidLines.push(Math.floor((start + prev) / 2));
    }

    // --- Combine & Filter ---

    interface Candidate {
        pos: number;
        score: number;
        type: 'solid' | 'bg' | 'gap';
    }

    let candidates: Candidate[] = [];

    // ONLY use strong signals
    for (const line of mergedSolidLines) {
        candidates.push({ pos: line, score: 200, type: 'solid' });
    }

    for (const gap of bgGaps) {
        if (!candidates.some(c => Math.abs(c.pos - gap) < 10)) {
            candidates.push({ pos: gap, score: 100, type: 'bg' });
        }
    }

    // Only add variance gaps if we have NO strong signals
    if (candidates.length === 0) {
        for (const gap of gaps) {
            candidates.push({ pos: gap, score: 50, type: 'gap' });
        }
    }

    // Sort by position
    candidates.sort((a, b) => a.pos - b.pos);

    // Filter borders
    const margin = limit * 0.02;
    candidates = candidates.filter(c => c.pos > margin && c.pos < limit - margin);

    // --- STRICT Grid Regularity Filter ---

    // Enforce minimum distance (assume max 8 items per axis)
    const absoluteMinDist = limit / 8;

    if (candidates.length > 1) {
        const filtered: Candidate[] = [candidates[0]];
        for (let i = 1; i < candidates.length; i++) {
            if (candidates[i].pos - filtered[filtered.length - 1].pos >= absoluteMinDist) {
                filtered.push(candidates[i]);
            }
        }
        candidates = filtered;
    }

    // Grid pattern matching
    if (candidates.length > 2) {
        const distances: number[] = [];
        distances.push(candidates[0].pos);
        for (let i = 0; i < candidates.length - 1; i++) {
            distances.push(candidates[i + 1].pos - candidates[i].pos);
        }

        const tolerance = limit * 0.08; // Slightly more lenient
        const clusters: { val: number, count: number, members: number[] }[] = [];

        for (const d of distances) {
            if (d < absoluteMinDist) continue;

            let found = false;
            for (const c of clusters) {
                if (Math.abs(c.val - d) < tolerance) {
                    c.count++;
                    c.members.push(d);
                    c.val = c.members.reduce((a, b) => a + b, 0) / c.members.length;
                    found = true;
                    break;
                }
            }
            if (!found) {
                clusters.push({ val: d, count: 1, members: [d] });
            }
        }

        clusters.sort((a, b) => b.count - a.count);

        if (clusters.length > 0 && clusters[0].count >= 2) {
            const baseUnit = clusters[0].val;
            const validCandidates: Candidate[] = [];

            for (const c of candidates) {
                const multiple = Math.round(c.pos / baseUnit);
                const expected = multiple * baseUnit;

                if (Math.abs(c.pos - expected) < tolerance) {
                    validCandidates.push(c);
                }
            }

            if (validCandidates.length > 0) {
                candidates = validCandidates;
            }
        }
    }

    return candidates.map(c => c.pos).sort((a, b) => a - b);
};
