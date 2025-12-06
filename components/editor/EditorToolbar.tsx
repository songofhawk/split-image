import React from 'react';
import {
    Crop as CropIcon,
    Scan,
    Pen,
    Save,
    RotateCw,
    FlipHorizontal,
    Undo2,
    Target,
    Eraser,
    ImageOff,
    Grid
} from 'lucide-react';
import { EditMode } from '../../types/editor';

interface EditorToolbarProps {
    mode: EditMode;
    setMode: (mode: EditMode) => void;
    currentStep: number;
    isLoading: boolean;
    onUndo: () => void;
    onRotate: () => void;
    onFlipHorizontal: () => void;
    onSave: () => void;
    onSplit: () => void;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
    mode,
    setMode,
    currentStep,
    isLoading,
    onUndo,
    onRotate,
    onFlipHorizontal,
    onSave,
    onSplit
}) => {
    const toggleMode = (newMode: EditMode) => {
        setMode(mode === newMode ? null : newMode);
    };

    const toolButtonClass = (targetMode: EditMode) =>
        `p-2 rounded-lg transition-colors ${mode === targetMode
            ? 'bg-cyan-500/20 text-cyan-400'
            : 'text-slate-400 hover:text-white hover:bg-slate-800'
        }`;

    return (
        <div className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-4">
            <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-white">Edit</h2>
                <div className="h-6 w-px bg-slate-700"></div>

                <div className="flex gap-1">
                    {/* Basic Tools */}
                    <button
                        onClick={() => toggleMode('CROP')}
                        className={toolButtonClass('CROP')}
                        title="Crop"
                    >
                        <CropIcon className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => toggleMode('RESIZE')}
                        className={toolButtonClass('RESIZE')}
                        title="Resize"
                    >
                        <Scan className="w-5 h-5" />
                    </button>

                    <div className="h-6 w-px bg-slate-700 mx-2 self-center"></div>

                    {/* Drawing / Erasing */}
                    <button
                        onClick={() => toggleMode('ANNOTATE')}
                        className={toolButtonClass('ANNOTATE')}
                        title="Draw"
                    >
                        <Pen className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => toggleMode('PIXEL_EDIT')}
                        className={toolButtonClass('PIXEL_EDIT')}
                        title="Pixel Eraser"
                    >
                        <Eraser className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => toggleMode('BACKGROUND')}
                        className={toolButtonClass('BACKGROUND')}
                        title="Background Removal"
                    >
                        <ImageOff className="w-5 h-5" />
                    </button>

                    <div className="h-6 w-px bg-slate-700 mx-2 self-center"></div>

                    {/* AI Tools */}
                    <button
                        onClick={() => toggleMode('SEGMENT')}
                        className={toolButtonClass('SEGMENT')}
                        title="Segment Anything"
                    >
                        <Target className="w-5 h-5" />
                    </button>

                    <div className="h-6 w-px bg-slate-700 mx-2 self-center"></div>

                    {/* Transform */}
                    <button
                        onClick={onRotate}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Rotate 90°"
                    >
                        <RotateCw className="w-5 h-5" />
                    </button>
                    <button
                        onClick={onFlipHorizontal}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Flip Horizontal"
                    >
                        <FlipHorizontal className="w-5 h-5" />
                    </button>

                    <div className="h-6 w-px bg-slate-700 mx-2 self-center"></div>

                    {/* Actions */}
                    <button
                        onClick={onSplit}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Split"
                    >
                        <Grid className="w-5 h-5" />
                    </button>
                    <button
                        onClick={onSave}
                        disabled={isLoading}
                        className={`p-2 rounded-lg transition-colors ${isLoading
                            ? 'text-slate-600 cursor-not-allowed'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                        title="Save"
                    >
                        <Save className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={onUndo}
                    disabled={currentStep === 0 || isLoading}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${currentStep === 0
                        ? 'text-slate-600 cursor-not-allowed'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                    title="Undo"
                >
                    <Undo2 className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};

