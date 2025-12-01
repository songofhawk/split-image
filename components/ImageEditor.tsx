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
    Sparkles
} from 'lucide-react';
import { floodFill, removeBackgroundAuto } from '../services/imageProcessing';

interface ImageEditorProps {
    imageSrc: string;
    onSave: (newSrc: string) => void;
    onCancel: () => void;
}

type EditMode = 'CROP' | 'RESIZE' | 'ANNOTATE' | 'BACKGROUND' | null;

export const ImageEditor: React.FC<ImageEditorProps> = ({ imageSrc, onSave, onCancel }) => {
    // History Stack
    const [history, setHistory] = useState<string[]>([imageSrc]);
    const [currentStep, setCurrentStep] = useState(0);

    const currentSrc = history[currentStep];

    const [mode, setMode] = useState<EditMode>(null);
    const [isLoading, setIsLoading] = useState(false);

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

    // Initialize resize dims when image loads
    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        setResizeDims({ width, height });
        setCrop(undefined); // Reset crop on new image load
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
        if ((mode === 'ANNOTATE' || (mode === 'BACKGROUND' && bgTool === 'magic')) && canvasRef.current && imgRef.current) {
            const canvas = canvasRef.current;
            canvas.width = imgRef.current.width;
            canvas.height = imgRef.current.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = color;
                ctx.lineWidth = lineWidth;
                // Draw the current image onto the canvas so we can draw over it
                ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
            }
        }
    }, [mode, currentSrc, bgTool]); // Re-run if mode or src changes

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
        if (mode === 'BACKGROUND') return;
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
        try {
            const newSrc = await removeBackgroundAuto(currentSrc);
            pushToHistory(newSrc);
            setMode(null);
        } catch (error) {
            console.error("Auto remove failed", error);
            alert("Failed to remove background automatically.");
        } finally {
            setIsLoading(false);
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

        // We don't push to history immediately on every click to allow multiple clicks?
        // Or maybe we do? Let's do it for simplicity for now, or maybe just update the canvas and have an "Apply" button?
        // The current structure for Annotate uses an "Apply" button. Let's stick to that pattern.
        // Actually, floodFill modifies the canvas in place.
    };

    const applyBackgroundChanges = () => {
        if (canvasRef.current) {
            pushToHistory(canvasRef.current.toDataURL('image/png'));
            setMode(null);
            setBgTool(null);
        }
    };


    return (
        <div className="flex flex-col h-full w-full bg-slate-950">
            {/* Toolbar */}
            <div className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-white">Edit Image</h2>
                    <div className="h-6 w-px bg-slate-700"></div>

                    <div className="flex gap-2">
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
                        <button
                            onClick={() => setMode(mode === 'ANNOTATE' ? null : 'ANNOTATE')}
                            className={`p-2 rounded-lg transition-colors ${mode === 'ANNOTATE' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            title="Annotate"
                        >
                            <Pen className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setMode(mode === 'BACKGROUND' ? null : 'BACKGROUND')}
                            className={`p-2 rounded-lg transition-colors ${mode === 'BACKGROUND' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                            title="Background Removal"
                        >
                            <Eraser className="w-5 h-5" />
                        </button>

                        <div className="h-6 w-px bg-slate-700 mx-2"></div>

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
                        <button
                            onClick={() => flipImage('vertical')}
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            title="Flip Vertical"
                        >
                            <FlipVertical className="w-5 h-5" />
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
                        <span className="text-sm">Undo</span>
                    </button>
                    <div className="h-6 w-px bg-slate-700 mx-2"></div>

                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-slate-300 hover:text-white font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(currentSrc)}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Save className="w-4 h-4" />
                        Done
                    </button>
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 overflow-auto p-8 flex items-center justify-center relative bg-[url('https://media.istockphoto.com/id/1133442802/vector/checkered-geometric-vector-background-with-black-and-gray-tile-transparent-grid-empty.jpg?s=612x612&w=0&k=20&c=6s3f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7')] bg-repeat">
                {/* Checkered background for transparency visibility */}
                <div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==')] opacity-20 pointer-events-none"></div>

                {isLoading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
                            <p className="text-cyan-400 font-medium animate-pulse">Removing Background...</p>
                        </div>
                    </div>
                )}

                {/* Mode Specific Controls Overlay */}
                {mode === 'RESIZE' && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 p-4 rounded-xl shadow-xl flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-slate-400">Width</label>
                                <input
                                    type="number"
                                    value={resizeDims.width}
                                    onChange={(e) => handleResizeChange(e, 'width')}
                                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white w-24"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-slate-400">Height</label>
                                <input
                                    type="number"
                                    value={resizeDims.height}
                                    onChange={(e) => handleResizeChange(e, 'height')}
                                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white w-24"
                                />
                            </div>
                            <div className="flex items-center gap-2 pt-4">
                                <input
                                    type="checkbox"
                                    checked={maintainAspect}
                                    onChange={(e) => setMaintainAspect(e.target.checked)}
                                    id="aspect"
                                />
                                <label htmlFor="aspect" className="text-sm text-slate-300">Lock Ratio</label>
                            </div>
                        </div>

                        {/* Presets */}
                        <div className="flex gap-2 justify-center border-t border-slate-800 pt-3">
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

                        <div className="w-full">
                            <button onClick={applyResize} className="w-full p-2 bg-cyan-600 rounded-lg text-white hover:bg-cyan-500 flex justify-center items-center gap-2">
                                <Check className="w-4 h-4" /> Apply Resize
                            </button>
                        </div>
                    </div>
                )}

                {mode === 'ANNOTATE' && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 p-2 rounded-xl shadow-xl flex items-center gap-2">
                        <input
                            type="color"
                            value={color}
                            onChange={(e) => setColor(e.target.value)}
                            className="w-8 h-8 rounded cursor-pointer bg-transparent border-none"
                        />
                        <input
                            type="range"
                            min="1"
                            max="20"
                            value={lineWidth}
                            onChange={(e) => setLineWidth(parseInt(e.target.value))}
                            className="w-24"
                        />
                        <div className="h-6 w-px bg-slate-700 mx-2"></div>
                        <button onClick={applyAnnotation} className="p-2 bg-cyan-600 rounded-lg text-white hover:bg-cyan-500">
                            <Check className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {mode === 'BACKGROUND' && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 p-2 rounded-xl shadow-xl flex items-center gap-3">
                        <button
                            onClick={handleAutoRemoveBg}
                            className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-500 hover:to-pink-500 transition-all"
                        >
                            <Sparkles className="w-4 h-4" />
                            Auto AI
                        </button>

                        <div className="h-6 w-px bg-slate-700"></div>

                        <button
                            onClick={() => setBgTool(bgTool === 'magic' ? null : 'magic')}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${bgTool === 'magic' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-300 hover:bg-slate-800'}`}
                        >
                            <Wand2 className="w-4 h-4" />
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
                                <button onClick={applyBackgroundChanges} className="p-2 bg-cyan-600 rounded-lg text-white hover:bg-cyan-500 ml-2">
                                    <Check className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {mode === 'CROP' && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 p-2 rounded-xl shadow-xl flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-300 px-2">Drag to crop</span>
                            <button onClick={applyCrop} className="p-2 bg-cyan-600 rounded-lg text-white hover:bg-cyan-500">
                                <Check className="w-4 h-4" />
                            </button>
                        </div>
                        {/* Aspect Ratio Presets */}
                        <div className="flex gap-1 border-t border-slate-800 pt-2">
                            <button onClick={() => setAspectCrop(undefined)} className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">Free</button>
                            <button onClick={() => setAspectCrop(1)} className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">1:1</button>
                            <button onClick={() => setAspectCrop(4 / 3)} className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">4:3</button>
                            <button onClick={() => setAspectCrop(16 / 9)} className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">16:9</button>
                        </div>
                    </div>
                )}

                {/* Image / Canvas Display */}
                <div className="relative shadow-2xl">
                    {mode === 'CROP' ? (
                        <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)}>
                            <img ref={imgRef} src={currentSrc} onLoad={onImageLoad} alt="Edit" className="max-h-[70vh] max-w-full object-contain" />
                        </ReactCrop>
                    ) : (mode === 'ANNOTATE' || (mode === 'BACKGROUND' && bgTool === 'magic')) ? (
                        <>
                            {/* Hidden img to maintain size reference if needed, but we draw on canvas */}
                            <img ref={imgRef} src={currentSrc} className="hidden" onLoad={onImageLoad} alt="Ref" />
                            <canvas
                                ref={canvasRef}
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                className={`max-h-[70vh] max-w-full object-contain ${bgTool === 'magic' ? 'cursor-crosshair' : 'cursor-crosshair'}`}
                            />
                        </>
                    ) : (
                        <img ref={imgRef} src={currentSrc} onLoad={onImageLoad} alt="Edit" className="max-h-[70vh] max-w-full object-contain" />
                    )}
                </div>
            </div>
        </div>
    );
};
