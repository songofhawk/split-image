import React from 'react';
import { Check, Sparkles, Loader2 } from 'lucide-react';
import { SamModelType, SamMaskData } from '../../../types/editor';

interface SegmentOptionsProps {
    samModel: SamModelType;
    pointsCount: number;
    hasMask: boolean;
    isLoading: boolean;
    isGeneratingMask: boolean;
    onModelChange: (model: SamModelType) => void;
    onGenerateMask: () => void;
    onApply: () => void;
}

export const SegmentOptions: React.FC<SegmentOptionsProps> = ({
    samModel,
    pointsCount,
    hasMask,
    isLoading,
    isGeneratingMask,
    onModelChange,
    onGenerateMask,
    onApply
}) => {
    return (
        <div className="flex items-center gap-4 animate-in slide-in-from-top-2 fade-in duration-200">
            <select
                value={samModel}
                onChange={(e) => onModelChange(e.target.value as SamModelType)}
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
                onClick={onGenerateMask}
                disabled={pointsCount === 0 || isLoading || isGeneratingMask}
                className="flex items-center gap-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs"
            >
                {isGeneratingMask ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                    <Sparkles className="w-3 h-3" />
                )}
                {isGeneratingMask ? 'Generating...' : 'Generate Mask'}
            </button>

            <div className="h-4 w-px bg-slate-700"></div>

            <button
                onClick={onApply}
                disabled={!hasMask || isLoading || isGeneratingMask}
                className="px-3 py-1 bg-cyan-600 rounded text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center gap-1"
            >
                <Check className="w-3 h-3" /> Apply
            </button>
        </div>
    );
};


