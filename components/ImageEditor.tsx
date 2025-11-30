import React, { useState, useRef, useEffect } from 'react';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Crop as CropIcon, Maximize, Pen, Save, X, Check, RotateCcw, Type } from 'lucide-react';

interface ImageEditorProps {
    imageSrc: string;
    onSave: (newSrc: string) => void;
    onCancel: () => void;
}

type EditMode = 'CROP' | 'RESIZE' | 'ANNOTATE' | null;

export const ImageEditor: React.FC<ImageEditorProps> = ({ imageSrc, onSave, onCancel }) => {
    const [currentSrc, setCurrentSrc] = useState(imageSrc);
    const [mode, setMode] = useState<EditMode>(null);

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

    // Initialize resize dims when image loads
    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        setResizeDims({ width, height });
        setCrop(undefined); // Reset crop on new image load
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

            setCurrentSrc(canvas.toDataURL('image/png'));
            setMode(null);
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

    const applyResize = () => {
        if (!imgRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = resizeDims.width;
        canvas.height = resizeDims.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(imgRef.current, 0, 0, resizeDims.width, resizeDims.height);
        setCurrentSrc(canvas.toDataURL('image/png'));
        setMode(null);
    };

    // --- Annotate Logic ---
    // Initialize canvas for annotation when mode starts
    useEffect(() => {
        if (mode === 'ANNOTATE' && canvasRef.current && imgRef.current) {
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
    }, [mode, currentSrc]); // Re-run if mode or src changes

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
            setCurrentSrc(canvasRef.current.toDataURL('image/png'));
            setMode(null);
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
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-slate-300 hover:text-white font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(currentSrc)}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors"
                    >
                        <Save className="w-4 h-4" />
                        Done
                    </button>
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 overflow-auto p-8 flex items-center justify-center relative bg-black/50">

                {/* Mode Specific Controls Overlay */}
                {mode === 'RESIZE' && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 p-4 rounded-xl shadow-xl flex items-center gap-4">
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
                        <div className="h-8 w-px bg-slate-700 mx-2"></div>
                        <button onClick={applyResize} className="p-2 bg-cyan-600 rounded-lg text-white hover:bg-cyan-500">
                            <Check className="w-4 h-4" />
                        </button>
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

                {mode === 'CROP' && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 p-2 rounded-xl shadow-xl flex items-center gap-2">
                        <span className="text-sm text-slate-300 px-2">Drag to crop</span>
                        <button onClick={applyCrop} className="p-2 bg-cyan-600 rounded-lg text-white hover:bg-cyan-500">
                            <Check className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* Image / Canvas Display */}
                <div className="relative shadow-2xl">
                    {mode === 'CROP' ? (
                        <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)}>
                            <img ref={imgRef} src={currentSrc} onLoad={onImageLoad} alt="Edit" className="max-h-[70vh] max-w-full object-contain" />
                        </ReactCrop>
                    ) : mode === 'ANNOTATE' ? (
                        <>
                            {/* Hidden img to maintain size reference if needed, but we draw on canvas */}
                            <img ref={imgRef} src={currentSrc} className="hidden" onLoad={onImageLoad} alt="Ref" />
                            <canvas
                                ref={canvasRef}
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                className="max-h-[70vh] max-w-full object-contain cursor-crosshair"
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
