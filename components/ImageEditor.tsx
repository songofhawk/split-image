import React, { useState, useRef, useEffect } from 'react';
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
    Crop as CropIcon,
    Maximize,
    Pen,
    Save,
    RotateCcw,
    Check,
    RotateCw,
    FlipHorizontal,
    FlipVertical,
    Undo2,
    Eraser,
    Wand2,
    Sparkles,
    Scan,
    ZoomIn,
    ZoomOut,
    MousePointer2,
    Scissors,
    Hand
} from 'lucide-react';
import { floodFill, removeBackgroundAuto, filterLargestComponent } from '../services/imageProcessing';
import { loadSAMModel, computeEmbeddings, generateMask, SAM_MODELS } from '../services/samService';

interface ImageEditorProps {
    imageSrc: string;
    onSave: (newSrc: string) => void;
    onSplit: (newSrc: string) => void;
    onCancel: () => void;
}

type EditMode = 'CROP' | 'RESIZE' | 'ANNOTATE' | 'BACKGROUND' | 'SEGMENT' | 'PIXEL_EDIT' | null;

export const ImageEditor: React.FC<ImageEditorProps> = ({ imageSrc, onSave, onSplit, onCancel }) => {
    // History Stack
    const [history, setHistory] = useState<string[]>([imageSrc]);
    const [currentStep, setCurrentStep] = useState(0);

    const currentSrc = history[currentStep];

    const [mode, setMode] = useState<EditMode>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState<string | null>(null);

    // Crop State
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);

    // Resize State
    const [resizeDims, setResizeDims] = useState({ width: 0, height: 0 });
    const [maintainAspect, setMaintainAspect] = useState(true);

    // Annotate State
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState('#ff0000');
    const [lineWidth, setLineWidth] = useState(4);

    // Background State
    const [bgTool, setBgTool] = useState<'magic' | null>(null);
    const [tolerance, setTolerance] = useState(30);

    // Segment State
    const [samPoints, setSamPoints] = useState<{ x: number, y: number, label: number }[]>([]);
    const [samMask, setSamMask] = useState<{ data: Float32Array | any, width: number, height: number } | null>(null);
    const [isSamReady, setIsSamReady] = useState(false);
    const [isSamInitializing, setIsSamInitializing] = useState(false);
    const [samModel, setSamModel] = useState<'FAST' | 'HIGH_QUALITY'>('FAST');

    // Zoom & Pan State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

    // Pixel Edit State
    const [pixelBrushSize, setPixelBrushSize] = useState(10);
    const [isErasingPixel, setIsErasingPixel] = useState(false);
    const [pixelMode, setPixelMode] = useState<'ERASE' | 'RESTORE'>('ERASE');

    // Initialize resize dims when image loads
    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        setResizeDims({ width, height });
        setCrop(undefined); // Reset crop on new image load

        // Reset SAM state on new image
        setSamPoints([]);
        setSamMask(null);
        setIsSamReady(false);

        // Only reset zoom if history is at start (new image loaded)
        if (history.length === 1) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
        }
    };

    // --- History Helper ---
    const pushToHistory = (newSrc: string) => {
        const newHistory = history.slice(0, currentStep + 1);
        newHistory.push(newSrc);
        setHistory(newHistory);
        setCurrentStep(newHistory.length - 1);
    };

    const handleUndo = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
            setMode(null); // Exit any active mode
            setSamPoints([]);
            setSamMask(null);
        }
    };

    // --- Crop Logic ---
    const applyCrop = () => {
        if (completedCrop && imgRef.current) {
            const canvas = document.createElement('canvas');
            const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
            const scaleY = imgRef.current.naturalHeight / imgRef.current.height;
            canvas.width = completedCrop.width * scaleX;
            canvas.height = completedCrop.height * scaleY;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.drawImage(
                imgRef.current,
                completedCrop.x * scaleX,
                completedCrop.y * scaleY,
                completedCrop.width * scaleX,
                completedCrop.height * scaleY,
                0,
                0,
                completedCrop.width * scaleX,
                completedCrop.height * scaleY
            );

            pushToHistory(canvas.toDataURL('image/png'));
            setMode(null);
        }
    };

    const setAspectCrop = (aspect: number | undefined) => {
        if (!imgRef.current) return;
        const { width, height } = imgRef.current;

        if (aspect) {
            const crop = centerCrop(
                makeAspectCrop(
                    {
                        unit: '%',
                        width: 90,
                    },
                    aspect,
                    width,
                    height
                ),
                width,
                height
            );
            setCrop(crop);
        } else {
            setCrop(undefined);
        }
    };

    // --- Resize Logic ---
    const handleResizeChange = (e: React.ChangeEvent<HTMLInputElement>, dim: 'width' | 'height') => {
        const val = parseInt(e.target.value) || 0;
        if (maintainAspect && imgRef.current) {
            const aspect = imgRef.current.naturalWidth / imgRef.current.naturalHeight;
            if (dim === 'width') {
                setResizeDims({ width: val, height: Math.round(val / aspect) });
            } else {
                setResizeDims({ width: Math.round(val * aspect), height: val });
            }
        } else {
            setResizeDims(prev => ({ ...prev, [dim]: val }));
        }
    };

    const setResizePercent = (percent: number) => {
        if (!imgRef.current) return;
        const w = Math.round(imgRef.current.naturalWidth * (percent / 100));
        const h = Math.round(imgRef.current.naturalHeight * (percent / 100));
        setResizeDims({ width: w, height: h });
    };

    const applyResize = () => {
        if (!imgRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = resizeDims.width;
        canvas.height = resizeDims.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(imgRef.current, 0, 0, resizeDims.width, resizeDims.height);
        pushToHistory(canvas.toDataURL('image/png'));
        setMode(null);
    };

    // --- Rotate / Flip Logic ---
    const rotateImage = () => {
        if (!imgRef.current) return;
        const canvas = document.createElement('canvas');
        // Swap width and height for 90deg rotation
        canvas.width = imgRef.current.naturalHeight;
        canvas.height = imgRef.current.naturalWidth;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(90 * Math.PI / 180);
        ctx.drawImage(imgRef.current, -imgRef.current.naturalWidth / 2, -imgRef.current.naturalHeight / 2);

        pushToHistory(canvas.toDataURL('image/png'));
    };

    const flipImage = (direction: 'horizontal' | 'vertical') => {
        if (!imgRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = imgRef.current.naturalWidth;
        canvas.height = imgRef.current.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (direction === 'horizontal') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        } else {
            ctx.translate(0, canvas.height);
            ctx.scale(1, -1);
        }

        ctx.drawImage(imgRef.current, 0, 0);
        pushToHistory(canvas.toDataURL('image/png'));
    };


    // --- Annotate Logic ---
    // Initialize canvas for annotation when mode starts
    useEffect(() => {
        if ((mode === 'ANNOTATE' || (mode === 'BACKGROUND' && bgTool === 'magic') || mode === 'SEGMENT' || mode === 'PIXEL_EDIT') && canvasRef.current && imgRef.current) {
            const canvas = canvasRef.current;
            canvas.width = imgRef.current.width;
            canvas.height = imgRef.current.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Clear canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                if (mode === 'ANNOTATE') {
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = lineWidth;
                    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
                } else if (mode === 'BACKGROUND' && bgTool === 'magic') {
                    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
                } else if (mode === 'PIXEL_EDIT') {
                    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
                } else if (mode === 'SEGMENT') {
                    // For segment, we draw the image, then points, then mask
                    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);

                    // Draw Mask if exists
                    if (samMask) {
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const data = imageData.data;
                        const maskData = samMask.data;

                        for (let i = 0; i < maskData.length; i++) {
                            if (maskData[i] > 0) { // Threshold
                                const idx = i * 4;
                                // Add blue tint to masked area
                                data[idx] = data[idx] * 0.5;     // R
                                data[idx + 1] = data[idx + 1] * 0.5 + 100; // G (Greenish)
                                data[idx + 2] = data[idx + 2] * 0.5 + 200; // B (Blueish)
                                // Alpha remains same
                            }
                        }
                        ctx.putImageData(imageData, 0, 0);
                    }

                    // Draw Points
                    samPoints.forEach(p => {
                        ctx.fillStyle = p.label === 1 ? '#00ff00' : '#ff0000';
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.strokeStyle = 'white';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                    });
                }
            }
        }
    }, [mode, currentSrc, bgTool, samPoints, samMask]);

    // Update context style when color/width changes
    useEffect(() => {
        if (mode === 'ANNOTATE' && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.strokeStyle = color;
                ctx.lineWidth = lineWidth;
            }
        }
    }, [color, lineWidth, mode]);

    const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (mode === 'BACKGROUND' && bgTool === 'magic') {
            handleMagicWand(e);
            return;
        }
        if (mode === 'SEGMENT') {
            handleSamClick(e);
            return;
        }
        if (mode === 'PIXEL_EDIT') {
            setIsErasingPixel(true);
            handlePixelEraser(e);
            return;
        }

        setIsDrawing(true);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        ctx.beginPath();
        ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    };

    const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (mode === 'BACKGROUND' || mode === 'SEGMENT') return;
        if (mode === 'PIXEL_EDIT') {
            if (isErasingPixel) handlePixelEraser(e);
            return;
        }
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
        ctx.stroke();
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        setIsErasingPixel(false);
        if (mode === 'PIXEL_EDIT') {
            applyAnnotation(); // Save state on mouse up for pixel edit
        }
    };

    const applyAnnotation = () => {
        if (canvasRef.current) {
            pushToHistory(canvasRef.current.toDataURL('image/png'));
            setMode(null);
        }
    };

    // --- Background Removal Logic ---
    const handleAutoRemoveBg = async () => {
        if (!currentSrc) return;
        setIsLoading(true);
        setLoadingText("Removing background...");
        try {
            const newSrc = await removeBackgroundAuto(currentSrc);
            pushToHistory(newSrc);
            setMode(null);
        } catch (error) {
            console.error("Auto remove failed", error);
            alert("Failed to remove background automatically.");
        } finally {
            setIsLoading(false);
            setLoadingText(null);
        }
    };

    const handleMagicWand = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);

        floodFill(ctx, x, y, tolerance);
    };

    const applyBackgroundChanges = () => {
        if (canvasRef.current) {
            pushToHistory(canvasRef.current.toDataURL('image/png'));
            setMode(null);
            setBgTool(null);
        }
    };

    // --- Segment Anything Logic ---
    const initSam = async () => {
        // Prevent duplicate initialization
        if (isSamReady || isSamInitializing) {
            console.log('SAM already ready or initializing, skipping...');
            return;
        }

        setIsSamInitializing(true);
        setIsLoading(true);
        setLoadingText("Loading AI Model (this may take a while)...");
        try {
            const modelId = samModel === 'FAST'
                ? SAM_MODELS.FAST
                : SAM_MODELS.HIGH_QUALITY;

            await loadSAMModel(modelId, (progress) => {
                setLoadingText(`Loading Model: ${Math.round(progress)}%`);
            });

            setLoadingText("Computing Image Embeddings...");
            await computeEmbeddings(currentSrc);

            setIsSamReady(true);
        } catch (error) {
            console.error("SAM Init failed", error);
            alert(`初始化失败: ${error instanceof Error ? error.message : '未知错误'}`);
            setMode(null);
        } finally {
            setIsLoading(false);
            setLoadingText(null);
            setIsSamInitializing(false);
        }
    };

    const samTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleSamClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isSamReady) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();

        // Calculate scale factors (CSS size vs Actual size)
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        // Add point (Left click = positive, Shift+Click = negative)
        const label = e.shiftKey ? 0 : 1;
        const newPoints = [...samPoints, { x, y, label }];
        setSamPoints(newPoints);

        // Debounce mask generation - REMOVED for manual trigger
        // if (samTimeoutRef.current) {
        //     clearTimeout(samTimeoutRef.current);
        // }
        // samTimeoutRef.current = setTimeout(async () => { ... }, 50);
    };

    const handleGenerateMask = async () => {
        if (samPoints.length === 0) return;
        setIsLoading(true);
        setLoadingText("Generating Mask...");
        try {
            const mask = await generateMask(samPoints);
            setSamMask(mask);
        } catch (error) {
            console.error("Mask generation failed", error);
            alert("Failed to generate mask. See console for details.");
        } finally {
            setIsLoading(false);
            setLoadingText(null);
        }
    };

    const applySamMask = () => {
        if (!samMask || !imgRef.current) return;

        const canvas = document.createElement('canvas');
        canvas.width = imgRef.current.width;
        canvas.height = imgRef.current.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw original image
        ctx.drawImage(imgRef.current, 0, 0);

        // Apply mask to alpha channel
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const maskData = samMask.data;

        // Filter mask to keep only the largest connected component
        // This removes small noise artifacts
        const filteredMaskData = filterLargestComponent(maskData, samMask.width, samMask.height);

        console.log("Applying Mask:", {
            maskLength: filteredMaskData.length,
            imagePixels: data.length / 4,
            width: canvas.width,
            height: canvas.height,
            maskWidth: samMask.width,
            maskHeight: samMask.height,
            sampleValue: filteredMaskData[Math.floor(filteredMaskData.length / 2)]
        });

        if (filteredMaskData.length !== data.length / 4) {
            console.error("Mask dimensions mismatch!");
            return;
        }

        let transparentCount = 0;
        for (let i = 0; i < filteredMaskData.length; i++) {
            // If mask value <= 0.0 (logit threshold), make transparent
            // SAM logits: > 0 is foreground, < 0 is background
            if (filteredMaskData[i] <= 0.0) {
                data[i * 4 + 3] = 0;
                transparentCount++;
            }
        }
        console.log(`Made ${transparentCount} pixels transparent.`);

        ctx.putImageData(imageData, 0, 0);
        pushToHistory(canvas.toDataURL('image/png'));
        setMode(null);
        setSamPoints([]);
        setSamMask(null);
    };

    // Trigger SAM init when entering mode
    useEffect(() => {
        if (mode === 'SEGMENT' && !isSamReady && !isSamInitializing) {
            initSam();
        }
    }, [mode, isSamReady, isSamInitializing]);

    // --- Zoom / Pan Logic ---
    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            // Zoom to mouse
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = e.clientX - rect.left - rect.width / 2; // Relative to center
            const mouseY = e.clientY - rect.top - rect.height / 2;

            const delta = -e.deltaY;
            const scaleAmount = 0.1;
            const newZoom = Math.max(0.1, Math.min(10, zoom + (delta > 0 ? scaleAmount : -scaleAmount)));

            // Adjust pan to keep mouse point stationary relative to image
            // P_new = P_old + (Mouse - P_old) * (1 - Z_new/Z_old) ? 
            // Simpler: The shift in world space is (ZoomDiff * MouseOffset).
            // Since we scale from center, the mouse position moves away from center by factor.
            // We need to move it back.

            const scaleFactor = newZoom / zoom;
            const newPanX = pan.x + (mouseX - pan.x) * (1 - scaleFactor);
            const newPanY = pan.y + (mouseY - pan.y) * (1 - scaleFactor);

            setZoom(newZoom);
            setPan({ x: newPanX, y: newPanY });
        } else {
            // Pan
            setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
        }
    };

    const handleMouseDownPan = (e: React.MouseEvent) => {
        if (e.button === 1 || (e.button === 0 && e.altKey)) { // Middle click or Alt+Click
            setIsPanning(true);
            setLastMousePos({ x: e.clientX, y: e.clientY });
            e.preventDefault();
        }
    };

    const handleMouseMovePan = (e: React.MouseEvent) => {
        if (isPanning) {
            const dx = e.clientX - lastMousePos.x;
            const dy = e.clientY - lastMousePos.y;
            setPan(p => ({ x: p.x + dx, y: p.y + dy }));
            setLastMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseUpPan = () => {
        setIsPanning(false);
    };

    // --- Pixel Eraser Logic ---
    const handlePixelEraser = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || !imgRef.current) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        ctx.save();
        if (pixelMode === 'ERASE') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(x, y, pixelBrushSize / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Restore: Draw the original image back onto the canvas at this spot
            ctx.globalCompositeOperation = 'source-over';
            ctx.beginPath();
            ctx.arc(x, y, pixelBrushSize / 2, 0, Math.PI * 2);
            ctx.clip(); // Restrict drawing to the brush circle
            ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
        }
        ctx.restore();
    };


    return (
        <div className="flex flex-col h-full w-full bg-slate-950">
            {/* Toolbar */}
            <div className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-white">Edit</h2>
                    <div className="h-6 w-px bg-slate-700"></div>

                    <div className="flex gap-1">
                        {/* Basic Tools */}
                        <button
                            onClick={() => setMode(mode === 'CROP' ? null : 'CROP')}
                            className={`p-2 rounded-lg transition-colors ${mode === 'CROP' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            title="Crop"
                        >
                            <CropIcon className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setMode(mode === 'RESIZE' ? null : 'RESIZE')}
                            className={`p-2 rounded-lg transition-colors ${mode === 'RESIZE' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            title="Resize"
                        >
                            <Maximize className="w-5 h-5" />
                        </button>

                        <div className="h-6 w-px bg-slate-700 mx-2 self-center"></div>

                        {/* Drawing / Erasing */}
                        <button
                            onClick={() => setMode(mode === 'ANNOTATE' ? null : 'ANNOTATE')}
                            className={`p-2 rounded-lg transition-colors ${mode === 'ANNOTATE' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            title="Draw"
                        >
                            <Pen className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setMode(mode === 'PIXEL_EDIT' ? null : 'PIXEL_EDIT')}
                            className={`p-2 rounded-lg transition-colors ${mode === 'PIXEL_EDIT' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            title="Pixel Eraser"
                        >
                            <MousePointer2 className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setMode(mode === 'BACKGROUND' ? null : 'BACKGROUND')}
                            className={`p-2 rounded-lg transition-colors ${mode === 'BACKGROUND' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            title="Background Removal"
                        >
                            <Eraser className="w-5 h-5" />
                        </button>

                        <div className="h-6 w-px bg-slate-700 mx-2 self-center"></div>

                        {/* AI Tools */}
                        <button
                            onClick={() => setMode(mode === 'SEGMENT' ? null : 'SEGMENT')}
                            className={`p-2 rounded-lg transition-colors ${mode === 'SEGMENT' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            title="Segment Anything"
                        >
                            <Scan className="w-5 h-5" />
                        </button>

                        <div className="h-6 w-px bg-slate-700 mx-2 self-center"></div>

                        {/* Transform */}
                        <button
                            onClick={rotateImage}
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            title="Rotate 90°"
                        >
                            <RotateCw className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => flipImage('horizontal')}
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            title="Flip Horizontal"
                        >
                            <FlipHorizontal className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleUndo}
                        disabled={currentStep === 0 || isLoading}
                        className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${currentStep === 0 ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
                        title="Undo"
                    >
                        <Undo2 className="w-5 h-5" />
                    </button>

                    <div className="h-6 w-px bg-slate-700 mx-2"></div>

                    <button
                        onClick={() => onSplit(currentSrc)}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-cyan-900/20"
                    >
                        <Scissors className="w-4 h-4" />
                        Split
                    </button>

                    <button
                        onClick={() => onSave(currentSrc)}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
                    >
                        <Save className="w-4 h-4" />
                        Save
                    </button>
                </div>
            </div>

            {/* Options Bar - Dedicated space for tool options to prevent occlusion */}
            <div className="h-12 bg-slate-900 border-b border-slate-800 flex items-center justify-center px-4 relative z-40">
                {mode === 'RESIZE' && (
                    <div className="flex items-center gap-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-400">Width</label>
                            <input
                                type="number"
                                value={resizeDims.width}
                                onChange={(e) => handleResizeChange(e, 'width')}
                                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white w-20 text-xs"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-400">Height</label>
                            <input
                                type="number"
                                value={resizeDims.height}
                                onChange={(e) => handleResizeChange(e, 'height')}
                                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white w-20 text-xs"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={maintainAspect}
                                onChange={(e) => setMaintainAspect(e.target.checked)}
                                id="aspect"
                            />
                            <label htmlFor="aspect" className="text-xs text-slate-300">Lock Ratio</label>
                        </div>
                        <div className="h-4 w-px bg-slate-700 mx-2"></div>
                        <div className="flex gap-1">
                            {[25, 50, 75, 100].map(pct => (
                                <button
                                    key={pct}
                                    onClick={() => setResizePercent(pct)}
                                    className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                                >
                                    {pct}%
                                </button>
                            ))}
                        </div>
                        <div className="h-4 w-px bg-slate-700 mx-2"></div>
                        <button onClick={applyResize} className="px-3 py-1 bg-cyan-600 rounded text-white hover:bg-cyan-500 text-xs flex items-center gap-1">
                            <Check className="w-3 h-3" /> Apply
                        </button>
                    </div>
                )}

                {mode === 'ANNOTATE' && (
                    <div className="flex items-center gap-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        <input
                            type="color"
                            value={color}
                            onChange={(e) => setColor(e.target.value)}
                            className="w-6 h-6 rounded cursor-pointer bg-transparent border-none"
                        />
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">Size:</span>
                            <input
                                type="range"
                                min="1"
                                max="20"
                                value={lineWidth}
                                onChange={(e) => setLineWidth(parseInt(e.target.value))}
                                className="w-24"
                            />
                        </div>
                        <div className="h-4 w-px bg-slate-700 mx-2"></div>
                        <button onClick={applyAnnotation} className="px-3 py-1 bg-cyan-600 rounded text-white hover:bg-cyan-500 text-xs flex items-center gap-1">
                            <Check className="w-3 h-3" /> Apply
                        </button>
                    </div>
                )}

                {mode === 'PIXEL_EDIT' && (
                    <div className="flex items-center gap-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        <div className="flex bg-slate-800 rounded p-0.5 gap-1">
                            <button
                                onClick={() => setPixelMode('ERASE')}
                                className={`px-3 py-1 text-xs rounded ${pixelMode === 'ERASE' ? 'bg-red-500/20 text-red-400' : 'text-slate-400 hover:text-white'}`}
                            >
                                Erase
                            </button>
                            <button
                                onClick={() => setPixelMode('RESTORE')}
                                className={`px-3 py-1 text-xs rounded ${pixelMode === 'RESTORE' ? 'bg-green-500/20 text-green-400' : 'text-slate-400 hover:text-white'}`}
                            >
                                Restore
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">Size:</span>
                            <input
                                type="range"
                                min="1"
                                max="50"
                                value={pixelBrushSize}
                                onChange={(e) => setPixelBrushSize(parseInt(e.target.value))}
                                className="w-24"
                            />
                        </div>
                        <div className="h-4 w-px bg-slate-700 mx-2"></div>
                        <button onClick={applyAnnotation} className="px-3 py-1 bg-cyan-600 rounded text-white hover:bg-cyan-500 text-xs flex items-center gap-1">
                            <Check className="w-3 h-3" /> Apply
                        </button>
                    </div>
                )}

                {mode === 'BACKGROUND' && (
                    <div className="flex items-center gap-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        <button
                            onClick={handleAutoRemoveBg}
                            className="flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded hover:from-purple-500 hover:to-pink-500 text-xs"
                        >
                            <Sparkles className="w-3 h-3" />
                            Auto AI
                        </button>

                        <div className="h-4 w-px bg-slate-700"></div>

                        <button
                            onClick={() => setBgTool(bgTool === 'magic' ? null : 'magic')}
                            className={`flex items-center gap-2 px-3 py-1 rounded transition-colors text-xs ${bgTool === 'magic' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-300 hover:bg-slate-800'}`}
                        >
                            <Wand2 className="w-3 h-3" />
                            Magic Wand
                        </button>

                        {bgTool === 'magic' && (
                            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                                <span className="text-xs text-slate-400">Tol:</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={tolerance}
                                    onChange={(e) => setTolerance(parseInt(e.target.value))}
                                    className="w-20"
                                    title={`Tolerance: ${tolerance}`}
                                />
                                <button onClick={applyBackgroundChanges} className="px-3 py-1 bg-cyan-600 rounded text-white hover:bg-cyan-500 text-xs flex items-center gap-1 ml-2">
                                    <Check className="w-3 h-3" /> Apply
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {mode === 'SEGMENT' && (
                    <div className="flex items-center gap-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        <select
                            value={samModel}
                            onChange={(e) => setSamModel(e.target.value as 'FAST' | 'HIGH_QUALITY')}
                            className="bg-slate-800 text-white text-xs rounded px-2 py-1 border border-slate-600 outline-none"
                            disabled={isLoading}
                        >
                            <option value="FAST">Fast (SlimSAM)</option>
                            <option value="HIGH_QUALITY">High Quality (ViT-B)</option>
                        </select>

                        <div className="h-4 w-px bg-slate-700"></div>

                        <span className="text-xs text-slate-300">Click object (Shift+Click exclude)</span>

                        <div className="h-4 w-px bg-slate-700"></div>

                        <button
                            onClick={handleGenerateMask}
                            disabled={samPoints.length === 0}
                            className="flex items-center gap-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                        >
                            <Sparkles className="w-3 h-3" />
                            Generate Mask
                        </button>

                        <div className="h-4 w-px bg-slate-700"></div>

                        <button
                            onClick={applySamMask}
                            disabled={!samMask}
                            className="px-3 py-1 bg-cyan-600 rounded text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center gap-1"
                        >
                            <Check className="w-3 h-3" /> Apply
                        </button>
                    </div>
                )}

                {mode === 'CROP' && (
                    <div className="flex items-center gap-4 animate-in slide-in-from-top-2 fade-in duration-200">
                        <span className="text-xs text-slate-300">Drag to crop</span>
                        <div className="h-4 w-px bg-slate-700"></div>
                        <div className="flex gap-1">
                            <button onClick={() => setAspectCrop(undefined)} className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">Free</button>
                            <button onClick={() => setAspectCrop(1)} className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">1:1</button>
                            <button onClick={() => setAspectCrop(4 / 3)} className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">4:3</button>
                            <button onClick={() => setAspectCrop(16 / 9)} className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">16:9</button>
                        </div>
                        <div className="h-4 w-px bg-slate-700 mx-2"></div>
                        <button onClick={applyCrop} className="px-3 py-1 bg-cyan-600 rounded text-white hover:bg-cyan-500 text-xs flex items-center gap-1">
                            <Check className="w-3 h-3" /> Apply
                        </button>
                    </div>
                )}

                {!mode && (
                    <span className="text-xs text-slate-500">Select a tool to start editing</span>
                )}
            </div>

            {/* Main Area */}
            <div
                className="flex-1 overflow-hidden p-8 relative bg-slate-900 cursor-move flex items-center justify-center"
                onWheel={handleWheel}
                onMouseDown={handleMouseDownPan}
                onMouseMove={handleMouseMovePan}
                onMouseUp={handleMouseUpPan}
                onMouseLeave={handleMouseUpPan}
            >
                {/* Zoom Controls */}
                <div className="absolute bottom-4 right-4 z-50 flex flex-col gap-2 bg-slate-800/80 backdrop-blur p-2 rounded-lg border border-slate-700">
                    <button onClick={() => setZoom(z => Math.min(10, z + 0.1))} className="p-2 hover:bg-slate-700 rounded text-slate-300">
                        <ZoomIn className="w-5 h-5" />
                    </button>
                    <span className="text-xs text-center text-slate-400">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="p-2 hover:bg-slate-700 rounded text-slate-300">
                        <ZoomOut className="w-5 h-5" />
                    </button>
                    <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-2 hover:bg-slate-700 rounded text-slate-300 border-t border-slate-700 mt-1">
                        <Scan className="w-4 h-4" />
                    </button>
                </div>

                {/* Checkered background for transparency visibility - Fixed to viewport */}
                <div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==')] opacity-20 pointer-events-none"></div>

                {isLoading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
                            <p className="text-cyan-400 font-medium animate-pulse">{loadingText || "Processing..."}</p>
                        </div>
                    </div>
                )}

                {/* REMOVED FLOATING TOOLBARS - Moved to Options Bar */}

                {/* Image / Canvas Display */}
                <div
                    className="relative shadow-2xl transition-transform duration-75 ease-out origin-center"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        cursor: isPanning ? 'grabbing' : (mode === 'PIXEL_EDIT' ? 'crosshair' : 'default')
                    }}
                >
                    {mode === 'CROP' ? (
                        <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)}>
                            <img ref={imgRef} src={currentSrc} onLoad={onImageLoad} alt="Edit" className="max-h-none max-w-none" />
                        </ReactCrop>
                    ) : (
                        <>
                            {/* Show Image if NOT in a drawing mode */}
                            <img
                                ref={imgRef}
                                src={currentSrc}
                                onLoad={onImageLoad}
                                alt="Edit"
                                className={`max-h-none max-w-none ${mode === 'ANNOTATE' ||
                                        mode === 'PIXEL_EDIT' ||
                                        mode === 'SEGMENT' ||
                                        (mode === 'BACKGROUND' && bgTool !== null)
                                        ? 'pointer-events-none opacity-0 absolute'
                                        : ''
                                    }`}
                            />
                            {/* Show Canvas if IN a drawing mode */}
                            <canvas
                                ref={canvasRef}
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                className={`max-h-none max-w-none ${mode === 'ANNOTATE' ||
                                        mode === 'PIXEL_EDIT' ||
                                        mode === 'SEGMENT' ||
                                        (mode === 'BACKGROUND' && bgTool !== null)
                                        ? ''
                                        : 'hidden'
                                    }`}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
