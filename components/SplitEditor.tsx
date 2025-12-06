import React, { useRef, useState, useEffect } from 'react';
import { Scissors, Plus, Trash2, RefreshCcw, Columns, Rows } from 'lucide-react';
import { Dimensions, SplitDirection } from '../types';

interface SplitEditorProps {
  imageSrc: string;
  dimensions: Dimensions;
  rowSplits: number[];
  colSplits: number[];
  onConfirm: (rowSplits: number[], colSplits: number[]) => void;
  onCancel: () => void;
  onReRunDetection: () => void;
  onSplitsChange: (rows: number[], cols: number[]) => void;
  onEditImage: () => void;
}

type DragTarget = { type: 'row' | 'col'; index: number } | null;

export const SplitEditor: React.FC<SplitEditorProps> = ({
  imageSrc,
  dimensions,
  rowSplits,
  colSplits,
  onConfirm,
  onCancel,
  onReRunDetection,
  onSplitsChange,
  onEditImage
}) => {
  const [activeDrag, setActiveDrag] = useState<DragTarget>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent, type: 'row' | 'col', index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDrag({ type, index });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!activeDrag || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();

    if (activeDrag.type === 'row') {
      const scale = rect.height / dimensions.height;
      let val = (e.clientY - rect.top) / scale;
      val = Math.max(0, Math.min(val, dimensions.height));

      const newRows = [...rowSplits];
      newRows[activeDrag.index] = Math.round(val);
      onSplitsChange(newRows.sort((a, b) => a - b), colSplits);
    } else {
      const scale = rect.width / dimensions.width;
      let val = (e.clientX - rect.left) / scale;
      val = Math.max(0, Math.min(val, dimensions.width));

      const newCols = [...colSplits];
      newCols[activeDrag.index] = Math.round(val);
      onSplitsChange(rowSplits, newCols.sort((a, b) => a - b));
    }
  };

  const handleMouseUp = () => {
    setActiveDrag(null);
  };

  const addRow = () => {
    const points = [0, ...rowSplits, dimensions.height];
    let maxGap = 0;
    let insertPos = dimensions.height / 2;

    for (let i = 0; i < points.length - 1; i++) {
      const gap = points[i + 1] - points[i];
      if (gap > maxGap) {
        maxGap = gap;
        insertPos = points[i] + gap / 2;
      }
    }
    const newRows = [...rowSplits, Math.round(insertPos)].sort((a, b) => a - b);
    onSplitsChange(newRows, colSplits);
  };

  const addCol = () => {
    const points = [0, ...colSplits, dimensions.width];
    let maxGap = 0;
    let insertPos = dimensions.width / 2;

    for (let i = 0; i < points.length - 1; i++) {
      const gap = points[i + 1] - points[i];
      if (gap > maxGap) {
        maxGap = gap;
        insertPos = points[i] + gap / 2;
      }
    }
    const newCols = [...colSplits, Math.round(insertPos)].sort((a, b) => a - b);
    onSplitsChange(rowSplits, newCols);
  };

  const removeSplit = (type: 'row' | 'col', index: number) => {
    if (type === 'row') {
      onSplitsChange(rowSplits.filter((_, i) => i !== index), colSplits);
    } else {
      onSplitsChange(rowSplits, colSplits.filter((_, i) => i !== index));
    }
  };

  return (
    <div
      className="flex flex-col items-center w-full h-full"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseMove={handleMouseMove}
    >
      {/* Toolbar */}
      <div className="w-full max-w-6xl flex flex-col md:flex-row justify-between items-center mb-4 px-4 gap-4">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold text-white">Adjust Grid</h2>
          <span className="text-sm text-slate-400">
            Drag lines to adjust, click trash icon to remove.
          </span>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={onEditImage}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
            title="Crop, Resize, or Annotate Image"
          >
            <Scissors className="w-4 h-4" />
            Edit Image
          </button>

          <div className="h-8 w-px bg-slate-700 hidden md:block mx-2"></div>

          <button
            onClick={onReRunDetection}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-cyan-400 bg-cyan-950/30 border border-cyan-900 rounded-lg hover:bg-cyan-900/50 transition-colors"
            title="Run auto detection for both rows and columns"
          >
            <RefreshCcw className="w-4 h-4" />
            Auto Detect
          </button>

          <div className="h-8 w-px bg-slate-700 hidden md:block mx-2"></div>

          <button
            onClick={addRow}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
            title="Add a new horizontal line"
          >
            <Rows className="w-4 h-4" />
            Add Row
          </button>

          <button
            onClick={addCol}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
            title="Add a new vertical line"
          >
            <Columns className="w-4 h-4" />
            Add Col
          </button>
        </div>
      </div>

      {/* Editor Container */}
      <div className="relative border border-slate-700 shadow-2xl bg-black overflow-hidden select-none max-w-[90vw]">
        <div ref={containerRef} className="relative inline-block">
          {/* Main Image */}
          <img
            src={imageSrc}
            alt="Original"
            className="block pointer-events-none select-none"
            style={{
              maxHeight: '70vh',
              maxWidth: '100%',
              objectFit: 'contain'
            }}
          />

          {/* --- Render Row Splits (Horizontal Lines) --- */}
          {rowSplits.map((val, index) => {
            const pct = (val / dimensions.height) * 100;
            const isDraggingThis = activeDrag?.type === 'row' && activeDrag?.index === index;

            return (
              <div
                key={`row-${index}`}
                className="absolute group z-20"
                style={{ top: `${pct}%`, left: 0, width: '100%', height: '2px', transform: 'translateY(-50%)' }}
              >
                <div
                  className={`w-full h-full transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.8)]
                     ${isDraggingThis ? 'bg-yellow-400' : 'bg-red-500 group-hover:bg-yellow-400'}
                   `}
                />
                {/* 可拖拽区域 */}
                <div
                  className="absolute left-0 -top-[11px] w-full h-6 cursor-row-resize z-30"
                  onMouseDown={(e) => handleMouseDown(e, 'row', index)}
                />
                {/* 删除按钮 - 左侧 */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeSplit('row', index); }}
                  className="absolute left-2 -top-[11px] bg-red-600 text-white rounded-full p-1 shadow-lg transform hover:scale-110 opacity-0 group-hover:opacity-100 transition-opacity z-40"
                  title="Remove this split line"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                {/* 删除按钮 - 右侧 */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeSplit('row', index); }}
                  className="absolute right-2 -top-[11px] bg-red-600 text-white rounded-full p-1 shadow-lg transform hover:scale-110 opacity-0 group-hover:opacity-100 transition-opacity z-40"
                  title="Remove this split line"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                {/* Label */}
                <div className={`absolute left-1/2 -translate-x-1/2 -top-5 bg-red-900/80 text-[10px] text-red-100 px-1 rounded pointer-events-none whitespace-nowrap ${isDraggingThis ? 'block' : 'hidden group-hover:block'}`}>
                  Y: {val}px
                </div>
              </div>
            );
          })}

          {/* --- Render Col Splits (Vertical Lines) --- */}
          {colSplits.map((val, index) => {
            const pct = (val / dimensions.width) * 100;
            const isDraggingThis = activeDrag?.type === 'col' && activeDrag?.index === index;

            return (
              <div
                key={`col-${index}`}
                className="absolute group z-20"
                style={{ left: `${pct}%`, top: 0, height: '100%', width: '2px', transform: 'translateX(-50%)' }}
              >
                <div
                  className={`w-full h-full transition-colors shadow-[1px_0_2px_rgba(0,0,0,0.8)]
                     ${isDraggingThis ? 'bg-cyan-300' : 'bg-blue-500 group-hover:bg-cyan-300'}
                   `}
                />
                {/* 可拖拽区域 */}
                <div
                  className="absolute top-0 -left-[11px] h-full w-6 cursor-col-resize z-30"
                  onMouseDown={(e) => handleMouseDown(e, 'col', index)}
                />
                {/* 删除按钮 - 顶部 */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeSplit('col', index); }}
                  className="absolute top-2 -left-[11px] bg-blue-600 text-white rounded-full p-1 shadow-lg transform hover:scale-110 opacity-0 group-hover:opacity-100 transition-opacity z-40"
                  title="Remove this split line"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                {/* 删除按钮 - 底部 */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeSplit('col', index); }}
                  className="absolute bottom-2 -left-[11px] bg-blue-600 text-white rounded-full p-1 shadow-lg transform hover:scale-110 opacity-0 group-hover:opacity-100 transition-opacity z-40"
                  title="Remove this split line"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                {/* Label */}
                <div className={`absolute top-2 left-2 bg-blue-900/80 text-[10px] text-blue-100 px-1 rounded pointer-events-none whitespace-nowrap ${isDraggingThis ? 'block' : 'hidden group-hover:block'}`}>
                  X: {val}px
                </div>
              </div>
            );
          })}

        </div>
      </div>

      <div className="mt-6 flex gap-4">
        <button
          onClick={onCancel}
          className="px-6 py-3 rounded-xl font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => onConfirm(rowSplits, colSplits)}
          className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-500 via-purple-500 to-orange-500 text-white rounded-xl font-bold shadow-lg shadow-purple-500/20 hover:from-cyan-400 hover:via-purple-400 hover:to-orange-400 transform hover:scale-105 transition-all"
        >
          <Scissors className="w-5 h-5" />
          Split into {(rowSplits.length + 1) * (colSplits.length + 1)} Images
        </button>
      </div>
    </div>
  );
};