import React, { useState, useEffect } from 'react';
import { Upload, Image as ImageIcon, AlertCircle, Clipboard } from 'lucide-react';

interface ImageUploaderProps {
  onImageSelected: (file: File) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelected }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 监听粘贴事件
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            validateAndPass(file);
          }
          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    validateAndPass(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    validateAndPass(file);
  };

  const validateAndPass = (file: File | undefined) => {
    setError(null);
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError("Please upload a valid image file (PNG, JPG, WebP).");
      return;
    }

    onImageSelected(file);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={`relative border-2 border-dashed rounded-2xl p-10 transition-all duration-300 text-center cursor-pointer group
          ${isDragging
            ? 'border-purple-400 bg-purple-950/30'
            : 'border-slate-600 hover:border-purple-400/50 hover:bg-slate-800/50 bg-slate-900/50'
          }
        `}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('fileInput')?.click()}
      >
        <input
          type="file"
          id="fileInput"
          className="hidden"
          accept="image/*"
          onChange={handleFileChange}
        />

        <div className="flex flex-col items-center justify-center gap-4">
          <div className="p-4 rounded-full bg-gradient-to-br from-cyan-500/20 via-purple-500/20 to-orange-500/20 group-hover:from-cyan-500/30 group-hover:via-purple-500/30 group-hover:to-orange-500/30 transition-colors">
            <Upload className="w-10 h-10 text-purple-400" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-white mb-1">
              Upload Image
            </h3>
            <p className="text-slate-400">
              Click to browse, drag & drop, or press <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-xs">Ctrl+V</kbd> to paste
            </p>
          </div>
          <div className="flex gap-4 text-xs text-slate-500 mt-2">
            <span className="flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> PNG, JPG, WEBP
            </span>
            <span className="flex items-center gap-1">
              <Clipboard className="w-3 h-3" /> Paste from clipboard
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-400">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}
    </div>
  );
};
