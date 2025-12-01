import { removeBackground } from "@imgly/background-removal";

/**
 * Performs a flood fill operation on a canvas context.
 * Sets the alpha channel of connected pixels of similar color to 0 (transparent).
 * 
 * @param ctx The canvas 2D context
 * @param startX The starting X coordinate
 * @param startY The starting Y coordinate
 * @param tolerance The color tolerance (0-255)
 */
export const floodFill = (
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    tolerance: number
) => {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const stack = [[startX, startY]];
    const visited = new Set<string>();

    const getPixelIndex = (x: number, y: number) => (y * width + x) * 4;

    const startIdx = getPixelIndex(startX, startY);
    const startR = data[startIdx];
    const startG = data[startIdx + 1];
    const startB = data[startIdx + 2];
    const startA = data[startIdx + 3];

    // If clicking on already transparent pixel, do nothing
    if (startA === 0) return;

    const colorMatch = (idx: number) => {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        // Ignore already transparent pixels
        if (a === 0) return false;

        return (
            Math.abs(r - startR) <= tolerance &&
            Math.abs(g - startG) <= tolerance &&
            Math.abs(b - startB) <= tolerance
        );
    };

    while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        const key = `${x},${y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        const idx = getPixelIndex(x, y);

        if (colorMatch(idx)) {
            // Set alpha to 0 (transparent)
            data[idx + 3] = 0;

            // Check neighbors
            if (x > 0) stack.push([x - 1, y]);
            if (x < width - 1) stack.push([x + 1, y]);
            if (y > 0) stack.push([x, y - 1]);
            if (y < height - 1) stack.push([x, y + 1]);
        }
    }

    ctx.putImageData(imageData, 0, 0);
};

/**
 * Removes the background from an image URL using @imgly/background-removal.
 * 
 * @param imageSrc The source image URL
 * @returns A promise that resolves to the new image URL (blob URL)
 */
export const removeBackgroundAuto = async (imageSrc: string): Promise<string> => {
    try {
        const blob = await removeBackground(imageSrc);
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error("Background removal failed:", error);
        throw error;
    }
};
