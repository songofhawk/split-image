import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

// Types
import {
    EditMode,
    BgToolType,
    PixelEditMode,
    SamModelType,
    SamPoint,
    SamMaskData,
    ResizeDimensions
} from '../types/editor';

// Hooks
import { useImageHistory } from '../hooks/useImageHistory';
import { useZoomPan } from '../hooks/useZoomPan';
import { useCanvasCoordinates } from '../hooks/useCanvasCoordinates';

// Components
import { EditorToolbar } from './editor/EditorToolbar';
import { EditorOptionsBar } from './editor/EditorOptionsBar';
import { EditorCanvas } from './editor/EditorCanvas';
import { ZoomControls } from './editor/ZoomControls';

// Services
import { floodFill, removeBackgroundAuto, filterLargestComponent } from '../services/imageProcessing';
import { loadSAMModel, computeEmbeddings, generateMask, SAM_MODELS } from '../services/samService';

interface ImageEditorProps {
    imageSrc: string;
    onSave: (newSrc: string) => void;
    onSplit: (newSrc: string) => void;
    onCancel: () => void;
}

export const ImageEditor: React.FC<ImageEditorProps> = ({ imageSrc, onSave, onSplit, onCancel }) => {
    // --- Refs ---
    const imgRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // --- History Hook ---
    const {
        currentSrc,
        history,
        currentStep,
        pushToHistory,
        handleUndo,
        canUndo
    } = useImageHistory({ initialSrc: imageSrc });

    // --- Original Image Ref (for RESTORE functionality) ---
    const originalImgRef = useRef<HTMLImageElement | null>(null);

    // --- Mode State ---
    const [mode, setMode] = useState<EditMode>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState<string | null>(null);

    // --- Zoom & Pan Hook ---
    const {
        zoom,
        setZoom,
        pan,
        setPan,
        isPanning,
        handleMouseDownPan,
        handleMouseMovePan,
        handleMouseUpPan,
        zoomIn,
        zoomOut,
        resetView
    } = useZoomPan({
        containerRef,
        disabled: mode === 'CROP'
    });

    // --- Canvas Coordinates Hook ---
    const { getCanvasCoordinates } = useCanvasCoordinates({
        imgRef,
        zoom,
        pan
    });

    // --- Crop State ---
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();

    // --- Resize State ---
    const [resizeDims, setResizeDims] = useState<ResizeDimensions>({ width: 0, height: 0 });
    const [maintainAspect, setMaintainAspect] = useState(true);

    // --- Annotate State ---
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState('#ff0000');
    const [lineWidth, setLineWidth] = useState(4);

    // --- Background State ---
    const [bgTool, setBgTool] = useState<BgToolType>(null);
    const [tolerance, setTolerance] = useState(30);

    // --- Segment State ---
    const [samPoints, setSamPoints] = useState<SamPoint[]>([]);
    const [samMask, setSamMask] = useState<SamMaskData | null>(null);
    const [isSamReady, setIsSamReady] = useState(false);
    const [isSamInitializing, setIsSamInitializing] = useState(false);
    const [samModel, setSamModel] = useState<SamModelType>('FAST');

    // --- Pixel Edit State ---
    const [pixelBrushSize, setPixelBrushSize] = useState(10);
    const [isErasingPixel, setIsErasingPixel] = useState(false);
    const [pixelMode, setPixelMode] = useState<PixelEditMode>('ERASE');

    // --- Canvas Modified State (track unsaved changes) ---
    const [canvasModified, setCanvasModified] = useState(false);

    // ========================
    // 工具状态统一管理
    // ========================
    
    // 判断某个模式是否是 canvas 编辑模式（直接在 canvas 上操作）
    const isCanvasEditMode = useCallback((m: EditMode, bg: BgToolType = null): boolean => {
        return m === 'ANNOTATE' || m === 'PIXEL_EDIT' || (m === 'BACKGROUND' && bg === 'magic');
    }, []);

    // 判断某个模式是否需要清理透明像素的 RGB 值
    const needsTransparencyCleanup = useCallback((m: EditMode, bg: BgToolType = null): boolean => {
        return m === 'PIXEL_EDIT' || (m === 'BACKGROUND' && bg === 'magic');
    }, []);

    // 清理透明像素的 RGB 值（设为 0,0,0）
    const cleanupTransparentPixels = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }, []);

    // 保存当前 canvas 到 history
    const saveCanvasToHistory = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;

        // 如果需要清理透明像素
        if (needsTransparencyCleanup(mode, bgTool)) {
            cleanupTransparentPixels(ctx, canvas.width, canvas.height);
        }

        pushToHistory(canvas.toDataURL('image/png'));
        setCanvasModified(false);
        return true;
    }, [mode, bgTool, needsTransparencyCleanup, cleanupTransparentPixels, pushToHistory]);

    // --- Image Load Handler ---
    const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        setResizeDims({ width, height });
        setCrop(undefined);

        // Reset SAM state on new image
        setSamPoints([]);
        setSamMask(null);
        setIsSamReady(false);

        // Only reset zoom if history is at start (new image loaded)
        if (history.length === 1) {
            resetView();
        }
    }, [history.length, resetView]);

    // --- Load Original Image for RESTORE ---
    useEffect(() => {
        if (history.length > 0 && history[0]) {
            const img = new Image();
            img.src = history[0];
            img.onload = () => {
                originalImgRef.current = img;
            };
        }
    }, [history[0]]);

    // --- Mode Change Handler ---
    const handleModeChange = useCallback((newMode: EditMode) => {
        // 统一规则：从任何 canvas 编辑模式切换出去时，如果有未保存的修改，自动保存
        if (isCanvasEditMode(mode, bgTool) && canvasModified) {
            saveCanvasToHistory();
        }

        setMode(newMode);
        if (newMode !== 'SEGMENT') {
            setSamPoints([]);
            setSamMask(null);
        }
        if (newMode !== 'BACKGROUND') {
            setBgTool(null);
        }
    }, [mode, bgTool, canvasModified, isCanvasEditMode, saveCanvasToHistory]);

    // --- Undo with Mode Reset ---
    const handleUndoWithReset = useCallback(() => {
        handleUndo();
        setMode(null);
        setSamPoints([]);
        setSamMask(null);
        setCanvasModified(false);
    }, [handleUndo]);

    // ========================
    // Crop Logic
    // ========================
    const setAspectCrop = useCallback((aspect: number | undefined) => {
        if (!imgRef.current) return;
        const { width, height } = imgRef.current;

        if (aspect) {
            const newCrop = centerCrop(
                makeAspectCrop({ unit: '%', width: 90 }, aspect, width, height),
                width,
                height
            );
            setCrop(newCrop);
        } else {
            setCrop(undefined);
        }
    }, []);

    const applyCrop = useCallback(() => {
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
                0, 0,
                completedCrop.width * scaleX,
                completedCrop.height * scaleY
            );

            pushToHistory(canvas.toDataURL('image/png'));
            setMode(null);
        }
    }, [completedCrop, pushToHistory]);

    // ========================
    // Resize Logic
    // ========================
    const handleResizeDimensionChange = useCallback((dim: 'width' | 'height', value: number) => {
        if (maintainAspect && imgRef.current) {
            const aspect = imgRef.current.naturalWidth / imgRef.current.naturalHeight;
            if (dim === 'width') {
                setResizeDims({ width: value, height: Math.round(value / aspect) });
            } else {
                setResizeDims({ width: Math.round(value * aspect), height: value });
            }
        } else {
            setResizeDims(prev => ({ ...prev, [dim]: value }));
        }
    }, [maintainAspect]);

    const setResizePercent = useCallback((percent: number) => {
        if (!imgRef.current) return;
        const w = Math.round(imgRef.current.naturalWidth * (percent / 100));
        const h = Math.round(imgRef.current.naturalHeight * (percent / 100));
        setResizeDims({ width: w, height: h });
    }, []);

    const applyResize = useCallback(() => {
        if (!imgRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = resizeDims.width;
        canvas.height = resizeDims.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(imgRef.current, 0, 0, resizeDims.width, resizeDims.height);
        pushToHistory(canvas.toDataURL('image/png'));
        setMode(null);
    }, [resizeDims, pushToHistory]);

    // ========================
    // Rotate / Flip Logic
    // ========================
    const rotateImage = useCallback(() => {
        if (!imgRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = imgRef.current.naturalHeight;
        canvas.height = imgRef.current.naturalWidth;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(90 * Math.PI / 180);
        ctx.drawImage(imgRef.current, -imgRef.current.naturalWidth / 2, -imgRef.current.naturalHeight / 2);

        pushToHistory(canvas.toDataURL('image/png'));
    }, [pushToHistory]);

    const flipHorizontal = useCallback(() => {
        if (!imgRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = imgRef.current.naturalWidth;
        canvas.height = imgRef.current.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(imgRef.current, 0, 0);

        pushToHistory(canvas.toDataURL('image/png'));
    }, [pushToHistory]);

    // ========================
    // Canvas Initialization Effect
    // ========================
    useEffect(() => {
        if ((mode === 'ANNOTATE' || (mode === 'BACKGROUND' && bgTool === 'magic') || mode === 'SEGMENT' || mode === 'PIXEL_EDIT') && canvasRef.current && imgRef.current) {
            const canvas = canvasRef.current;
            canvas.width = imgRef.current.width;
            canvas.height = imgRef.current.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

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
                ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);

                // Draw Mask if exists
                if (samMask) {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imageData.data;
                    const maskData = samMask.data;

                    for (let i = 0; i < maskData.length; i++) {
                        if (maskData[i] > 0) {
                            const idx = i * 4;
                            data[idx] = data[idx] * 0.5;
                            data[idx + 1] = data[idx + 1] * 0.5 + 100;
                            data[idx + 2] = data[idx + 2] * 0.5 + 200;
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
    }, [mode, currentSrc, bgTool, samPoints, samMask, color, lineWidth]);

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

    // ========================
    // Background Removal Logic
    // ========================
    const handleAutoRemoveBg = useCallback(async () => {
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
    }, [currentSrc, pushToHistory]);

    const handleMagicWand = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const coords = getCanvasCoordinates(e.clientX, e.clientY, canvas);
        const x = Math.floor(coords.x);
        const y = Math.floor(coords.y);

        floodFill(ctx, x, y, tolerance);
        setCanvasModified(true);
    }, [getCanvasCoordinates, tolerance]);

    const applyBackgroundChanges = useCallback(() => {
        if (saveCanvasToHistory()) {
            setMode(null);
            setBgTool(null);
        }
    }, [saveCanvasToHistory]);

    // ========================
    // Segment Anything Logic
    // ========================
    const initSam = useCallback(async () => {
        if (isSamReady || isSamInitializing) {
            console.log('SAM already ready or initializing, skipping...');
            return;
        }

        setIsSamInitializing(true);
        setIsLoading(true);
        setLoadingText("Loading AI Model (this may take a while)...");
        try {
            const modelId = samModel === 'FAST' ? SAM_MODELS.FAST : SAM_MODELS.HIGH_QUALITY;

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
    }, [isSamReady, isSamInitializing, samModel, currentSrc]);

    const handleSamClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isSamReady) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();

        const coords = getCanvasCoordinates(e.clientX, e.clientY, canvas);
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const x = coords.x * scaleX;
        const y = coords.y * scaleY;

        const label = e.shiftKey ? 0 : 1;
        setSamPoints(prev => [...prev, { x, y, label }]);
    }, [isSamReady, getCanvasCoordinates]);

    const handleGenerateMask = useCallback(async () => {
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
    }, [samPoints]);

    const applySamMask = useCallback(() => {
        if (!samMask || !imgRef.current) return;

        const canvas = document.createElement('canvas');
        canvas.width = imgRef.current.width;
        canvas.height = imgRef.current.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(imgRef.current, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const filteredMaskData = filterLargestComponent(samMask.data, samMask.width, samMask.height);

        if (filteredMaskData.length !== data.length / 4) {
            console.error("Mask dimensions mismatch!");
            return;
        }

        for (let i = 0; i < filteredMaskData.length; i++) {
            if (filteredMaskData[i] <= 0.0) {
                data[i * 4 + 3] = 0;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        pushToHistory(canvas.toDataURL('image/png'));
        setMode(null);
        setSamPoints([]);
        setSamMask(null);
    }, [samMask, pushToHistory]);

    // Trigger SAM init when entering mode
    useEffect(() => {
        if (mode === 'SEGMENT' && !isSamReady && !isSamInitializing) {
            initSam();
        }
    }, [mode, isSamReady, isSamInitializing, initSam]);

    // ========================
    // Pixel Eraser Logic
    // ========================
    const handlePixelEraser = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || !imgRef.current) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const coords = getCanvasCoordinates(e.clientX, e.clientY, canvas);
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / imgRef.current.width;
        const scaleY = canvas.height / imgRef.current.height;

        const x = coords.x * scaleX;
        const y = coords.y * scaleY;

        ctx.save();
        if (pixelMode === 'ERASE') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(x, y, pixelBrushSize / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // RESTORE: 从原始图像恢复，而不是从当前图像恢复
            // 这样即使经过 magic wand 或 AI 去除背景后，仍然可以恢复原始颜色
            const restoreSource = originalImgRef.current || imgRef.current;
            ctx.globalCompositeOperation = 'source-over';
            ctx.beginPath();
            ctx.arc(x, y, pixelBrushSize / 2, 0, Math.PI * 2);
            ctx.clip();
            // 需要根据原始图像尺寸正确缩放
            ctx.drawImage(restoreSource, 0, 0, canvas.width, canvas.height);
        }
        ctx.restore();
        setCanvasModified(true);
    }, [getCanvasCoordinates, pixelMode, pixelBrushSize]);

    // ========================
    // Drawing Logic
    // ========================
    const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
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

        const coords = getCanvasCoordinates(e.clientX, e.clientY, canvas);
        ctx.beginPath();
        ctx.moveTo(coords.x, coords.y);
    }, [mode, bgTool, getCanvasCoordinates, handleMagicWand, handleSamClick, handlePixelEraser]);

    const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
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

        const coords = getCanvasCoordinates(e.clientX, e.clientY, canvas);
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
        setCanvasModified(true);
    }, [mode, isDrawing, isErasingPixel, getCanvasCoordinates, handlePixelEraser]);

    const stopDrawing = useCallback(() => {
        setIsDrawing(false);
        setIsErasingPixel(false);
    }, []);

    const applyAnnotation = useCallback(() => {
        if (saveCanvasToHistory()) {
            setMode(null);
        }
    }, [saveCanvasToHistory]);

    // ========================
    // Render
    // ========================
    return (
        <div className="flex flex-col h-full w-full bg-slate-950">
            {/* Toolbar */}
            <EditorToolbar
                mode={mode}
                setMode={handleModeChange}
                currentStep={currentStep}
                isLoading={isLoading}
                canvasModified={canvasModified}
                onUndo={handleUndoWithReset}
                onRotate={rotateImage}
                onFlipHorizontal={flipHorizontal}
                onCopy={async () => {
                    try {
                        let srcToUse = currentSrc;
                        // 统一规则：如果当前是 canvas 编辑模式且有修改，先保存
                        if (isCanvasEditMode(mode, bgTool) && canvasRef.current) {
                            srcToUse = canvasRef.current.toDataURL('image/png');
                            if (canvasModified) {
                                saveCanvasToHistory();
                                setMode(null);
                            }
                        }
                        const response = await fetch(srcToUse);
                        const blob = await response.blob();
                        await navigator.clipboard.write([
                            new ClipboardItem({ [blob.type]: blob })
                        ]);
                    } catch (err) {
                        console.error('Failed to copy image:', err);
                    }
                }}
                onDownload={() => {
                    let srcToUse = currentSrc;
                    // 统一规则：如果当前是 canvas 编辑模式且有修改，先保存
                    if (isCanvasEditMode(mode, bgTool) && canvasRef.current) {
                        srcToUse = canvasRef.current.toDataURL('image/png');
                        if (canvasModified) {
                            saveCanvasToHistory();
                            setMode(null);
                        }
                    }
                    const link = document.createElement('a');
                    link.download = `edited-image-${Date.now()}.png`;
                    link.href = srcToUse;
                    link.click();
                }}
                onSplit={() => onSplit(currentSrc)}
            />

            {/* Options Bar */}
            <EditorOptionsBar
                mode={mode}
                // Crop
                onSetCropAspect={setAspectCrop}
                onApplyCrop={applyCrop}
                // Resize
                resizeDims={resizeDims}
                maintainAspect={maintainAspect}
                onResizeDimensionChange={handleResizeDimensionChange}
                onMaintainAspectChange={setMaintainAspect}
                onSetResizePercent={setResizePercent}
                onApplyResize={applyResize}
                // Annotate
                annotateColor={color}
                annotateLineWidth={lineWidth}
                onAnnotateColorChange={setColor}
                onAnnotateLineWidthChange={setLineWidth}
                onApplyAnnotation={applyAnnotation}
                // Pixel Edit
                pixelMode={pixelMode}
                pixelBrushSize={pixelBrushSize}
                onPixelModeChange={setPixelMode}
                onPixelBrushSizeChange={setPixelBrushSize}
                // Background
                bgTool={bgTool}
                tolerance={tolerance}
                onBgToolChange={setBgTool}
                onToleranceChange={setTolerance}
                onAutoRemoveBg={handleAutoRemoveBg}
                onApplyBackground={applyBackgroundChanges}
                // Segment
                samModel={samModel}
                samPointsCount={samPoints.length}
                hasSamMask={!!samMask}
                isLoading={isLoading}
                onSamModelChange={setSamModel}
                onGenerateMask={handleGenerateMask}
                onApplySamMask={applySamMask}
            />

            {/* Main Area */}
            <div
                ref={containerRef}
                className="flex-1 overflow-hidden p-8 relative bg-slate-900 cursor-move flex items-center justify-center"
                onMouseDown={handleMouseDownPan}
                onMouseMove={handleMouseMovePan}
                onMouseUp={handleMouseUpPan}
                onMouseLeave={handleMouseUpPan}
            >
                {/* Zoom Controls */}
                <ZoomControls
                    zoom={zoom}
                    onZoomIn={zoomIn}
                    onZoomOut={zoomOut}
                    onResetView={resetView}
                />

                {/* Loading Overlay */}
                {isLoading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
                            <p className="text-cyan-400 font-medium animate-pulse">{loadingText || "Processing..."}</p>
                        </div>
                    </div>
                )}

                {/* Canvas */}
                <EditorCanvas
                    mode={mode}
                    bgTool={bgTool}
                    currentSrc={currentSrc}
                    zoom={zoom}
                    pan={pan}
                    isPanning={isPanning}
                    imgRef={imgRef}
                    canvasRef={canvasRef}
                    crop={crop}
                    onCropChange={setCrop}
                    onCropComplete={setCompletedCrop}
                    onImageLoad={onImageLoad}
                    onCanvasMouseDown={startDrawing}
                    onCanvasMouseMove={draw}
                    onCanvasMouseUp={stopDrawing}
                    onCanvasMouseLeave={stopDrawing}
                />
            </div>
        </div>
    );
};
